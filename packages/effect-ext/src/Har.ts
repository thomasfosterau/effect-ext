/**
 * HTTP Archive (HAR 1.2) documents: a schema to read them, a recorder that
 * writes `HttpClient` and `HttpServer` exchanges into one, and a client that
 * replays one.
 *
 * Recorded headers and query parameters named in `Headers.CurrentRedactedNames`
 * / `UrlParams.CurrentRedactedNames` are written as `"<redacted>"`.
 *
 * @since 0.5.0
 */
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as HttpBody from "effect/http/HttpBody";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientError from "effect/http/HttpClientError";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import {
  captureClient,
  recordingServer,
  type Exchange,
  hasNullBody,
  isTextual,
  redactedHeaders,
  redactedQuery,
  bodyBytes,
  contentTypeOf,
} from "./internal/http-exchange.ts";

const comment = { comment: Schema.optionalKey(Schema.String) };

/**
 * A header, query parameter or cookie-less name and value.
 *
 * @example
 * ```ts
 * import * as Schema from "effect/Schema"
 * import { Har } from "@thomasfosterau/effect-ext"
 *
 * console.log(Schema.decodeUnknownSync(Har.NameValue)({ name: "accept", value: "*\/*" }).name) // "accept"
 * ```
 *
 * @since 0.5.0
 * @category schemas
 */
export const NameValue = Schema.Struct({ name: Schema.String, value: Schema.String, ...comment });

/**
 * A {@link NameValue}.
 *
 * @since 0.5.0
 * @category models
 */
export type NameValue = typeof NameValue.Type;

/**
 * A cookie sent or set, with the attributes HAR records.
 *
 * @example
 * ```ts
 * import * as Schema from "effect/Schema"
 * import { Har } from "@thomasfosterau/effect-ext"
 *
 * const cookie = Schema.decodeUnknownSync(Har.Cookie)({ name: "id", value: "1", httpOnly: true })
 * console.log(cookie.httpOnly) // true
 * ```
 *
 * @since 0.5.0
 * @category schemas
 */
export const Cookie = Schema.Struct({
  name: Schema.String,
  value: Schema.String,
  path: Schema.optionalKey(Schema.String),
  domain: Schema.optionalKey(Schema.String),
  expires: Schema.optionalKey(Schema.String),
  httpOnly: Schema.optionalKey(Schema.Boolean),
  secure: Schema.optionalKey(Schema.Boolean),
  ...comment,
});

/**
 * A {@link Cookie}.
 *
 * @since 0.5.0
 * @category models
 */
export type Cookie = typeof Cookie.Type;

/**
 * A request body: its `mimeType`, and its `text` or, for a form, its
 * `params`.
 *
 * @example
 * ```ts
 * import * as Schema from "effect/Schema"
 * import { Har } from "@thomasfosterau/effect-ext"
 *
 * const body = Schema.decodeUnknownSync(Har.PostData)({ mimeType: "text/plain", text: "hi" })
 * console.log(body.text) // "hi"
 * ```
 *
 * @since 0.5.0
 * @category schemas
 */
export const PostData = Schema.Struct({
  mimeType: Schema.String,
  text: Schema.optionalKey(Schema.String),
  params: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        name: Schema.String,
        value: Schema.optionalKey(Schema.String),
        fileName: Schema.optionalKey(Schema.String),
        contentType: Schema.optionalKey(Schema.String),
        ...comment,
      }),
    ),
  ),
  ...comment,
});

/**
 * A {@link PostData}.
 *
 * @since 0.5.0
 * @category models
 */
export type PostData = typeof PostData.Type;

/**
 * A recorded request. `headersSize` and `bodySize` are `-1` where unknown.
 *
 * @example
 * ```ts
 * import * as Schema from "effect/Schema"
 * import { Har } from "@thomasfosterau/effect-ext"
 *
 * const request = Schema.decodeUnknownSync(Har.Request)({
 *   method: "GET",
 *   url: "https://example.com/",
 *   httpVersion: "HTTP/1.1",
 *   cookies: [],
 *   headers: [],
 *   queryString: [],
 *   headersSize: -1,
 *   bodySize: 0,
 * })
 * console.log(request.method) // "GET"
 * ```
 *
 * @since 0.5.0
 * @category schemas
 */
