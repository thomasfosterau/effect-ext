/**
 * Web ARChive (WARC 1.0 / 1.1, ISO 28500) files: a reader and a streaming
 * decoder, a writer, and a recorder that writes `HttpClient` and `HttpServer`
 * exchanges as request and response records.
 *
 * Records are read and written uncompressed: a `.warc.gz` is a gzip member
 * per record, which the caller adds or removes (`CompressionStream`). Nothing
 * here computes a `WARC-Block-Digest` or `WARC-Payload-Digest`.
 *
 * @since 0.5.0
 */
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import * as Stream from "effect/Stream";
import type * as Headers from "effect/http/Headers";
import type * as HttpClient from "effect/http/HttpClient";
import type * as HttpClientError from "effect/http/HttpClientError";
import {
  bodyBytes,
  captureClient,
  recordingServer,
  type Exchange,
  redactedHeaders,
  redactedQuery,
  RedactedQueryNames as internalRedactedQueryNames,
} from "./internal/http-exchange.ts";

/**
 * A WARC format version this module reads and writes.
 *
 * @since 0.5.0
 * @category models
 */
export type Version = "1.0" | "1.1";

/**
 * One WARC record: its version, its named fields in order, and its block.
 * Field names keep the case they were written in; read them with
 * {@link field}, which ignores case.
 *
 * @since 0.5.0
 * @category models
 */
export interface WarcRecord {
  readonly version: Version;
  readonly fields: ReadonlyArray<readonly [name: string, value: string]>;
  readonly block: Uint8Array;
}

/**
 * Why a WARC file could not be read, and the byte offset where it went wrong.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Warc } from "@thomasfosterau/effect-ext"
 *
 * Effect.runPromise(Effect.flip(Warc.parse(new TextEncoder().encode("GIF89a")))).then((error) =>
 *   console.log(error.reason, error.offset), // "NotAWarc" 0
 * )
 * ```
 *
 * @since 0.5.0
 * @category errors
 */
export class WarcError extends Schema.TaggedError<WarcError, { readonly brand: unique symbol }>()(
  "WarcError",
  {
    reason: Schema.Literals([
      "NotAWarc",
      "UnsupportedVersion",
      "MalformedField",
      "MissingContentLength",
      "HeaderTooLarge",
      "MissingTerminator",
      "Truncated",
    ]),
    offset: Schema.Finite,
    message: Schema.String,
  },
) {}

/**
 * The first value of the field `name` (compared without case), if the record
 * has one.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Warc } from "@thomasfosterau/effect-ext"
 *
 * Effect.runPromise(Warc.makeRecord({ type: "resource", block: "hi" })).then((record) =>
 *   console.log(Warc.field(record, "content-length")), // Option.some("2")
 * )
 * ```
 *
 * @since 0.5.0
 * @category getters
 */
export const field = (record: WarcRecord, name: string): Option.Option<string> => {
  const wanted = Str.toLowerCase(name);
  return Option.map(
    Arr.findFirst(record.fields, ([candidate]) => Str.toLowerCase(candidate) === wanted),
    ([, value]) => value,
  );
};

/** The largest header block the reader looks through for its end. */
const MAX_HEADER_BYTES = 1024 * 1024;

const CRLF = "\r\n";
const MAGIC = [0x57, 0x41, 0x52, 0x43, 0x2f]; // "WARC/"

const utf8 = () => new TextDecoder();
const latin1 = () => new TextDecoder("latin1");
const encodeText = (text: string): Uint8Array => new TextEncoder().encode(text);

const concat = (parts: ReadonlyArray<Uint8Array>): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(Arr.reduce(parts, 0, (size, part) => size + part.byteLength));
  Arr.reduce(parts, 0, (at, part) => {
    out.set(part, at);
    return at + part.byteLength;
  });
  return out;
};

const failure = (reason: WarcError["reason"], offset: number, message: string): WarcError =>
  new WarcError({ reason, offset, message });

/**
 * What reading from one offset found: a record, a failure, the bytes ending
 * inside a record (`need` bytes from `at` would finish it), or the end.
 */
