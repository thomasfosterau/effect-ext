/**
 * WARC 1.0 / 1.1: reading, streaming and writing records, and recording
 * client and server exchanges as request and response records.
 */
import { describe, expect, it } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as HttpBody from "effect/http/HttpBody";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as UrlParams from "effect/http/UrlParams";
import * as Warc from "@thomasfosterau/effect-ext/Warc";

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (data: Uint8Array) => new TextDecoder().decode(data);
const NO_RECORD: Warc.WarcRecord = { version: "1.1", fields: [], block: new Uint8Array() };
/** The record at `index`, or one with no fields and an empty block. */
const nth = (records: ReadonlyArray<Warc.WarcRecord>, index: number): Warc.WarcRecord =>
  Option.getOrElse(Arr.get(records, index), () => NO_RECORD);

/** A hand-written WARC 1.0 file: lowercase names, a folded line, two records. */
const SAMPLE =
  "WARC/1.0\r\n" +
  "WARC-Type: resource\r\n" +
  "WARC-Target-URI: https://example.com/\r\n" +
  "X-Note: first\r\n" +
  "  continued\r\n" +
  "content-length: 5\r\n" +
  "\r\n" +
  "hello\r\n\r\n" +
  "WARC/1.1\r\n" +
  "WARC-Type: metadata\r\n" +
  "Content-Length: 0\r\n" +
  "\r\n" +
  "\r\n\r\n";

const reasonOf = (input: string) =>
  Effect.map(Effect.flip(Warc.parse(bytes(input))), (error) => ({
    reason: error.reason,
    offset: error.offset,
  }));

describe("Warc.parse", () => {
  it.effect("reads records, folding continuation lines and ignoring field case", () =>
    Effect.gen(function* () {
      const all = yield* Warc.parse(bytes(SAMPLE));
      expect(all).toHaveLength(2);
      const first = nth(all, 0);
      const second = nth(all, 1);
      expect(first.version).toBe("1.0");
      expect(text(first.block)).toBe("hello");
      expect(Warc.field(first, "x-note")).toStrictEqual(Option.some("first continued"));
      expect(Warc.field(first, "CONTENT-LENGTH")).toStrictEqual(Option.some("5"));
      expect(Warc.field(first, "WARC-Date")).toStrictEqual(Option.none());
      expect(second.version).toBe("1.1");
      expect(second.block.byteLength).toBe(0);
    }),
  );

  it.effect("reads nothing from nothing", () =>
    Effect.map(Warc.parse(new Uint8Array()), (records) => expect(records).toStrictEqual([])),
  );

  it.effect("fails with a reason and the offset of the bad record", () =>
    Effect.gen(function* () {
      expect(yield* reasonOf("WARC/1.1\r\nContent-Length: 2\r\n\r\nhiXX\r\n")).toStrictEqual({
        reason: "MissingTerminator",
        offset: 33,
      });
      expect(yield* reasonOf(`${SAMPLE}garbage`)).toStrictEqual({
        reason: "NotAWarc",
        offset: SAMPLE.length,
      });
      expect(yield* reasonOf(`${SAMPLE}WARC/`)).toStrictEqual({
        reason: "Truncated",
        offset: SAMPLE.length,
      });
      expect((yield* reasonOf("WARC/2.0\r\n\r\n")).reason).toBe("UnsupportedVersion");
      expect((yield* reasonOf("WARC/1.1\r\nbad\r\n\r\n")).reason).toBe("MalformedField");
      expect((yield* reasonOf("WARC/1.1\r\nA: b\r\n\r\n")).reason).toBe("MissingContentLength");
      expect((yield* reasonOf("WARC/1.1\r\nContent-Length: 9\r\n\r\nhi")).reason).toBe("Truncated");
      expect((yield* reasonOf("WARC/1.1\r\nContent-Length: 0")).reason).toBe("Truncated");
      expect((yield* reasonOf("WARC/1.1\r\n: no name\r\n\r\n")).reason).toBe("MalformedField");
      expect((yield* reasonOf("WARC/1.1\r\nContent-Length: -1\r\n\r\n")).reason).toBe(
        "MissingContentLength",
      );
      expect(yield* reasonOf("HTTP/1.1 200 OK\r\n\r\n")).toStrictEqual({
        reason: "NotAWarc",
        offset: 0,
      });
    }),
  );

  it.effect("gives up on a header block with no end", () =>
    Effect.map(reasonOf(`WARC/1.1\r\nX: ${"a".repeat(1024 * 1024)}`), (found) =>
      expect(found).toStrictEqual({ reason: "HeaderTooLarge", offset: 0 }),
    ),
  );
});

