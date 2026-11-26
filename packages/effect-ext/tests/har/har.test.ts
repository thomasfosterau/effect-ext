/**
 * HAR 1.2: reading and writing documents, recording client and server
 * exchanges, and replaying a document as a client.
 */
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Headers from "effect/http/Headers";
import * as HttpBody from "effect/http/HttpBody";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientError from "effect/http/HttpClientError";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as UrlParams from "effect/http/UrlParams";
import * as Har from "@thomasfosterau/effect-ext/Har";

const CREATOR = { name: "test", version: "1.0" };

const entry = (overrides: {
  readonly url: string;
  readonly method?: string;
  readonly status?: number;
  readonly content?: Har.Content;
}): Har.Entry => ({
  startedDateTime: "2026-01-01T00:00:00.000Z",
  time: 1,
  request: {
    method: overrides.method ?? "GET",
    url: overrides.url,
    httpVersion: "HTTP/1.1",
    cookies: [],
    headers: [],
    queryString: [],
    headersSize: -1,
    bodySize: 0,
  },
  response: {
    status: overrides.status ?? 200,
    statusText: "OK",
    httpVersion: "HTTP/1.1",
    cookies: [],
    headers: [{ name: "content-type", value: overrides.content?.mimeType ?? "text/plain" }],
    content: overrides.content ?? { size: 5, mimeType: "text/plain", text: "hello" },
    redirectURL: "",
    headersSize: -1,
    bodySize: 5,
  },
  cache: {},
  timings: { send: 0, wait: 1, receive: 0 },
});

/** A client answering every request with `respond`'s response. */
const stub = (respond: (request: HttpClientRequest.HttpClientRequest) => Response) =>
  HttpClient.make((request) =>
    Effect.succeed(HttpClientResponse.fromWeb(request, respond(request))),
  );

const toJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const recorded = Effect.flatMap(Har.Recorder, (recorder) => recorder.entries);

describe("Har.parse / stringify", () => {
  it.effect("reads a browser's export, dropping its custom fields", () =>
    Effect.gen(function* () {
      const text = toJson({
        log: {
          version: "1.2",
          creator: { name: "WebInspector", version: "537.36" },
          pages: [
            {
              startedDateTime: "2026-01-01T00:00:00.000Z",
              id: "page_1",
              title: "Home",
              pageTimings: { onContentLoad: 50, onLoad: 120 },
            },
          ],
          entries: [{ ...entry({ url: "https://example.com/" }), _initiator: { type: "parser" } }],
        },
      });
      const har = yield* Har.parse(text);
      expect(har.log.pages?.[0]?.pageTimings.onLoad).toBe(120);
      expect(har.log.entries[0]).not.toHaveProperty("_initiator");
      expect(yield* Har.parse(Har.stringify(har))).toStrictEqual(har);
    }),
  );

  it.effect("fails text that is not JSON, or not HAR", () =>
    Effect.gen(function* () {
      const notJson = yield* Effect.flip(Har.parse("{"));
      const notHar = yield* Effect.flip(Har.parse(toJson({ log: { version: "1.2" } })));
      expect([notJson.reason, notHar.reason]).toStrictEqual(["InvalidJson", "NotAHar"]);
      expect(notHar.message).toContain("creator");
    }),
  );

  it("prints two-space JSON, with pages only when given", () => {
    const page = {
      startedDateTime: "2026-01-01T00:00:00.000Z",
      id: "p",
      title: "P",
      pageTimings: {},
    };
    expect(Har.stringify(Har.make({ creator: CREATOR, entries: [] }))).toBe(
      '{\n  "log": {\n    "version": "1.2",\n    "creator": {\n      "name": "test",\n      "version": "1.0"\n    },\n    "entries": []\n  }\n}',
    );
    expect(Har.make({ creator: CREATOR, entries: [], pages: [page] }).log.pages).toStrictEqual([
      page,
    ]);
  });
});