type Step = Data.TaggedEnum<{
  Record: { readonly record: WarcRecord; readonly next: number };
  Failed: { readonly error: WarcError };
  Pending: { readonly at: number; readonly need: number };
  End: { readonly at: number };
}>;
const Step = Data.taggedEnum<Step>();

/** A step that ends a scan. */
type Stop = Exclude<Step, { readonly _tag: "Record" }>;

/** Where a scan leaves the step that ended it. */
interface LastStop {
  stop: Stop;
}

const hasMagic = (bytes: Uint8Array, at: number): boolean =>
  Arr.every(MAGIC, (byte, index) => at + index >= bytes.byteLength || bytes[at + index] === byte);

const VERSIONS = { "WARC/1.0": "1.0", "WARC/1.1": "1.1" } as const satisfies Record<
  string,
  Version
>;

const isVersionLine = (line: string): line is keyof typeof VERSIONS => line in VERSIONS;

/** Header lines, continuation lines (a leading space or tab) folded into the one before. */
const foldLines = (lines: ReadonlyArray<string>): ReadonlyArray<string> =>
  Arr.reduce(lines, Arr.empty<string>(), (folded, line) =>
    (Str.startsWith(" ")(line) || Str.startsWith("\t")(line)) && Arr.isArrayNonEmpty(folded)
      ? Arr.append(Arr.initNonEmpty(folded), `${Arr.lastNonEmpty(folded)} ${Str.trim(line)}`)
      : Arr.append(folded, line),
  );

const parseFields = (
  lines: ReadonlyArray<string>,
  offset: number,
): Result.Result<ReadonlyArray<readonly [string, string]>, WarcError> =>
  Result.all(
    Arr.map(foldLines(lines), (line) => {
      const colon = line.indexOf(":");
      return colon <= 0
        ? Result.fail(failure("MalformedField", offset, `Not a "name: value" field: ${line}`))
        : Result.succeed([
            Str.trim(line.slice(0, colon)),
            Str.trim(line.slice(colon + 1)),
          ] as const);
    }),
  );

const contentLength = (
  fields: ReadonlyArray<readonly [string, string]>,
  offset: number,
): Result.Result<number, WarcError> =>
  Option.match(
    Option.filter(
      field({ version: "1.1", fields, block: new Uint8Array() }, "Content-Length"),
      (value) => /^\d+$/.test(value),
    ),
    {
      onNone: () =>
        Result.fail(failure("MissingContentLength", offset, "No valid Content-Length field")),
      onSome: (value) => Result.succeed(Number(value)),
    },
  );

const step = (bytes: Uint8Array, at: number, base: number): Step => {
  const available = bytes.byteLength - at;
  if (available === 0) return Step.End({ at });
  if (!hasMagic(bytes, at)) {
    return Step.Failed({ error: failure("NotAWarc", base + at, "A record must start with WARC/") });
  }
  const window = bytes.subarray(at, at + MAX_HEADER_BYTES);
  const headerEnd = latin1().decode(window).indexOf(`${CRLF}${CRLF}`);
  if (headerEnd < 0) {
    return window.byteLength === MAX_HEADER_BYTES
      ? Step.Failed({
          error: failure("HeaderTooLarge", base + at, `No header end in ${MAX_HEADER_BYTES} bytes`),
        })
      : Step.Pending({ at, need: available + 1 });
  }
  const headerLines = Str.split(utf8().decode(window.subarray(0, headerEnd)), CRLF);
  const versionLine = Arr.headNonEmpty(headerLines);
  const lines = Arr.tailNonEmpty(headerLines);
  if (!isVersionLine(versionLine)) {
    return Step.Failed({
      error: failure("UnsupportedVersion", base + at, `Unsupported version: ${versionLine}`),
    });
  }
  const parsed = Result.flatMap(parseFields(lines, base + at), (fields) =>
    Result.map(contentLength(fields, base + at), (length) => ({ fields, length })),
  );
  if (Result.isFailure(parsed)) return Step.Failed({ error: parsed.failure });
  const { fields, length } = parsed.success;
  const blockStart = at + headerEnd + 4;
  const blockEnd = blockStart + length;
  if (bytes.byteLength < blockEnd + 4) {
    return Step.Pending({ at, need: blockEnd + 4 - at });
  }
  if (latin1().decode(bytes.subarray(blockEnd, blockEnd + 4)) !== `${CRLF}${CRLF}`) {
    return Step.Failed({
      error: failure("MissingTerminator", base + blockEnd, "A record must end with CRLF CRLF"),
    });
  }
  return Step.Record({
    record: { version: VERSIONS[versionLine], fields, block: bytes.slice(blockStart, blockEnd) },
    next: blockEnd + 4,
  });
};