export const Request = Schema.Struct({
  method: Schema.String,
  url: Schema.String,
  httpVersion: Schema.String,
  cookies: Schema.Array(Cookie),
  headers: Schema.Array(NameValue),
  queryString: Schema.Array(NameValue),
  postData: Schema.optionalKey(PostData),
  headersSize: Schema.Finite,
  bodySize: Schema.Finite,
  ...comment,
});

/**
 * A {@link Request}.
 *
 * @since 0.5.0
 * @category models
 */
export type Request = typeof Request.Type;

/**
 * A response body. `text` is the body as text, or base64 where `encoding`
 * says so; it is absent where the body was not recorded.
 *
 * @example
 * ```ts
 * import * as Schema from "effect/Schema"
 * import { Har } from "@thomasfosterau/effect-ext"
 *
 * const content = Schema.decodeUnknownSync(Har.Content)({ size: 2, mimeType: "text/plain", text: "ok" })
 * console.log(content.text) // "ok"
 * ```
 *
 * @since 0.5.0
 * @category schemas
 */
export const Content = Schema.Struct({
  size: Schema.Finite,
  compression: Schema.optionalKey(Schema.Finite),
  mimeType: Schema.String,
  text: Schema.optionalKey(Schema.String),
  encoding: Schema.optionalKey(Schema.String),
  ...comment,
});

/**
 * A {@link Content}.
 *
 * @since 0.5.0
 * @category models
 */
export type Content = typeof Content.Type;

/**
 * A recorded response.
 *
 * @example
 * ```ts
 * import * as Schema from "effect/Schema"
 * import { Har } from "@thomasfosterau/effect-ext"
 *
 * const response = Schema.decodeUnknownSync(Har.Response)({
 *   status: 204,
 *   statusText: "No Content",
 *   httpVersion: "HTTP/1.1",
 *   cookies: [],
 *   headers: [],
 *   content: { size: 0, mimeType: "" },
 *   redirectURL: "",
 *   headersSize: -1,
 *   bodySize: 0,
 * })
 * console.log(response.status) // 204
 * ```
 *
 * @since 0.5.0
 * @category schemas
 */
export const Response = Schema.Struct({
  status: Schema.Finite,
  statusText: Schema.String,
  httpVersion: Schema.String,
  cookies: Schema.Array(Cookie),
  headers: Schema.Array(NameValue),
  content: Content,
  redirectURL: Schema.String,
  headersSize: Schema.Finite,
  bodySize: Schema.Finite,
  ...comment,
});

/**
 * A {@link Response}.
 *
 * @since 0.5.0
 * @category models
 */
export type Response = typeof Response.Type;

const CacheEntry = Schema.Struct({
  expires: Schema.optionalKey(Schema.String),
  lastAccess: Schema.String,
  eTag: Schema.String,
  hitCount: Schema.Finite,
  ...comment,
});

/**
 * The phases of an exchange, in milliseconds; `-1` where a phase does not
 * apply. `send`, `wait` and `receive` are required.
 *
 * @example
 * ```ts
 * import * as Schema from "effect/Schema"
 * import { Har } from "@thomasfosterau/effect-ext"
 *
 * const timings = Schema.decodeUnknownSync(Har.Timings)({ send: 0, wait: 12, receive: 1 })
 * console.log(timings.wait) // 12
 * ```
 *
 * @since 0.5.0
 * @category schemas
 */
export const Timings = Schema.Struct({
  blocked: Schema.optionalKey(Schema.Finite),
  dns: Schema.optionalKey(Schema.Finite),
  connect: Schema.optionalKey(Schema.Finite),
  send: Schema.Finite,
  wait: Schema.Finite,
  receive: Schema.Finite,
  ssl: Schema.optionalKey(Schema.Finite),
  ...comment,
});

/**
 * A {@link Timings}.
 *
 * @since 0.5.0
 * @category models
 */
export type Timings = typeof Timings.Type;

/**
 * One exchange: when it started (RFC 3339), how long it took in
 * milliseconds, its request and response, and its timings.
 *
 * @example
 * ```ts
 * import * as Schema from "effect/Schema"
 * import { Har } from "@thomasfosterau/effect-ext"
 *
 * console.log(Schema.isSchema(Har.Entry)) // true
 * ```
 *
 * @since 0.5.0
 * @category schemas
 */