const collect = (chunks: ReadonlyArray<Uint8Array>) =>
  Effect.map(Stream.runCollect(Warc.decodeStream(Stream.fromIterable(chunks))), (records) =>
    Array.from(records),
  );
const split = (data: Uint8Array, size: number) =>
  Array.from({ length: Math.ceil(data.byteLength / size) }, (_, index) =>
    data.subarray(index * size, (index + 1) * size),
  );

describe("Warc.decodeStream", () => {
  it.effect("reads the same records whatever the chunking", () =>
    Effect.gen(function* () {
      const whole = yield* Warc.parse(bytes(SAMPLE));
      const chunked = yield* Effect.forEach(
        [1, 2, 7, 64, SAMPLE.length],
        (size) => collect(split(bytes(SAMPLE), size)),
        { concurrency: 1 },
      );
      expect(chunked).toStrictEqual(Arr.replicate(whole, 5));
      expect(yield* collect([new Uint8Array(), bytes(SAMPLE), new Uint8Array()])).toStrictEqual(
        whole,
      );
      expect(yield* collect([])).toStrictEqual([]);
    }),
  );

  it.effect("emits the records before a failure, then fails at its offset in the input", () =>
    Effect.gen(function* () {
      const seen: Array<Warc.WarcRecord> = [];
      const error = yield* Effect.flip(
        Stream.runForEach(
          Warc.decodeStream(Stream.fromIterable(split(bytes(`${SAMPLE}garbage`), 3))),
          (record) => Effect.sync(() => seen.push(record)),
        ),
      );
      expect(seen).toHaveLength(2);
      expect({ reason: error.reason, offset: error.offset }).toStrictEqual({
        reason: "NotAWarc",
        offset: SAMPLE.length,
      });
    }),
  );

  it.effect("fails a stream that ends inside a record", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(collect(split(bytes(`${SAMPLE}WARC/1.1\r\nCont`), 4)));
      expect({ reason: error.reason, offset: error.offset }).toStrictEqual({
        reason: "Truncated",
        offset: SAMPLE.length,
      });
    }),
  );

  it.effect("ignores what follows a failure", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(collect([bytes("nope"), bytes(SAMPLE)]));
      expect(error.reason).toBe("NotAWarc");
    }),
  );
});

describe("Warc.encode", () => {
  it("writes Content-Length from the block, in place or appended", () => {
    const block = bytes("abc");
    expect(
      text(
        Warc.encode({
          version: "1.0",
          fields: [
            ["content-length", "99"],
            ["X", "y"],
          ],
          block,
        }),
      ),
    ).toBe("WARC/1.0\r\ncontent-length: 3\r\nX: y\r\n\r\nabc\r\n\r\n");
    expect(text(Warc.encode({ version: "1.1", fields: [], block }))).toBe(
      "WARC/1.1\r\nContent-Length: 3\r\n\r\nabc\r\n\r\n",
    );
  });

  it.effect("round-trips through parse", () =>
    Effect.gen(function* () {
      const records = yield* Warc.parse(bytes(SAMPLE));
      expect(yield* Warc.parse(Warc.encodeAll(records))).toStrictEqual(records);
    }),
  );
});