/** The records from the start of `bytes`, and the first step that is not one. */
const scan = (bytes: Uint8Array, base: number) => {
  const last: LastStop = { stop: Step.End({ at: 0 }) };
  const records = Arr.unfold(0, (at) => {
    const found = step(bytes, at, base);
    if (Step.$is("Record")(found)) return Option.some([found.record, found.next] as const);
    last.stop = found;
    return Option.none();
  });
  return { records, stop: last.stop };
};

const truncated = (offset: number): WarcError =>
  failure("Truncated", offset, "The input ends inside a record");

/**
 * Reads every record of an uncompressed WARC file.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Warc } from "@thomasfosterau/effect-ext"
 *
 * const program = Effect.gen(function* () {
 *   const record = yield* Warc.makeRecord({ type: "resource", block: "hello" })
 *   const [read] = yield* Warc.parse(Warc.encode(record))
 *   return new TextDecoder().decode(read?.block)
 * })
 * Effect.runPromise(program).then(console.log) // "hello"
 * ```
 *
 * @since 0.5.0
 * @category parsing
 */
export const parse = (bytes: Uint8Array): Effect.Effect<ReadonlyArray<WarcRecord>, WarcError> => {
  const { records, stop } = scan(bytes, 0);
  return Match.valueTags(stop, {
    Failed: ({ error }) => Effect.fail(error),
    Pending: ({ at }) => Effect.fail(truncated(at)),
    End: () => Effect.succeed(records),
  });
};

interface DecodeState {
  readonly chunks: ReadonlyArray<Uint8Array>;
  readonly size: number;
  /** Bytes to hold before reading again. */
  readonly need: number;
  /** The offset in the whole input of the first held byte. */
  readonly base: number;
  readonly failed: boolean;
}

/** The state holding what is left of `bytes` from `at`. */
const rest = (base: number, bytes: Uint8Array, at: number, need: number): DecodeState => {
  const left = bytes.subarray(at);
  return {
    chunks: left.byteLength === 0 ? [] : [left],
    size: left.byteLength,
    need,
    base: base + at,
    failed: false,
  };
};

const initial = (): DecodeState => ({ chunks: [], size: 0, need: 1, base: 0, failed: false });

const decodeChunk = (
  state: DecodeState,
  chunk: Uint8Array,
): readonly [DecodeState, ReadonlyArray<Result.Result<WarcRecord, WarcError>>] => {
  if (state.failed || chunk.byteLength === 0) return [state, []];
  const held = {
    ...state,
    chunks: Arr.append(state.chunks, chunk),
    size: state.size + chunk.byteLength,
  };
  if (held.size < held.need) return [held, []];
  const bytes = concat(held.chunks);
  const { records, stop } = scan(bytes, held.base);
  const read = Arr.map(records, Result.succeed);
  return Match.valueTags(stop, {
    Failed: ({
      error,
    }): readonly [DecodeState, ReadonlyArray<Result.Result<WarcRecord, WarcError>>] => [
      { ...held, failed: true },
      Arr.append(read, Result.fail(error)),
    ],
    Pending: ({ at, need }) => [rest(held.base, bytes, at, need), read] as const,
    End: ({ at }) => [rest(held.base, bytes, at, 1), read] as const,
  });
};

/**
 * Decodes the records of an uncompressed WARC byte stream as they complete,
 * holding no more than one record's bytes at a time. A malformed record, or
 * a stream that ends inside one, fails the stream with a {@link WarcError}
 * after the records before it.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import { Warc } from "@thomasfosterau/effect-ext"
 *
 * const program = Effect.gen(function* () {
 *   const bytes = Warc.encodeAll([
 *     yield* Warc.makeRecord({ type: "resource", block: "one" }),
 *     yield* Warc.makeRecord({ type: "resource", block: "two" }),
 *   ])
 *   const chunks = Stream.make(bytes.subarray(0, 100), bytes.subarray(100))
 *   const records = yield* Stream.runCollect(Warc.decodeStream(chunks))
 *   return records.length
 * })
 * Effect.runPromise(program).then(console.log) // 2
 * ```
 *
 * @since 0.5.0
 * @category parsing
 */