export const Entry = Schema.Struct({
  pageref: Schema.optionalKey(Schema.String),
  startedDateTime: Schema.String,
  time: Schema.Finite,
  request: Request,
  response: Response,
  cache: Schema.Struct({
    beforeRequest: Schema.optionalKey(Schema.NullOr(CacheEntry)),
    afterRequest: Schema.optionalKey(Schema.NullOr(CacheEntry)),
    ...comment,
  }),
  timings: Timings,
  serverIPAddress: Schema.optionalKey(Schema.String),
  connection: Schema.optionalKey(Schema.String),
  ...comment,
});

/**
 * An {@link Entry}.
 *
 * @since 0.5.0
 * @category models
 */
export type Entry = typeof Entry.Type;

/**
 * A page a browser loaded, which entries refer to by `id` (`pageref`).
 *
 * @example
 * ```ts
 * import * as Schema from "effect/Schema"
 * import { Har } from "@thomasfosterau/effect-ext"
 *
 * const page = Schema.decodeUnknownSync(Har.Page)({
 *   startedDateTime: "2026-01-01T00:00:00.000Z",
 *   id: "page_1",
 *   title: "Home",
 *   pageTimings: { onLoad: 120 },
 * })
 * console.log(page.pageTimings.onLoad) // 120
 * ```
 *
 * @since 0.5.0
 * @category schemas
 */
export const Page = Schema.Struct({
  startedDateTime: Schema.String,
  id: Schema.String,
  title: Schema.String,
  pageTimings: Schema.Struct({
    onContentLoad: Schema.optionalKey(Schema.Finite),
    onLoad: Schema.optionalKey(Schema.Finite),
    ...comment,
  }),
  ...comment,
});

/**
 * A {@link Page}.
 *
 * @since 0.5.0
 * @category models
 */
export type Page = typeof Page.Type;

/**
 * The application that wrote a document (`creator`) or the browser it
 * recorded (`browser`).
 *
 * @example
 * ```ts
 * import * as Schema from "effect/Schema"
 * import { Har } from "@thomasfosterau/effect-ext"
 *
 * console.log(Schema.decodeUnknownSync(Har.Creator)({ name: "my-app", version: "1.0" }).name) // "my-app"
 * ```
 *
 * @since 0.5.0
 * @category schemas
 */
export const Creator = Schema.Struct({ name: Schema.String, version: Schema.String, ...comment });

/**
 * A {@link Creator}.
 *
 * @since 0.5.0
 * @category models
 */
export type Creator = typeof Creator.Type;

/**
 * A HAR document: `{ log }`. Members HAR 1.2 does not define (the `_`
 * custom fields browsers add) are dropped on decode.
 *
 * @example
 * ```ts
 * import * as Schema from "effect/Schema"
 * import { Har } from "@thomasfosterau/effect-ext"
 *
 * const har = Schema.decodeUnknownSync(Har.Har)({
 *   log: { version: "1.2", creator: { name: "my-app", version: "1.0" }, entries: [] },
 * })
 * console.log(har.log.version) // "1.2"
 * ```
 *
 * @since 0.5.0
 * @category schemas
 */
export const Har = Schema.Struct({
  log: Schema.Struct({
    version: Schema.String,
    creator: Creator,
    browser: Schema.optionalKey(Creator),
    pages: Schema.optionalKey(Schema.Array(Page)),
    entries: Schema.Array(Entry),
    ...comment,
  }),
});

/**
 * A {@link Har} document.
 *
 * @since 0.5.0
 * @category models
 */
export type Har = typeof Har.Type;

/**
 * Text that is not a HAR document: `InvalidJson`, or `NotAHar` (JSON whose
 * shape is not HAR 1.2), with the reason in `message`.
 *
 * @example
 * ```ts
 * import { Har } from "@thomasfosterau/effect-ext"
 *
 * const error = new Har.HarError({ reason: "NotAHar", message: "Missing key at [\"log\"]" })
 * console.log(error.reason) // "NotAHar"
 * ```
 *
 * @since 0.5.0
 * @category errors
 */
export class HarError extends Schema.TaggedError<HarError, { readonly brand: unique symbol }>()(
  "HarError",
  {
    reason: Schema.Literals(["InvalidJson", "NotAHar"]),
    message: Schema.String,
  },
) {}

