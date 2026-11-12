/**
 * Maps the failure channels of the underlying HTTP client — transport
 * failures, non-2xx statuses, and body-decode failures — plus schema
 * decode failures, into the unified `AiError` surface every Effect AI
 * provider presents. Status codes are classified through the shared
 * `AiError.reasonFromHttpStatus` (so 401 → authentication, 429 → rate
 * limit, 5xx → internal-provider, etc.) rather than a bespoke table.
 *
 * @module internal/errors
 *
 * @copyright Thomas Foster
 */

import * as Effect from "effect/Effect";
import { dual } from "effect/Function";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import type * as Redacted from "effect/Redacted";
import type * as Schema from "effect/Schema";
import * as AiError from "effect/ai/AiError";
import type * as HttpClientError from "effect/http/HttpClientError";
import * as Headers from "effect/http/Headers";

const MODULE = "VoyageClient";

/**
 * `headers` as `AiError` and `Response` record them: the `Headers` redactable
 * form, in which each sensitive header (authorization, cookies, API keys) is a
 * `Redacted` value instead of its string.
 */
const redactHeaders = Effect.fnUntraced(function* (
  headers: Headers.Headers,
): Effect.fn.Return<Record<string, string | Redacted.Redacted>> {
  const names = yield* Headers.CurrentRedactedNames;
  return Headers.redact(headers, names);
});

/** Wraps a schema decode failure as an `InvalidOutputError`. */
export const mapSchemaError = dual<
  (method: string) => (error: Schema.SchemaError) => AiError.AiError,
  (error: Schema.SchemaError, method: string) => AiError.AiError
>(2, (error, method) =>
  AiError.make({
    module: MODULE,
    method,
    reason: AiError.InvalidOutputError.fromSchemaError(error),
  }),
);

/**
 * Translates an `HttpClientError` into a failing effect carrying the mapped
 * `AiError`. Non-2xx statuses (only reachable through `filterStatusOk`) read
 * the response body for context before classifying via
 * `AiError.reasonFromHttpStatus`; transport-level failures become
 * `NetworkError`; body problems become `InvalidOutputError`.
 */
export const mapHttpClientError = dual<
  (
    method: string,
  ) => (error: HttpClientError.HttpClientError) => Effect.Effect<never, AiError.AiError>,
  (error: HttpClientError.HttpClientError, method: string) => Effect.Effect<never, AiError.AiError>
>(2, (error, method) => {
  return Match.value(error.reason).pipe(
    Match.tag("TransportError", "EncodeError", "InvalidUrlError", (reason) =>
      Effect.fail(
        AiError.make({
          module: MODULE,
          method,
          reason: AiError.NetworkError.fromRequestError(reason),
        }),
      ),
    ),
    Match.tag("StatusCodeError", (reason) => mapStatusCodeError(reason, method)),
    // DecodeError / EmptyBodyError — a 2xx response whose body could not be read.
    Match.orElse((reason) =>
      Effect.fail(
        AiError.make({
          module: MODULE,
          method,
          reason: new AiError.InvalidOutputError({
            description: reason.description ?? "Failed to read Voyage response body",
          }),
        }),
      ),
    ),
  );
});

const mapStatusCodeError = Effect.fnUntraced(function* (
  error: HttpClientError.StatusCodeError,
  method: string,
) {
  const { response } = error;
  const bodyOption = yield* Effect.option(response.text);
  const body = Option.getOrUndefined(bodyOption);
  const reason = AiError.reasonFromHttpStatus({
    status: response.status,
    body,
    http: {
      response: {
        status: response.status,
        headers: yield* redactHeaders(response.headers),
      },
      body,
    },
  });
  return yield* AiError.make({ module: MODULE, method, reason });
});