export const decodeStream = <E, R>(
  bytes: Stream.Stream<Uint8Array, E, R>,
): Stream.Stream<WarcRecord, E | WarcError, R> =>
  bytes.pipe(
    Stream.mapAccum(initial, decodeChunk, {
      onHalt: (state) =>
        state.failed || state.size === 0 ? [] : [Result.fail(truncated(state.base))],
    }),
    Stream.mapEffect(Effect.fromResult),
  );

/**
 * Writes one record. `Content-Length` is always the block's length: an
 * existing field is rewritten in place, a missing one appended.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Warc } from "@thomasfosterau/effect-ext"
 *
 * const record = { version: "1.1", fields: [["WARC-Type", "resource"]], block: new Uint8Array() } as const
 * console.log(new TextDecoder().decode(Warc.encode(record)))
 * // "WARC/1.1\r\nWARC-Type: resource\r\nContent-Length: 0\r\n\r\n\r\n\r\n"
 * ```
 *
 * @since 0.5.0
 * @category encoding
 */
export const encode = (record: WarcRecord): Uint8Array<ArrayBuffer> => {
  const length = String(record.block.byteLength);
  const hasLength = Option.isSome(field(record, "Content-Length"));
  const fields = Arr.map(record.fields, ([name, value]) =>
    Str.toLowerCase(name) === "content-length"
      ? ([name, length] as const)
      : ([name, value] as const),
  );
  const lines = Arr.map(
    hasLength ? fields : Arr.append(fields, ["Content-Length", length] as const),
    ([name, value]) => `${name}: ${value}${CRLF}`,
  );
  return concat([
    encodeText(`WARC/${record.version}${CRLF}${Arr.join(lines, "")}${CRLF}`),
    record.block,
    encodeText(`${CRLF}${CRLF}`),
  ]);
};

/**
 * Writes records one after another, as one uncompressed WARC file. For a
 * stream of records, `Stream.map(Warc.encode)` writes them as they come.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Warc } from "@thomasfosterau/effect-ext"
 *
 * const program = Effect.map(Warc.makeRecord({ type: "resource", block: "hi" }), (record) =>
 *   Warc.encodeAll([record, record]).byteLength,
 * )
 * Effect.runPromise(program).then(console.log)
 * ```
 *
 * @since 0.5.0
 * @category encoding
 */
export const encodeAll = (records: Iterable<WarcRecord>): Uint8Array<ArrayBuffer> =>
  concat(Arr.map(Arr.fromIterable(records), encode));

const newRecordId = Effect.sync(() => `<urn:uuid:${globalThis.crypto.randomUUID()}>`);

/**
 * Builds a record with the fields every record needs: `WARC-Type`, a fresh
 * `WARC-Record-ID` (a `urn:uuid:`), `WARC-Date` (now, from `Clock`; to the
 * second for WARC 1.0, to the millisecond for 1.1) and `Content-Length`,
 * with `fields` and then `Content-Type` between them.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Warc } from "@thomasfosterau/effect-ext"
 *
 * const program = Warc.makeRecord({
 *   type: "resource",
 *   fields: [["WARC-Target-URI", "https://example.com/"]],
 *   contentType: "text/plain",
 *   block: "hello",
 * })
 * Effect.runPromise(program).then((record) => console.log(record.fields.map(([name]) => name)))
 * // ["WARC-Type", "WARC-Record-ID", "WARC-Date", "WARC-Target-URI", "Content-Type", "Content-Length"]
 * ```
 *
 * @since 0.5.0
 * @category constructors
 */