const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const decodeHar = Schema.decodeUnknownEffect(Har);
const encodeHarJson = Schema.encodeSync(Schema.fromJsonString(Har, { space: 2 }));

/**
 * Reads a HAR document from its JSON text.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Har } from "@thomasfosterau/effect-ext"
 *
 * const text = JSON.stringify({
 *   log: { version: "1.2", creator: { name: "devtools", version: "1" }, entries: [] },
 * })
 * Effect.runPromise(Har.parse(text)).then((har) => console.log(har.log.creator.name)) // "devtools"
 * ```
 *
 * @since 0.5.0
 * @category parsing
 */
export const parse = (text: string): Effect.Effect<Har, HarError> =>
  decodeJson(text).pipe(
    Effect.mapError((error) => new HarError({ reason: "InvalidJson", message: error.message })),
    Effect.flatMap((json) =>
      Effect.mapError(
        decodeHar(json),
        (error) => new HarError({ reason: "NotAHar", message: error.message }),
      ),
    ),
  );

/**
 * Writes a HAR document as JSON text, indented by two spaces.
 *
 * @example
 * ```ts
 * import { Har } from "@thomasfosterau/effect-ext"
 *
 * const text = Har.stringify(Har.make({ creator: { name: "my-app", version: "1.0" }, entries: [] }))
 * console.log(text.startsWith("{\n  \"log\"")) // true
 * ```
 *
 * @since 0.5.0
 * @category printing
 */
export const stringify = (har: Har): string => encodeHarJson(har);

/**
 * Builds a HAR 1.2 document.
 *
 * @example
 * ```ts
 * import { Har } from "@thomasfosterau/effect-ext"
 *
 * const har = Har.make({ creator: { name: "my-app", version: "1.0" }, entries: [] })
 * console.log(har.log.version) // "1.2"
 * ```
 *
 * @since 0.5.0
 * @category constructors
 */
export const make = (options: {
  readonly creator: Creator;
  readonly entries: ReadonlyArray<Entry>;
  readonly pages?: ReadonlyArray<Page>;
}): Har => {
  const log = { version: "1.2", creator: options.creator, entries: options.entries };
  return { log: options.pages === undefined ? log : { ...log, pages: options.pages } };
};

const nameValues = (pairs: ReadonlyArray<readonly [string, string]>): ReadonlyArray<NameValue> =>
  Arr.map(pairs, ([name, value]) => ({ name, value }));

const decoder = () => new TextDecoder();
const encodeBase64 = Schema.encodeSync(Schema.Uint8ArrayFromBase64);
const decodeBase64 = Schema.decodeSync(Schema.Uint8ArrayFromBase64);

const contentOf = (bytes: Uint8Array, mimeType: string): Content =>
  bytes.byteLength === 0
    ? { size: 0, mimeType, text: "" }
    : isTextual(mimeType)
      ? { size: bytes.byteLength, mimeType, text: decoder().decode(bytes) }
      : { size: bytes.byteLength, mimeType, text: encodeBase64(bytes), encoding: "base64" };

const postDataOf = (body: HttpBody.HttpBody): Pick<Request, "postData" | "bodySize"> =>
  Option.match(bodyBytes(body), {
    onNone: () => ({
      postData: { mimeType: contentTypeOf(body), comment: `${body._tag} body not recorded` },
      bodySize: -1,
    }),
    onSome: (bytes) =>
      bytes.byteLength === 0
        ? { bodySize: 0 }
        : {
            postData: {
              mimeType: contentTypeOf(body),
              text: isTextual(contentTypeOf(body)) ? decoder().decode(bytes) : encodeBase64(bytes),
            },
            bodySize: bytes.byteLength,
          },
  });