describe("Har.recordClient", () => {
  it.effect("records the exchange and still returns the body", () =>
    Effect.gen(function* () {
      const client = yield* Har.recordClient(
        stub(
          () =>
            new Response('{"ok":true}', {
              status: 201,
              headers: { "content-type": "application/json", "set-cookie": "id=1" },
            }),
        ),
      );
      const response = yield* client.execute(
        HttpClientRequest.post("https://example.com/items", {
          urlParams: { page: "2", token: "secret" },
          headers: { authorization: "Bearer secret", accept: "application/json" },
          body: HttpBody.text("hello", "text/plain"),
        }),
      );
      expect(yield* response.json).toStrictEqual({ ok: true });
      const [first] = yield* recorded;
      expect(first?.request).toMatchObject({
        method: "POST",
        url: "https://example.com/items",
        queryString: [
          { name: "page", value: "2" },
          { name: "token", value: "<redacted>" },
        ],
        headers: expect.arrayContaining([
          { name: "authorization", value: "<redacted>" },
          { name: "accept", value: "application/json" },
        ]),
        postData: { mimeType: "text/plain", text: "hello" },
        bodySize: 5,
      });
      expect(first?.response).toMatchObject({
        status: 201,
        content: { size: 11, mimeType: "application/json", text: '{"ok":true}' },
        headers: expect.arrayContaining([{ name: "set-cookie", value: "<redacted>" }]),
      });
      expect(first?.time).toBeGreaterThanOrEqual(0);
    }).pipe(
      Effect.provideService(UrlParams.CurrentRedactedNames, ["token"]),
      Effect.provide(Har.layerRecorder),
    ),
  );

  it.effect("records binary bodies as base64, and notes a streamed request body", () =>
    Effect.gen(function* () {
      const client = yield* Har.recordClient(
        stub(
          () =>
            new Response(new Uint8Array([0, 1, 2]), {
              headers: { "content-type": "application/octet-stream", location: "/next" },
            }),
        ),
      );
      yield* client.execute(
        HttpClientRequest.post("https://example.com/upload", {
          body: HttpBody.uint8Array(new Uint8Array([255]), "image/png"),
        }),
      );
      yield* client.execute(
        HttpClientRequest.post("https://example.com/stream", {
          body: HttpBody.stream(Stream.make(new Uint8Array([1])), "application/octet-stream"),
        }),
      );
      yield* client.execute(
        HttpClientRequest.post("https://example.com/raw", {
          body: HttpBody.raw("raw text", { contentType: "text/plain" }),
        }),
      );
      yield* client.execute(
        HttpClientRequest.post("https://example.com/raw-bytes", {
          body: HttpBody.raw(new Uint8Array([104, 105]), { contentType: "text/plain" }),
        }),
      );
      yield* client.execute(
        HttpClientRequest.post("https://example.com/raw-other", {
          body: HttpBody.raw({ some: "object" }),
        }),
      );
      const form = new FormData();
      form.append("field", "value");
      yield* client.execute(
        HttpClientRequest.post("https://example.com/form", { body: HttpBody.formData(form) }),
      );
      yield* client.get("https://example.com/empty");
      const entries = yield* recorded;
      expect(entries.map((e) => [e.request.postData, e.request.bodySize])).toStrictEqual([
        [{ mimeType: "image/png", text: "/w==" }, 1],
        [{ mimeType: "application/octet-stream", comment: "Stream body not recorded" }, -1],
        [{ mimeType: "text/plain", text: "raw text" }, 8],
        [{ mimeType: "text/plain", text: "hi" }, 2],
        [{ mimeType: "", comment: "Raw body not recorded" }, -1],
        [{ mimeType: "", comment: "FormData body not recorded" }, -1],
        [undefined, 0],
      ]);
      expect(entries[0]?.response.content).toStrictEqual({
        size: 3,
        mimeType: "application/octet-stream",
        text: "AAEC",
        encoding: "base64",
      });
      expect(entries[0]?.response.redirectURL).toBe("/next");
    }).pipe(Effect.provide(Har.layerRecorder)),
  );

  it.effect("records an empty response body as empty text", () =>
    Effect.gen(function* () {
      const client = yield* Har.recordClient(stub(() => new Response(null, { status: 204 })));
      yield* client.get("https://example.com/none");
      const recorder = yield* Har.Recorder;
      const har = yield* recorder.har(CREATOR);
      expect(har.log.entries[0]?.response.content).toStrictEqual({
        size: 0,
        mimeType: "",
        text: "",
      });
      yield* recorder.clear;
      expect(yield* recorder.entries).toStrictEqual([]);
    }).pipe(Effect.provide(Har.layerRecorder)),
  );
});

/** Serves `response` through the recording middleware, returning its entry. */
const serve = (
  response: HttpServerResponse.HttpServerResponse,
  request = HttpServerRequest.fromWeb(
    new Request("https://example.com/hello?lang=en", {
      headers: { host: "example.com", cookie: "id=1" },
    }),
  ),
) =>
  Effect.gen(function* () {
    yield* Har.recordServer(Effect.succeed(response)).pipe(
      Effect.provideService(HttpServerRequest.HttpServerRequest, request),
    );
    const [first] = yield* recorded;
    return first;
  }).pipe(Effect.provide(Har.layerRecorder));

