/**
 * Unit tests for the gateway-routed OpenAI `ModerationModel` provider
 * (`makeModel` in `src/OpenAiModeration.ts`).
 *
 * The `AI` binding's `gateway(id).run(data, options)` is stubbed to capture
 * the outgoing universal-endpoint request and return a canned
 * `omni-moderation` response, so the tests exercise request shape
 * (provider, endpoint, model, the optional `Authorization` header), the
 * lenient response decode, and the `AiError` failure paths without reaching
 * the network.
 *
 * @module tests/unit/openai-moderation
 */

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as R from "effect/Record";
import * as Redacted from "effect/Redacted";
import { AiError } from "effect/ai";
import type { ModerationModel } from "@thomasfosterau/effect-ext";
import { type WorkersAiBinding } from "@thomasfosterau/effect-ai-cloudflare/Binding";
import {
  MODEL,
  makeModel,
  type Call,
  type Options,
} from "@thomasfosterau/effect-ai-cloudflare/OpenAiModeration";
import { stubAiBinding, stubRun } from "./helpers/ai";
import { expectFailureInstanceOf } from "./helpers/effect";

const binding = (ai: WorkersAiBinding) => ({ ai, gatewayId: "website" });

/** One `omni-moderation` result, in the provider's wire shape. */
const UNASSESSED = Option.none();

const omniResult = (
  flagged: boolean,
  categories: Record<string, boolean | typeof UNASSESSED>,
  scores: Record<string, number | typeof UNASSESSED>,
) => ({
  flagged,
  categories: R.map(categories, (verdict) =>
    Option.isOption(verdict) ? Option.getOrNull(verdict) : verdict,
  ),
  category_scores: R.map(scores, (score) =>
    Option.isOption(score) ? Option.getOrNull(score) : score,
  ),
});

const omniBody = (
  results: ReadonlyArray<Schema.Json>,
  extra: Record<string, Schema.Json> = {},
) => ({
  id: "modr-test",
  model: "omni-moderation-latest",
  results,
  ...extra,
});

/** Moderates `inputs`; with no `options`, through the constructor's own default. */
const moderate = (
  ai: WorkersAiBinding,
  inputs: ReadonlyArray<ModerationModel.ModerationInput>,
  options?: Options,
) =>
  Effect.gen(function* () {
    const model = yield* options === undefined
      ? makeModel(binding(ai))
      : makeModel(binding(ai), options);
    return yield* model.moderate({ inputs });
  });