const entryOf = (exchange: Exchange): Effect.Effect<Entry> =>
  Effect.gen(function* () {
    const mimeType = exchange.responseHeaders["content-type"] ?? "";
    const location = exchange.responseHeaders.location ?? "";
    return {
      startedDateTime: DateTime.formatIso(exchange.started),
      time: exchange.time,
      request: {
        method: exchange.method,
        url: exchange.url,
        httpVersion: "HTTP/1.1",
        cookies: [],
        headers: nameValues(yield* redactedHeaders(exchange.requestHeaders)),
        queryString: nameValues(yield* redactedQuery(exchange.query)),
        headersSize: -1,
        ...postDataOf(exchange.requestBody),
      },
      response: {
        status: exchange.status,
        statusText: Option.getOrElse(exchange.statusText, () => ""),
        httpVersion: "HTTP/1.1",
        cookies: [],
        headers: nameValues(yield* redactedHeaders(exchange.responseHeaders)),
        content: Option.match(exchange.responseBody, {
          onNone: () => ({ size: -1, mimeType, comment: "Stream body not recorded" }),
          onSome: (bytes) => contentOf(bytes, mimeType),
        }),
        redirectURL: location,
        headersSize: -1,
        bodySize: Option.match(exchange.responseBody, {
          onNone: () => -1,
          onSome: (bytes) => bytes.byteLength,
        }),
      },
      cache: {},
      timings: { send: 0, wait: exchange.time, receive: 0 },
    };
  });

/**
 * Collects HAR entries. {@link recordClient} and {@link recordServer} add
 * one per exchange; {@link Recorder.har} is everything so far, as a
 * document.
 *
 * @since 0.5.0
 * @category services
 */
export class Recorder extends Context.Service<
  Recorder,
  {
    readonly add: (entry: Entry) => Effect.Effect<void>;
    readonly entries: Effect.Effect<ReadonlyArray<Entry>>;
    readonly clear: Effect.Effect<void>;
    readonly har: (creator: Creator) => Effect.Effect<Har>;
  }
>()("@thomasfosterau/effect-ext/Har/Recorder") {}

/**
 * Builds an in-memory {@link Recorder}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Har } from "@thomasfosterau/effect-ext"
 *
 * const program = Effect.gen(function* () {
 *   const recorder = yield* Har.makeRecorder
 *   return yield* recorder.har({ name: "my-app", version: "1.0" })
 * })
 * Effect.runPromise(program).then((har) => console.log(har.log.entries.length)) // 0
 * ```
 *
 * @since 0.5.0
 * @category constructors
 */
export const makeRecorder: Effect.Effect<Recorder["Service"]> = Effect.map(
  Ref.make<ReadonlyArray<Entry>>([]),
  (ref) =>
    Recorder.of({
      add: (entry) => Ref.update(ref, Arr.append(entry)),
      entries: Ref.get(ref),
      clear: Ref.set(ref, []),
      har: (creator) => Effect.map(Ref.get(ref), (entries) => make({ creator, entries })),
    }),
);

/**
 * A fresh in-memory {@link Recorder}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Har } from "@thomasfosterau/effect-ext"
 *
 * const program = Effect.flatMap(Har.Recorder, (recorder) => recorder.entries)
 * Effect.runPromise(Effect.provide(program, Har.layerRecorder)).then((entries) => console.log(entries)) // []
 * ```
 *
 * @since 0.5.0
 * @category layers
 */
export const layerRecorder: Layer.Layer<Recorder> = Layer.effect(Recorder, makeRecorder);

/**
 * Records each exchange `client` makes into the {@link Recorder}, then
 * returns the response as it arrived. The response body is read in full to
 * record it, so a streamed response arrives buffered; a request body that is
 * a stream or form data is noted but not recorded. A request that fails
 * before a response is not recorded.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as HttpClient from "effect/http/HttpClient"
 * import * as HttpClientResponse from "effect/http/HttpClientResponse"
 * import { Har } from "@thomasfosterau/effect-ext"
 *
 * const stub = HttpClient.make((request) =>
 *   Effect.succeed(HttpClientResponse.fromWeb(request, new Response("hello"))),
 * )
 * const program = Effect.gen(function* () {
 *   const client = yield* Har.recordClient(stub)
 *   yield* client.get("https://example.com/greeting")
 *   const recorder = yield* Har.Recorder
 *   return yield* recorder.entries
 * })
 * Effect.runPromise(Effect.provide(program, Har.layerRecorder)).then((entries) =>
 *   console.log(entries[0]?.response.content.text), // "hello"
 * )
 * ```
 *
 * @since 0.5.0
 * @category recording
 */
export const recordClient = <E, R>(
  client: HttpClient.HttpClient.With<E, R>,
): Effect.Effect<
  HttpClient.HttpClient.With<E | HttpClientError.HttpClientError, R>,
  never,
  Recorder