describe("Warc.makeRecord", () => {
  it.effect("adds the mandatory fields, dated by the clock", () =>
    Effect.gen(function* () {
      const record = yield* Warc.makeRecord({
        type: "resource",
        fields: [["WARC-Target-URI", "https://example.com/"]],
        contentType: "text/plain",
        block: "hello",
      });
      expect(record.fields.map(([name]) => name)).toStrictEqual([
        "WARC-Type",
        "WARC-Record-ID",
        "WARC-Date",
        "WARC-Target-URI",
        "Content-Type",
        "Content-Length",
      ]);
      expect(
        Option.exists(Warc.field(record, "WARC-Record-ID"), (id) =>
          /^<urn:uuid:[0-9a-f-]{36}>$/.test(id),
        ),
      ).toBe(true);
      expect(Warc.field(record, "WARC-Date")).toStrictEqual(
        Option.some("1970-01-01T00:00:00.000Z"),
      );
      expect(Warc.field(record, "Content-Length")).toStrictEqual(Option.some("5"));
      const other = yield* Warc.makeRecord({ type: "resource", block: new Uint8Array([1]) });
      expect(Warc.field(other, "WARC-Record-ID")).not.toStrictEqual(
        Warc.field(record, "WARC-Record-ID"),
      );
      expect(Warc.field(other, "Content-Type")).toStrictEqual(Option.none());
    }),
  );

  it.effect("dates WARC 1.0 records to the second", () =>
    Effect.map(Warc.makeRecord({ type: "resource", block: "", version: "1.0" }), (record) => {
      expect(record.version).toBe("1.0");
      expect(Warc.field(record, "WARC-Date")).toStrictEqual(Option.some("1970-01-01T00:00:00Z"));
    }),
  );

  it.effect("writes warcinfo fields as its block", () =>
    Effect.gen(function* () {
      const record = yield* Warc.warcinfo({
        fields: [
          ["software", "test/1.0"],
          ["format", "WARC File Format 1.1"],
        ],
        filename: "crawl.warc",
      });
      expect(text(record.block)).toBe("software: test/1.0\r\nformat: WARC File Format 1.1\r\n");
      expect(Warc.field(record, "Content-Type")).toStrictEqual(
        Option.some("application/warc-fields"),
      );
      expect(Warc.field(record, "WARC-Filename")).toStrictEqual(Option.some("crawl.warc"));
      const bare = yield* Warc.warcinfo({ fields: [], version: "1.0" });
      expect(Warc.field(bare, "WARC-Filename")).toStrictEqual(Option.none());
      expect(bare.version).toBe("1.0");
    }),
  );
});

/** A client answering every request with `respond`'s response. */
const stub = (respond: (request: HttpClientRequest.HttpClientRequest) => Response) =>
  HttpClient.make((request) =>
    Effect.succeed(HttpClientResponse.fromWeb(request, respond(request))),
  );

const recorded = Effect.flatMap(Warc.Recorder, (recorder) => recorder.records);

describe("Warc.recordClient", () => {
  it.effect("records a response and a request record per exchange, redacted", () =>
    Effect.gen(function* () {
      const client = yield* Warc.recordClient(
        stub(
          () =>
            new Response("hello", {
              status: 201,
              headers: { "content-type": "text/plain", "content-encoding": "identity" },
            }),
        ),
      );
      const response = yield* client.execute(
        HttpClientRequest.post("https://example.com/items", {
          urlParams: { token: "secret", page: "2" },
          headers: { authorization: "Bearer secret", "x-trace": "1" },
          body: HttpBody.text("payload"),
        }),
      );
      expect(yield* response.text).toBe("hello");
      const all = yield* recorded;
      expect(all).toHaveLength(2);
      const responseRecord = nth(all, 0);
      const requestRecord = nth(all, 1);
      const target = "https://example.com/items?token=%3Credacted%3E&page=2";
      expect(Warc.field(responseRecord, "WARC-Type")).toStrictEqual(Option.some("response"));
      expect(Warc.field(responseRecord, "WARC-Target-URI")).toStrictEqual(Option.some(target));
      expect(Warc.field(responseRecord, "Content-Type")).toStrictEqual(
        Option.some("application/http;msgtype=response"),
      );
      expect(Warc.field(responseRecord, "WARC-Truncated")).toStrictEqual(Option.none());
      const responseBlock = text(responseRecord.block);
      expect(responseBlock).toMatch(/^HTTP\/1\.1 201 \r\n/);
      expect(responseBlock).toContain("content-type: text/plain\r\n");
      expect(responseBlock).not.toContain("content-encoding");
      expect(responseBlock).toMatch(/content-length: 5\r\n\r\nhello$/);

      expect(Warc.field(requestRecord, "WARC-Type")).toStrictEqual(Option.some("request"));
      expect(Warc.field(requestRecord, "WARC-Concurrent-To")).toStrictEqual(
        Warc.field(responseRecord, "WARC-Record-ID"),
      );
      expect(Warc.field(requestRecord, "WARC-Truncated")).toStrictEqual(Option.none());
      const requestBlock = text(requestRecord.block);
      expect(requestBlock).toMatch(
        /^POST \/items\?token=%3Credacted%3E&page=2 HTTP\/1\.1\r\nhost: example\.com\r\n/,
      );
      expect(requestBlock).toContain("authorization: <redacted>\r\n");
      expect(requestBlock).toContain("x-trace: 1\r\n");
      expect(requestBlock).toMatch(/content-length: 7\r\n\r\npayload$/);
    }).pipe(
      Effect.provide(Warc.layerRecorder),
      Effect.provideService(UrlParams.CurrentRedactedNames, ["token"]),
    ),
  );

  it.effect("marks a streamed request body as not recorded, and writes WARC 1.0 on request", () =>
    Effect.gen(function* () {
      const client = yield* Warc.recordClient(
        stub(() => new Response(null, { status: 204 })),
        { version: "1.0" },
      );
      yield* client.execute(
        HttpClientRequest.post("https://example.com/upload", {
          headers: { host: "uploads.example.com" },
          body: HttpBody.stream(Stream.make(new Uint8Array([1, 2])), "application/octet-stream"),
        }),
      );
      const all = yield* recorded;
      const responseRecord = nth(all, 0);
      const requestRecord = nth(all, 1);
      expect(responseRecord.version).toBe("1.0");
      expect(Warc.field(requestRecord, "WARC-Truncated")).toStrictEqual(Option.some("unspecified"));
      const requestBlock = text(requestRecord.block);
      expect(requestBlock).toMatch(/^POST \/upload HTTP\/1\.1\r\nhost: uploads\.example\.com\r\n/);
      expect(requestBlock).not.toMatch(/host: example\.com/);
    }).pipe(Effect.provide(Warc.layerRecorder)),
  );

  it.effect("writes a file the reader reads back, and clears", () =>
    Effect.gen(function* () {
      const recorder = yield* Warc.Recorder;
      yield* recorder.add([yield* Warc.warcinfo({ fields: [["software", "test"]] })]);
      const client = yield* Warc.recordClient(stub(() => new Response("x")));
      yield* client.get("https://example.com/");
      const file = yield* recorder.bytes;
      const read = yield* Warc.parse(file);
      expect(
        read.map((record) => Option.getOrElse(Warc.field(record, "WARC-Type"), () => "")),
      ).toStrictEqual(["warcinfo", "response", "request"]);
      expect(read).toStrictEqual(yield* recorder.records);
      yield* recorder.clear;
      expect(yield* recorder.records).toStrictEqual([]);
    }).pipe(Effect.provide(Warc.layerRecorder)),
  );
});