describe("makeModel", () => {
  it.effect("posts the moderations request through the universal endpoint, BYOK by default", () =>
    Effect.gen(function* () {
      const { ai, calls } = stubRun({
        status: 200,
        body: omniBody([omniResult(false, { hate: false }, { hate: 0.01 })]),
      });

      const response = yield* moderate(ai, ["hello"]);

      expect(calls).toEqual([
        {
          provider: "openai",
          endpoint: "moderations",
          headers: { "content-type": "application/json" },
          query: { model: MODEL, input: ["hello"] },
        },
      ]);
      expect(response.results).toHaveLength(1);
      expect(response.results[0]?.isFlagged).toBe(false);
      expect(response.results[0]?.categories).toEqual({ hate: 0.01 });
      expect(response.usage.inputTokens).toStrictEqual(Option.none());
    }),
  );

  it.effect("sends the caller's own key as a bearer token when given one", () =>
    Effect.gen(function* () {
      const { ai, calls } = stubRun({ status: 200, body: omniBody([omniResult(false, {}, {})]) });

      yield* moderate(ai, ["hello"], { apiKey: Redacted.make("sk-test") });

      expect(calls[0]?.headers).toEqual({
        "content-type": "application/json",
        authorization: "Bearer sk-test",
      });
    }),
  );

  it.effect("requests the model the caller names", () =>
    Effect.gen(function* () {
      const { ai, calls } = stubRun({ status: 200, body: omniBody([omniResult(false, {}, {})]) });

      yield* moderate(ai, ["hello"], { model: "omni-moderation-2024-09-26" });

      expect(calls[0]?.query.model).toBe("omni-moderation-2024-09-26");
    }),
  );

  it.effect("maps one result per input, in order, with every category score", () =>
    Effect.gen(function* () {
      const { ai } = stubRun({
        status: 200,
        body: omniBody([
          omniResult(true, { hate: true, violence: false }, { hate: 0.94, violence: 0.02 }),
          omniResult(false, { hate: false, violence: false }, { hate: 0.01, violence: 0.03 }),
        ]),
      });

      const response = yield* moderate(ai, ["nasty", "nice"]);

      expect(response.results.map((result) => result.isFlagged)).toEqual([true, false]);
      expect(response.results[0]?.categories).toEqual({ hate: 0.94, violence: 0.02 });
      expect(response.results[1]?.categories).toEqual({ hate: 0.01, violence: 0.03 });
    }),
  );

  it.effect("drops null (unassessed) category scores rather than grading them as zero", () =>
    Effect.gen(function* () {
      const { ai } = stubRun({
        status: 200,
        body: omniBody([
          omniResult(false, { hate: UNASSESSED, sexual: false }, { hate: UNASSESSED, sexual: 0.2 }),
        ]),
      });

      const response = yield* moderate(ai, ["..."]);

      expect(response.results[0]?.categories).toEqual({ sexual: 0.2 });
    }),
  );

  it.effect(
    "never fails an otherwise-valid response over a vendor field it has never heard of",
    () =>
      Effect.gen(function* () {
        const { ai } = stubRun({
          status: 200,
          body: omniBody(
            [
              {
                ...omniResult(false, { hate: false }, { hate: 0.01 }),
                category_applied_input_types: { hate: ["text"] },
                a_field_added_next_quarter: { nested: [1, 2, 3] },
              },
            ],
            { usage: { total_tokens: 12 }, another_new_top_level_field: "ignored" },
          ),
        });

        const response = yield* moderate(ai, ["hello"]);

        expect(response.results[0]?.categories).toEqual({ hate: 0.01 });
      }),
  );

  it.effect("tolerates a result with no category maps at all", () =>
    Effect.gen(function* () {
      const { ai } = stubRun({ status: 200, body: omniBody([{ flagged: true }]) });

      const response = yield* moderate(ai, ["hello"]);

      expect(response.results[0]).toMatchObject({ isFlagged: true, categories: {} });
    }),
  );

  it.effect("returns an empty response for no inputs without calling the gateway", () =>
    Effect.gen(function* () {
      const { ai, calls } = stubRun({ status: 200, body: omniBody([]) });

      const response = yield* moderate(ai, []);

      expect(response.results).toEqual([]);
      expect(calls).toHaveLength(0);
    }),
  );

  it.effect("fails with AiError on a non-2xx status, mapping the status to a reason", () =>
    Effect.gen(function* () {
      const { ai } = stubRun({ status: 429, body: { error: { message: "rate limited" } } });

      const failure = yield* expectFailureInstanceOf(moderate(ai, ["..."]), AiError.AiError);

      expect(failure.module).toBe("OpenAiModeration");
      expect(failure.method).toBe("moderate");
      expect(failure.reason._tag).toBe("RateLimitError");
      expect(failure.isRetryable).toBe(true);
    }),
  );

  it.effect("fails with AiError (AuthenticationError) on a 401", () =>
    Effect.gen(function* () {
      const { ai } = stubRun({ status: 401, body: { error: { message: "bad key" } } });

      const failure = yield* expectFailureInstanceOf(moderate(ai, ["..."]), AiError.AiError);

      expect(failure.reason._tag).toBe("AuthenticationError");
    }),
  );

  it.effect("fails with AiError (InvalidOutputError) when the body does not decode", () =>
    Effect.gen(function* () {
      const { ai } = stubRun({ status: 200, body: { results: "nope" } });

      const failure = yield* expectFailureInstanceOf(moderate(ai, ["..."]), AiError.AiError);

      expect(failure.reason._tag).toBe("InvalidOutputError");
    }),
  );

  it.effect(
    "fails with AiError (InvalidOutputError) when the result count does not match the inputs",
    () =>
      Effect.gen(function* () {
        const { ai } = stubRun({ status: 200, body: omniBody([]) });

        const failure = yield* expectFailureInstanceOf(moderate(ai, ["..."]), AiError.AiError);

        expect(failure.reason._tag).toBe("InvalidOutputError");
        expect(failure.message).toContain("expected 1");
      }),
  );

  it.effect("fails with AiError (not a defect) when the gateway call itself rejects", () =>
    Effect.gen(function* () {
      const ai = stubAiBinding(() => ({
        run: () => Promise.reject(new TypeError("socket hang up")),
      }));

      const failure = yield* expectFailureInstanceOf(moderate(ai, ["..."]), AiError.AiError);

      expect(failure.message).toContain("gateway call failed");
    }),
  );

  it.effect("fails with AiError on a 200 whose body is not JSON at all", () =>
    Effect.gen(function* () {
      const ai = stubAiBinding(() => ({
        run: async () => new Response("<html>gateway error</html>", { status: 200 }),
      }));

      const failure = yield* expectFailureInstanceOf(moderate(ai, ["..."]), AiError.AiError);

      expect(failure.message).toContain("response body");
    }),
  );

  it.effect(
    "carries the provider's per-category verdicts and the dated model that served the call",
    () =>
      Effect.gen(function* () {
        const { ai } = stubRun({
          status: 200,
          body: omniBody(
            [omniResult(true, { hate: true, violence: false, sexual: UNASSESSED }, { hate: 0.9 })],
            { model: "omni-moderation-2024-09-26" },
          ),
        });

        const response = yield* moderate(ai, ["..."]);

        expect(response.results[0]?.flags).toStrictEqual(
          Option.some({ hate: true, violence: false }),
        );
        expect(response.modelId).toStrictEqual(Option.some("omni-moderation-2024-09-26"));
      }),
  );

  it.effect("leaves flags undefined when the provider sends no categories map", () =>
    Effect.gen(function* () {
      const { ai } = stubRun({ status: 200, body: omniBody([{ flagged: false }]) });

      const response = yield* moderate(ai, ["..."]);

      expect(response.results[0]?.flags).toStrictEqual(Option.none());
    }),
  );

  it.effect("sends an image input as an image_url part, one request per input", () =>
    Effect.gen(function* () {
      const { ai, calls } = stubRun({
        status: 200,
        body: omniBody([omniResult(false, { sexual: false }, { sexual: 0.02 })]),
      });

      const response = yield* moderate(ai, [
        "a caption",
        [
          { type: "text", text: "what is this" },
          { type: "file", mediaType: "image/png", data: new Uint8Array([1, 2, 3]) },
        ],
      ]);

      expect(calls.map((call) => call.query)).toEqual([
        { model: MODEL, input: ["a caption"] },
        {
          model: MODEL,
          input: [
            { type: "text", text: "what is this" },
            { type: "image_url", image_url: { url: "data:image/png;base64,AQID" } },
          ],
        },
      ]);
      expect(response.results).toHaveLength(2);
      expect(response.results[1]?.categories).toEqual({ sexual: 0.02 });
    }),
  );

  it.effect("sends a data: URI, a URL or a base64 string as the image URL", () =>
    Effect.gen(function* () {
      const { ai, calls } = stubRun({
        status: 200,
        body: omniBody([omniResult(false, {}, {})]),
      });

      yield* moderate(ai, [
        [{ type: "file", mediaType: "image/jpeg", data: "data:image/jpeg;base64,/9j/" }],
        [{ type: "file", mediaType: "image/jpeg", data: new URL("https://example.com/a.jpg") }],
        [{ type: "file", mediaType: "image/webp", data: "UklGRg==" }],
      ]);

      expect(calls.map((call) => call.query.input)).toEqual([
        [{ type: "image_url", image_url: { url: "data:image/jpeg;base64,/9j/" } }],
        [{ type: "image_url", image_url: { url: "https://example.com/a.jpg" } }],
        [{ type: "image_url", image_url: { url: "data:image/webp;base64,UklGRg==" } }],
      ]);
    }),
  );

  it.effect("sends the tagged JSON forms of a byte array and a URL as the image URL", () =>
    Effect.gen(function* () {
      const { ai, calls } = stubRun({
        status: 200,
        body: omniBody([omniResult(false, {}, {})]),
      });

      yield* moderate(ai, [
        [{ type: "file", mediaType: "image/png", data: { _tag: "Uint8Array", base64: "AQID" } }],
        [
          {
            type: "file",
            mediaType: "image/jpeg",
            data: { _tag: "URL", href: "https://example.com/b.jpg" },
          },
        ],
      ]);

      expect(calls.map((call) => call.query.input)).toEqual([
        [{ type: "image_url", image_url: { url: "data:image/png;base64,AQID" } }],
        [{ type: "image_url", image_url: { url: "https://example.com/b.jpg" } }],
      ]);
    }),
  );

  it.effect("fails with InvalidUserInputError on a non-image file part, before any request", () =>
    Effect.gen(function* () {
      const { ai, calls } = stubRun({ status: 200, body: omniBody([]) });

      const failure = yield* expectFailureInstanceOf(
        moderate(ai, [
          "fine",
          [{ type: "file", mediaType: "application/pdf", data: new Uint8Array([1]) }],
        ]),
        AiError.AiError,
      );

      expect(failure.reason._tag).toBe("InvalidUserInputError");
      expect(calls).toHaveLength(0);
    }),
  );

  it.effect("reports each settled call to onCall, on success and on failure", () =>
    Effect.gen(function* () {
      const seen: Array<Call> = [];
      const onCall = (call: Call) => Effect.sync(() => seen.push(call));
      const ok = stubRun({ status: 200, body: omniBody([omniResult(false, {}, {})]) });
      const limited = stubRun({ status: 429, body: { error: { message: "slow down" } } });

      yield* moderate(ok.ai, ["hello"], { onCall });
      const failure = yield* expectFailureInstanceOf(
        moderate(limited.ai, ["hello"], { onCall }),
        AiError.AiError,
      );

      expect(seen).toHaveLength(2);
      expect(seen[0]).toMatchObject({ status: Option.some(200), error: Option.none() });
      expect(seen[0]?.durationMillis).toBeGreaterThanOrEqual(0);
      expect(seen[1]?.status).toEqual(Option.some(429));
      expect(seen[1]?.error).toEqual(Option.some(failure));
    }),
  );

  it.effect("reports a transport failure to onCall with no status", () =>
    Effect.gen(function* () {
      const seen: Array<Call> = [];
      const ai = stubAiBinding(() => ({
        run: () => Promise.reject(new TypeError("socket hang up")),
      }));

      yield* expectFailureInstanceOf(
        moderate(ai, ["..."], { onCall: (call) => Effect.sync(() => seen.push(call)) }),
        AiError.AiError,
      );

      expect(seen).toHaveLength(1);
      expect(seen[0]?.status).toEqual(Option.none());
      expect(Option.map(seen[0]?.error ?? Option.none(), (error) => error.reason._tag)).toEqual(
        Option.some("UnknownError"),
      );
    }),
  );
});