describe("Har.recordServer", () => {
  it.effect("records the request line, headers and the response body", () =>
    Effect.gen(function* () {
      const first = yield* serve(
        HttpServerResponse.text("hi", { status: 202, statusText: "Accepted" }),
      );
      expect(first?.request).toMatchObject({
        method: "GET",
        url: "https://example.com/hello?lang=en",
        queryString: [{ name: "lang", value: "en" }],
        headers: expect.arrayContaining([{ name: "cookie", value: "<redacted>" }]),
        bodySize: 0,
      });
      expect(first?.request).not.toHaveProperty("postData");
      expect(first?.response).toMatchObject({
        status: 202,
        statusText: "Accepted",
        content: { size: 2, mimeType: "text/plain", text: "hi" },
      });
    }),
  );

  it.effect("notes a streamed response body", () =>
    Effect.gen(function* () {
      const first = yield* serve(
        HttpServerResponse.stream(Stream.make(new Uint8Array([1])), {
          contentType: "application/octet-stream",
        }),
      );
      expect(first?.response.content).toStrictEqual({
        size: -1,
        mimeType: "application/octet-stream",
        comment: "Stream body not recorded",
      });
      expect(first?.response.bodySize).toBe(-1);
    }),
  );

  it.effect("falls back to the request's own URL where it cannot be resolved", () =>
    Effect.gen(function* () {
      const request = HttpServerRequest.fromWeb(new Request("https://example.com/")).modify({
        url: "http://[",
      });
      const first = yield* serve(HttpServerResponse.empty(), request);
      expect(first?.request.url).toBe("https://example.com/");
    }),
  );

  it.effect("records a response with no body", () =>
    Effect.gen(function* () {
      const first = yield* serve(HttpServerResponse.empty({ status: 204 }));
      expect([
        first?.response.status,
        first?.response.statusText,
        first?.response.content,
      ]).toStrictEqual([204, "", { size: 0, mimeType: "", text: "" }]);
    }),
  );
});

describe("Har.replayClient", () => {
  const har = Har.make({
    creator: CREATOR,
    entries: [
      entry({ url: "https://example.com/hello" }),
      entry({
        url: "https://example.com/bytes?x=1",
        content: {
          size: 3,
          mimeType: "application/octet-stream",
          text: "AAEC",
          encoding: "base64",
        },
      }),
      entry({ url: "https://example.com/gone", method: "DELETE", status: 204 }),
      entry({
        url: "https://example.com/unrecorded",
        content: { size: -1, mimeType: "text/plain" },
      }),
    ],
  });
  const client = Har.replayClient(har);

  it.effect("answers from the matching entry", () =>
    Effect.gen(function* () {
      const hello = yield* client.get("https://example.com/hello");
      const bytes = yield* client.get("https://example.com/bytes", { urlParams: { x: "1" } });
      const gone = yield* client.del("https://example.com/gone");
      const unrecorded = yield* client.get("https://example.com/unrecorded");
      expect({
        hello: [hello.status, yield* hello.text, hello.headers["content-type"]],
        bytes: Array.from(new Uint8Array(yield* bytes.arrayBuffer)),
        gone: gone.status,
        unrecorded: yield* unrecorded.text,
      }).toStrictEqual({
        hello: [200, "hello", "text/plain"],
        bytes: [0, 1, 2],
        gone: 204,
        unrecorded: "",
      });
    }),
  );

  it.effect("fails a request no entry answers", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(client.post("https://example.com/hello"));
      expect(HttpClientError.isHttpClientError(error)).toBe(true);
      expect(error.reason._tag).toBe("TransportError");
      expect(error.message).toContain("No HAR entry for POST https://example.com/hello");
    }),
  );

  it.effect("round-trips a recording", () =>
    Effect.gen(function* () {
      const recording = yield* Har.recordClient(stub(() => new Response("recorded")));
      yield* recording.get("https://example.com/a");
      const replayed = Har.replayClient(yield* Effect.flatMap(Har.Recorder, (r) => r.har(CREATOR)));
      const response = yield* replayed.get("https://example.com/a");
      expect(yield* response.text).toBe("recorded");
    }).pipe(Effect.provide(Har.layerRecorder)),
  );
});

describe("Har.Recorder redaction", () => {
  it.effect("follows the ambient redacted header names", () =>
    Effect.gen(function* () {
      const client = yield* Har.recordClient(stub(() => new Response("")));
      yield* client.get("https://example.com/", {
        headers: { "x-secret": "s", authorization: "a" },
      });
      const [first] = yield* recorded;
      expect(first?.request.headers).toStrictEqual([
        { name: "x-secret", value: "<redacted>" },
        { name: "authorization", value: "a" },
      ]);
    }).pipe(
      Effect.provideService(Headers.CurrentRedactedNames, ["x-secret"]),
      Effect.provide(Har.layerRecorder),
    ),
  );
});
