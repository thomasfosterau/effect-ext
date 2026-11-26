/**
 * What `Har` and `Warc` share: one HTTP exchange as a recorder sees it,
 * captured from an `HttpClient` or around a server handler, and the
 * redaction and body readings both formats record.
 */
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as R from "effect/Record";
import * as Redacted from "effect/Redacted";
import * as Str from "effect/String";
import * as Headers from "effect/http/Headers";
import * as HttpBody from "effect/http/HttpBody";
import * as HttpClient from "effect/http/HttpClient";
import type * as HttpClientError from "effect/http/HttpClientError";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as HttpMiddleware from "effect/http/HttpMiddleware";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import type * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as UrlParams from "effect/http/UrlParams";

/** One exchange, as recorded. */
export interface Exchange {
  readonly started: DateTime.Utc;
  /** Milliseconds from sending the request to the whole response. */
  readonly time: number;
  readonly method: string;
  readonly url: string;
  readonly query: UrlParams.UrlParams;
  readonly requestHeaders: Headers.Headers;
  readonly requestBody: HttpBody.HttpBody;
  readonly status: number;
  readonly statusText: Option.Option<string>;
  readonly responseHeaders: Headers.Headers;
  /** `None` where the body is a stream or form data, which is not recorded. */
  readonly responseBody: Option.Option<Uint8Array>;
}

/**
 * Whether a response of `status` must be built with a `null` body, the
 * Fetch `Response` constructor's spelling of "no body".
 */
export const hasNullBody = (status: number): boolean =>
  Arr.contains([101, 103, 204, 205, 304], status);

/** Written in place of a redacted header or query value, as `Har` and `Warc` document. */
const REDACTED = "<redacted>";

const revealed = (
  pairs: Iterable<readonly [string, string | Redacted.Redacted]>,
): ReadonlyArray<readonly [string, string]> =>
  Arr.map(Arr.fromIterable(pairs), ([name, value]) => [
    name,
    Redacted.isRedacted(value) ? REDACTED : value,
  ]);

/** `headers` with the names in `Headers.CurrentRedactedNames` written as {@link REDACTED}. */
export const redactedHeaders = (
  headers: Headers.Headers,
): Effect.Effect<ReadonlyArray<readonly [string, string]>> =>
  Effect.map(Effect.service(Headers.CurrentRedactedNames), (names) =>
    revealed(R.toEntries(Headers.redact(headers, names))),
  );

/** `params` with the names in `UrlParams.CurrentRedactedNames` written as {@link REDACTED}. */
export const redactedQuery = (
  params: UrlParams.UrlParams,
): Effect.Effect<ReadonlyArray<readonly [string, string]>> =>
  Effect.map(Effect.service(UrlParams.CurrentRedactedNames), (names) =>
    revealed(
      Arr.map(params.params, ([name, value]) => [
        name,
        P.isString(value) && UrlParams.isRedactedName(name, names) ? Redacted.make(value) : value,
      ]),
    ),
  );

/** Whether bytes of `mimeType` are text, rather than binary. */
export const isTextual = (mimeType: string): boolean => {
  const essence = Str.toLowerCase(Str.trim(Arr.headNonEmpty(Str.split(mimeType, ";"))));
  return (
    Str.startsWith("text/")(essence) ||
    Str.endsWith("+json")(essence) ||
    Str.endsWith("+xml")(essence) ||
    Arr.contains(
      [
        "application/json",
        "application/xml",
        "application/javascript",
        "application/x-www-form-urlencoded",
      ],
      essence,
    )
  );
};

/** A body's bytes, where they can be read without consuming a stream. */
export const bodyBytes = (body: HttpBody.HttpBody): Option.Option<Uint8Array> =>
  Match.valueTags(body, {
    Empty: () => Option.some(new Uint8Array()),
    Uint8Array: (bytes) => Option.some(bytes.body),
    Raw: (raw) =>
      P.isString(raw.body)
        ? Option.some(new TextEncoder().encode(raw.body))
        : P.isUint8Array(raw.body)
          ? Option.some(raw.body)
          : Option.none(),
    FormData: () => Option.none(),
    Stream: () => Option.none(),
  });

/** A body's declared media type, or `""`. */
export const contentTypeOf = (body: HttpBody.HttpBody): string =>
  Match.valueTags(body, {
    Empty: () => "",
    Uint8Array: (bytes) => bytes.contentType,
    Raw: (raw) => raw.contentType ?? "",
    FormData: () => "",
    Stream: (stream) => stream.contentType,
  });

/**
 * `client`, handing each exchange to `record` before returning its
 * response. The response body is read in full to record it, then served
 * again from those bytes.
 */
export const captureClient = <E, R>(
  client: HttpClient.HttpClient.With<E, R>,
  record: (exchange: Exchange) => Effect.Effect<void>,
): HttpClient.HttpClient.With<E | HttpClientError.HttpClientError, R> =>
  HttpClient.transform(client, (effect, request) =>
    Effect.gen(function* () {
      const started = yield* DateTime.now;
      const response = yield* effect;
      const bytes = new Uint8Array(yield* response.arrayBuffer);
      const finished = yield* DateTime.now;
      yield* record({
        started,
        time: Duration.toMillis(DateTime.distance(started, finished)),
        method: request.method,
        url: request.url,
        query: request.urlParams,
        requestHeaders: request.headers,
        requestBody: request.body,
        status: response.status,
        statusText: Option.none(),
        responseHeaders: response.headers,
        responseBody: Option.some(bytes),
      });
      return HttpClientResponse.fromWeb(
        request,
        new globalThis.Response(hasNullBody(response.status) ? null : bytes, {
          status: response.status,
          headers: response.headers,
        }),
      );
    }),
  );

/**
 * `app`, handing each exchange it serves to `record`. The request body is
 * never read: the handler owns it, so the exchange carries an empty one.
 */
const captureServer = <E, R>(
  app: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
  record: (exchange: Exchange) => Effect.Effect<void>,
): Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  E,
  R | HttpServerRequest.HttpServerRequest
> =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const started = yield* DateTime.now;
    const response = yield* app;
    const finished = yield* DateTime.now;
    const url = Option.getOrElse(
      Option.map(HttpServerRequest.toURL(request), (parsed) => parsed.href),
      () => request.originalUrl,
    );
    const contentType = contentTypeOf(response.body);
    yield* record({
      started,
      time: Duration.toMillis(DateTime.distance(started, finished)),
      method: request.method,
      url,
      query: UrlParams.fromInput(new URL(url, "http://localhost").searchParams),
      requestHeaders: request.headers,
      requestBody: HttpBody.empty,
      status: response.status,
      statusText: Option.fromUndefinedOr(response.statusText),
      responseHeaders: Str.isEmpty(contentType)
        ? response.headers
        : Headers.set(response.headers, "content-type", contentType),
      responseBody: bodyBytes(response.body),
    });
    return response;
  });

/**
 * Server middleware handing each exchange it serves, with the `service` it
 * records into, to `record`.
 */
export const recordingServer = <I, S>(
  service: Context.Key<I, S>,
  record: (service: S, exchange: Exchange) => Effect.Effect<void>,
) =>
  HttpMiddleware.make(
    <E, R>(
      app: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
    ): Effect.Effect<
      HttpServerResponse.HttpServerResponse,
      E,
      R | I | HttpServerRequest.HttpServerRequest
    > =>
      Effect.flatMap(service, (recorder) =>
        captureServer(app, (exchange) => record(recorder, exchange)),
      ),
  );