export const makeRecord = (options: {
  /** `warcinfo`, `response`, `resource`, `request`, `metadata`, `revisit`, `conversion` or `continuation`. */
  readonly type: string;
  readonly block: Uint8Array | string;
  readonly fields?: ReadonlyArray<readonly [string, string]>;
  readonly contentType?: string;
  readonly version?: Version;
  readonly date?: DateTime.DateTime;
  /** The `WARC-Record-ID`, `<` and `>` included. Defaults to a fresh `<urn:uuid:…>`. */
  readonly id?: string;
}): Effect.Effect<WarcRecord> =>
  Effect.gen(function* () {
    const version = options.version ?? "1.1";
    const date = options.date ?? (yield* DateTime.now);
    const id = options.id ?? (yield* newRecordId);
    const block = P.isString(options.block) ? encodeText(options.block) : options.block;
    const iso = DateTime.formatIso(DateTime.toUtc(date));
    return {
      version,
      fields: [
        ["WARC-Type", options.type],
        ["WARC-Record-ID", id],
        ["WARC-Date", version === "1.0" ? iso.replace(/\.\d+Z$/, "Z") : iso],
        ...(options.fields ?? []),
        ...(P.isString(options.contentType)
          ? [["Content-Type", options.contentType] as const]
          : []),
        ["Content-Length", String(block.byteLength)],
      ],
      block,
    };
  });

/**
 * A `warcinfo` record: `fields` as an `application/warc-fields` block, the
 * description a WARC file usually opens with (`software`, `format`,
 * `isPartOf`, …).
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Warc } from "@thomasfosterau/effect-ext"
 *
 * const program = Warc.warcinfo({ fields: [["software", "my-crawler/1.0"]], filename: "crawl.warc" })
 * Effect.runPromise(program).then((record) => console.log(new TextDecoder().decode(record.block)))
 * // "software: my-crawler/1.0\r\n"
 * ```
 *
 * @since 0.5.0
 * @category constructors
 */
export const warcinfo = (options: {
  readonly fields: ReadonlyArray<readonly [string, string]>;
  readonly filename?: string;
  readonly version?: Version;
}): Effect.Effect<WarcRecord> =>
  makeRecord({
    type: "warcinfo",
    contentType: "application/warc-fields",
    block: Arr.join(
      Arr.map(options.fields, ([name, value]) => `${name}: ${value}${CRLF}`),
      "",
    ),
    fields: P.isString(options.filename) ? [["WARC-Filename", options.filename]] : [],
    version: options.version ?? "1.1",
  });

/**
 * Collects WARC records. {@link recordClient} and {@link recordServer} add a
 * response and a request record per exchange; {@link Recorder.bytes} is
 * everything so far, as a WARC file.
 *
 * @since 0.5.0
 * @category services
 */
export class Recorder extends Context.Service<
  Recorder,
  {
    readonly add: (records: ReadonlyArray<WarcRecord>) => Effect.Effect<void>;
    readonly records: Effect.Effect<ReadonlyArray<WarcRecord>>;
    readonly clear: Effect.Effect<void>;
    readonly bytes: Effect.Effect<Uint8Array<ArrayBuffer>>;
  }
>()("@thomasfosterau/effect-ext/Warc/Recorder") {}

/**
 * Builds an in-memory {@link Recorder}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Warc } from "@thomasfosterau/effect-ext"
 *
 * const program = Effect.gen(function* () {
 *   const recorder = yield* Warc.makeRecorder
 *   yield* recorder.add([yield* Warc.warcinfo({ fields: [["software", "my-app"]] })])
 *   return (yield* recorder.records).length
 * })
 * Effect.runPromise(program).then(console.log) // 1
 * ```
 *
 * @since 0.5.0
 * @category constructors
 */
export const makeRecorder: Effect.Effect<Recorder["Service"]> = Effect.map(
  Ref.make<ReadonlyArray<WarcRecord>>([]),
  (ref) =>
    Recorder.of({
      add: (more) => Ref.update(ref, Arr.appendAll(more)),
      records: Ref.get(ref),
      clear: Ref.set(ref, []),
      bytes: Effect.map(Ref.get(ref), encodeAll),
    }),
);

/**
 * A fresh in-memory {@link Recorder}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Warc } from "@thomasfosterau/effect-ext"
 *
 * const program = Effect.flatMap(Warc.Recorder, (recorder) => recorder.records)
 * Effect.runPromise(Effect.provide(program, Warc.layerRecorder)).then(console.log) // []
 * ```
 *
 * @since 0.5.0
 * @category layers
 */