/** Serves `response` through the recording middleware, returning its records. */
const serve = (
  response: HttpServerResponse.HttpServerResponse,
  request = HttpServerRequest.fromWeb(
    new Request("http://example.com/hello?lang=en", {
      headers: { host: "example.com", cookie: "id=1" },
    }),
  ),
) =>
  Effect.gen(function* () {
    yield* Warc.recordServer(Effect.succeed(response)).pipe(
      Effect.provideService(HttpServerRequest.HttpServerRequest, request),
    );
    return yield* recorded;
  }).pipe(Effect.provide(Warc.layerRecorder));

describe("Warc.recordServer", () => {
  it.effect("records the exchange it serves", () =>
    Effect.gen(function* () {
      const all = yield* serve(
        HttpServerResponse.text("hi", { status: 202, statusText: "Accepted" }),
      );
      const responseRecord = nth(all, 0);
      const requestRecord = nth(all, 1);
      expect(Warc.field(responseRecord, "WARC-Target-URI")).toStrictEqual(
        Option.some("http://example.com/hello?lang=en"),
      );
      expect(text(responseRecord.block)).toMatch(
        /^HTTP\/1\.1 202 Accepted\r\n[^]*content-type: text\/plain[^]*\r\n\r\nhi$/,
      );
      const requestBlock = text(requestRecord.block);
      expect(requestBlock).toMatch(/^GET \/hello\?lang=en HTTP\/1\.1\r\n/);
      expect(requestBlock).toContain("cookie: <redacted>\r\n");
      expect(Warc.field(requestRecord, "WARC-Truncated")).toStrictEqual(Option.none());
    }),
  );

  it.effect("marks a request body it did not read, and a streamed response body", () =>
    Effect.gen(function* () {
      const all = yield* serve(
        HttpServerResponse.stream(Stream.make(new Uint8Array([1])), {
          contentType: "application/octet-stream",
        }),
        HttpServerRequest.fromWeb(
          new Request("https://example.com/upload", {
            method: "POST",
            headers: { host: "example.com", "content-length": "3" },
            body: "abc",
          }),
        ),
      );
      const responseRecord = nth(all, 0);
      const requestRecord = nth(all, 1);
      expect(Warc.field(requestRecord, "WARC-Truncated")).toStrictEqual(Option.some("unspecified"));
      expect(Warc.field(responseRecord, "WARC-Truncated")).toStrictEqual(
        Option.some("unspecified"),
      );
      expect(text(responseRecord.block)).toMatch(/content-length: 0\r\n\r\n$/);
    }),
  );
});