> =>
  Effect.map(Effect.service(Recorder), (recorder) =>
    captureClient(client, (exchange) => Effect.flatMap(entryOf(exchange), recorder.add)),
  );

/**
 * Server middleware that records each request it serves into the
 * {@link Recorder}. Request bodies are not read (that would consume them
 * before the handler), so `postData` is absent; a response body is recorded
 * unless it is a stream or form data.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as HttpServerRequest from "effect/http/HttpServerRequest"
 * import * as HttpServerResponse from "effect/http/HttpServerResponse"
 * import { Har } from "@thomasfosterau/effect-ext"
 *
 * const app = Har.recordServer(Effect.succeed(HttpServerResponse.text("hi")))
 * const program = Effect.gen(function* () {
 *   yield* app
 *   const recorder = yield* Har.Recorder
 *   return yield* recorder.entries
 * }).pipe(
 *   Effect.provideService(
 *     HttpServerRequest.HttpServerRequest,
 *     HttpServerRequest.fromWeb(new Request("https://example.com/hello")),
 *   ),
 * )
 * Effect.runPromise(Effect.provide(program, Har.layerRecorder)).then((entries) =>
 *   console.log(entries[0]?.request.url), // "https://example.com/hello"
 * )
 * ```
 *
 * @since 0.5.0
 * @category recording
 */
export const recordServer = recordingServer(Recorder, (recorder, exchange) =>
  Effect.flatMap(entryOf(exchange), recorder.add),
);

/** Whether an entry answers `request`: the same method and URL, the query included. */
const answers = (entry: Entry, method: string, url: string): boolean =>
  entry.request.method === method && entry.request.url === url;

const responseBody = (content: Content): Option.Option<Uint8Array<ArrayBuffer> | string> =>
  Option.map(Option.fromUndefinedOr(content.text), (text) =>
    content.encoding === "base64" ? new Uint8Array(decodeBase64(text)) : text,
  );

/**
 * An `HttpClient` that answers each request from `har`: the first entry
 * with the same method and URL (query included), or a `TransportError`
 * where none matches. Status, headers and body are the entry's response.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Har } from "@thomasfosterau/effect-ext"
 *
 * const har = Har.make({
 *   creator: { name: "fixture", version: "1" },
 *   entries: [
 *     {
 *       startedDateTime: "2026-01-01T00:00:00.000Z",
 *       time: 1,
 *       request: {
 *         method: "GET",
 *         url: "https://example.com/hello",
 *         httpVersion: "HTTP/1.1",
 *         cookies: [],
 *         headers: [],
 *         queryString: [],
 *         headersSize: -1,
 *         bodySize: 0,
 *       },
 *       response: {
 *         status: 200,
 *         statusText: "OK",
 *         httpVersion: "HTTP/1.1",
 *         cookies: [],
 *         headers: [{ name: "content-type", value: "text/plain" }],
 *         content: { size: 5, mimeType: "text/plain", text: "hello" },
 *         redirectURL: "",
 *         headersSize: -1,
 *         bodySize: 5,
 *       },
 *       cache: {},
 *       timings: { send: 0, wait: 1, receive: 0 },
 *     },
 *   ],
 * })
 * const program = Effect.flatMap(Har.replayClient(har).get("https://example.com/hello"), (r) => r.text)
 * Effect.runPromise(program).then(console.log) // "hello"
 * ```
 *
 * @since 0.5.0
 * @category replay
 */
export const replayClient = (har: Har): HttpClient.HttpClient =>
  HttpClient.make((request, url) =>
    Option.match(
      Arr.findFirst(har.log.entries, (entry) => answers(entry, request.method, url.href)),
      {
        onNone: () =>
          Effect.fail(
            new HttpClientError.HttpClientError({
              reason: new HttpClientError.TransportError({
                request,
                description: `No HAR entry for ${request.method} ${url.href}`,
              }),
            }),
          ),
        onSome: ({ response }) =>
          Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              new globalThis.Response(
                hasNullBody(response.status)
                  ? null
                  : Option.getOrNull(responseBody(response.content)),
                {
                  status: response.status,
                  statusText: response.statusText,
                  headers: Arr.map(response.headers, ({ name, value }) => [name, value] as const),
                },
              ),
            ),
          ),
      },
    ),
  );