export const layerRecorder: Layer.Layer<Recorder> = Layer.effect(Recorder, makeRecorder);

/** Headers that describe a body as sent, which a recorded (decoded, whole) body no longer is. */
const FRAMING = ["content-encoding", "transfer-encoding", "content-length"];

const httpHeaderLines = (
  pairs: ReadonlyArray<readonly [string, string]>,
  body: Uint8Array,
): string =>
  Arr.join(
    Arr.map(
      Arr.append(
        Arr.filter(pairs, ([name]) => !Arr.contains(FRAMING, Str.toLowerCase(name))),
        ["content-length", String(body.byteLength)] as const,
      ),
      ([name, value]) => `${name}: ${value}${CRLF}`,
    ),
    "",
  );

/** `url` with its query parameters redacted as {@link RedactedQueryNames} says. */
const targetUri = (exchange: Exchange): Effect.Effect<string> =>
  Effect.map(redactedQuery(exchange.query), (pairs) => {
    const url = new URL(exchange.url, "http://localhost");
    if (Arr.isReadonlyArrayNonEmpty(pairs)) {
      url.search = new URLSearchParams(Arr.map(pairs, ([name, value]) => [name, value])).toString();
    }
    return url.href;
  });

const declaresBody = (headers: Headers.Headers): boolean =>
  P.isString(headers["transfer-encoding"]) ||
  Option.exists(Option.fromUndefinedOr(headers["content-length"]), (length) => length !== "0");

/** The request and response records of one exchange, response first. */
const recordsOf = (
  exchange: Exchange,
  version: Version,
): Effect.Effect<ReadonlyArray<WarcRecord>> =>
  Effect.gen(function* () {
    const target = yield* targetUri(exchange);
    const url = new URL(target, "http://localhost");
    const requestHeaders = yield* redactedHeaders(exchange.requestHeaders);
    const withHost = Arr.some(requestHeaders, ([name]) => Str.toLowerCase(name) === "host")
      ? requestHeaders
      : Arr.prepend(requestHeaders, ["host", url.host] as const);
    const requestBody = bodyBytes(exchange.requestBody);
    const requestBytes = Option.getOrElse(requestBody, () => new Uint8Array());
    const requestTruncated =
      Option.isNone(requestBody) ||
      (requestBytes.byteLength === 0 && declaresBody(exchange.requestHeaders));
    const responseBytes = Option.getOrElse(exchange.responseBody, () => new Uint8Array());
    const responseId = yield* newRecordId;
    const response = yield* makeRecord({
      id: responseId,
      type: "response",
      version,
      date: exchange.started,
      contentType: "application/http;msgtype=response",
      fields: [
        ["WARC-Target-URI", target],
        ...(Option.isNone(exchange.responseBody)
          ? [["WARC-Truncated", "unspecified"] as const]
          : []),
      ],
      block: concat([
        encodeText(
          `HTTP/1.1 ${exchange.status} ${Option.getOrElse(exchange.statusText, () => "")}${CRLF}` +
            httpHeaderLines(yield* redactedHeaders(exchange.responseHeaders), responseBytes) +
            CRLF,
        ),
        responseBytes,
      ]),
    });
    const request = yield* makeRecord({
      type: "request",
      version,
      date: exchange.started,
      contentType: "application/http;msgtype=request",
      fields: [
        ["WARC-Target-URI", target],
        ["WARC-Concurrent-To", responseId],
        ...(requestTruncated ? [["WARC-Truncated", "unspecified"] as const] : []),
      ],
      block: concat([
        encodeText(
          `${exchange.method} ${url.pathname}${url.search} HTTP/1.1${CRLF}` +
            httpHeaderLines(withHost, requestBytes) +
            CRLF,
        ),
        requestBytes,
      ]),
    });
    return [response, request];
  });

/**
 * Query parameter names (or patterns) whose values a recording writes as
 * `"<redacted>"`: the same reference as `Har.RedactedQueryNames`, defaulting
 * to Effect's own list for `UrlParams.CurrentRedactedNames` (signed-URL
 * parameters). A custom list replaces it.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Warc } from "@thomasfosterau/effect-ext"
 *
 * Effect.runPromise(Effect.service(Warc.RedactedQueryNames)).then(console.log)
 * // ["AWSAccessKeyId", "Signature", "sig", "X-Goog-Signature"]
 * ```
 *
 * @since 0.5.0
 * @category redaction
 */
export const RedactedQueryNames: Context.Reference<ReadonlyArray<string | RegExp>> =
  internalRedactedQueryNames;

/**
 * Options for {@link recordClient} and {@link recordServer}.
 *
 * @since 0.5.0
 * @category models
 */
export interface RecordOptions {
  /** The WARC version of the records written. Defaults to `"1.1"`. */
  readonly version?: Version;
}

/**
 * Records each exchange `client` makes into the {@link Recorder}, as a
 * `response` record and a `request` record joined by `WARC-Concurrent-To`,
 * then returns the response as it arrived.
 *
 * The response body is read in full to record it, so a streamed response
 * arrives buffered. The block holds the body as the client received it
 * (decoded, where `fetch` decoded it), so `Content-Encoding` and
 * `Transfer-Encoding` are dropped and `Content-Length` is the recorded
 * length. A request body that is a stream or form data is not recorded and
 * marked `WARC-Truncated: unspecified`. Headers and query parameters are
 * redacted as `Headers.CurrentRedactedNames` / {@link RedactedQueryNames}
 * say.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as HttpClient from "effect/http/HttpClient"
 * import * as HttpClientResponse from "effect/http/HttpClientResponse"
 * import { Warc } from "@thomasfosterau/effect-ext"
 *
 * const stub = HttpClient.make((request) =>
 *   Effect.succeed(HttpClientResponse.fromWeb(request, new Response("hello"))),
 * )
 * const program = Effect.gen(function* () {
 *   const client = yield* Warc.recordClient(stub)
 *   yield* client.get("https://example.com/greeting")
 *   const recorder = yield* Warc.Recorder
 *   return yield* recorder.records
 * })
 * Effect.runPromise(Effect.provide(program, Warc.layerRecorder)).then((records) =>
 *   console.log(records.map((record) => Warc.field(record, "WARC-Type"))),
 *   // [Option.some("response"), Option.some("request")]
 * )
 * ```
 *
 * @since 0.5.0
 * @category recording
 */
export const recordClient = <E, R>(
  client: HttpClient.HttpClient.With<E, R>,
  options?: RecordOptions,
): Effect.Effect<
  HttpClient.HttpClient.With<E | HttpClientError.HttpClientError, R>,
  never,
  Recorder
> =>
  Effect.map(Effect.service(Recorder), (recorder) =>
    captureClient(client, (exchange) =>
      Effect.flatMap(recordsOf(exchange, options?.version ?? "1.1"), recorder.add),
    ),
  );

/**
 * Server middleware that records each request it serves into the
 * {@link Recorder}, as {@link recordClient} does. The request body is never
 * read (the handler owns it), so a request that declares one is marked
 * `WARC-Truncated: unspecified`; a response body is recorded unless it is a
 * stream or form data.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as HttpServerRequest from "effect/http/HttpServerRequest"
 * import * as HttpServerResponse from "effect/http/HttpServerResponse"
 * import { Warc } from "@thomasfosterau/effect-ext"
 *
 * const request = HttpServerRequest.fromWeb(new Request("https://example.com/items/1"))
 * const recorded = Effect.flatMap(Warc.Recorder, (recorder) => recorder.records)
 * const program = Warc.recordServer(HttpServerResponse.json({ id: 1 })).pipe(
 *   Effect.andThen(recorded),
 *   Effect.provideService(HttpServerRequest.HttpServerRequest, request),
 *   Effect.provide(Warc.layerRecorder),
 * )
 * Effect.runPromise(program).then((records) =>
 *   console.log(records.map((record) => Warc.field(record, "WARC-Target-URI"))),
 *   // [Option.some("https://example.com/items/1"), Option.some("https://example.com/items/1")]
 * )
 * ```
 *
 * @since 0.5.0
 * @category recording
 */
export const recordServer = recordingServer(Recorder, (recorder, exchange) =>
  Effect.flatMap(recordsOf(exchange, "1.1"), recorder.add),
);
