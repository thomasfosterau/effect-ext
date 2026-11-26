/**
 * Unit tests for the binding-free, URL-based Anthropic `LanguageModel`
 * provider (`languageModelLayerFromUrl` in `src/Anthropic.ts`).
 *
 * Config (`CF_ACCOUNT_ID`, `CF_AIG_GATEWAY_ID`, `CF_AIG_TOKEN`) is supplied
 * through a `ConfigProvider.fromUnknown` layer instead of real environment
 * variables, and the network is stubbed at `FetchHttpClient.Fetch` — the
 * same technique `anthropic.test.ts` uses for the binding-based layer — so
 * these tests exercise the resolved gateway URL, the `cf-aig-authorization`
 * header, and the BYOK no-`x-api-key` contract without reaching the
 * network or requiring a Worker `AI` binding in scope.
 *
 * @module tests/unit/anthropic-url
 */

import { assert, describe, expect, it, layer } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Config from "effect/Config";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { LanguageModel } from "effect/ai";
import { FetchHttpClient } from "effect/http";
import { languageModelLayerFromUrl } from "@thomasfosterau/effect-ai-cloudflare/Anthropic";

interface CapturedRequest {
  readonly url: string;
  readonly apiKeyHeader: Option.Option<string>;
  readonly cfAigAuthorizationHeader: Option.Option<string>;
  readonly body: unknown;
}

/** A `FetchHttpClient.Fetch` stub that records each request. */
const stubFetch = (response: { status: number; body: unknown }) => {
  const calls: CapturedRequest[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    calls.push({
      url: request.url,
      apiKeyHeader: Option.fromNullishOr(request.headers.get("x-api-key")),
      cfAigAuthorizationHeader: Option.fromNullishOr(request.headers.get("cf-aig-authorization")),
      body: await request.json(),
    });
    return Response.json(response.body, { status: response.status });
  };
  return { calls, fetch };
};

/** Builds a Layer providing `Config` from an in-memory map, not `process.env`. */
const stubConfig = (values: Record<string, string>) =>
  ConfigProvider.layer(ConfigProvider.fromUnknown(values));

const anthropicMessageResponse = (text: string) => ({
  id: "msg_test",
  type: "message",
  role: "assistant",
  content: [{ type: "text", text }],
  model: "claude-sonnet-4-6",
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: {
    cache_creation: null,
    cache_creation_input_tokens: null,
    cache_read_input_tokens: null,
    inference_geo: null,
    input_tokens: 10,
    output_tokens: 5,
    service_tier: null,
  },
});

describe("languageModelLayerFromUrl", () => {
  layer(
    languageModelLayerFromUrl({ model: "claude-sonnet-4-6" }).pipe(
      Layer.provide(FetchHttpClient.layer),
      Layer.provide(
        stubConfig({
          CF_ACCOUNT_ID: "acct",
          CF_AIG_GATEWAY_ID: "website",
          CF_AIG_TOKEN: "test-token",
        }),
      ),
    ),
  )((t) => {
    t.effect(
      "routes generateText through the config-resolved gateway URL with the cf-aig-authorization header and no x-api-key",
      () =>
        Effect.gen(function* () {
          const { calls, fetch } = stubFetch({
            status: 200,
            body: anthropicMessageResponse("hello from the URL gateway"),
          });

          const response = yield* LanguageModel.generateText({ prompt: "say hello" }).pipe(
            Effect.provideService(FetchHttpClient.Fetch, fetch),
          );

          expect(calls).toHaveLength(1);
          expect(calls[0]?.url).toBe(
            "https://gateway.ai.cloudflare.com/v1/acct/website/anthropic/v1/messages?beta=true",
          );
          expect(calls[0]?.apiKeyHeader).toEqual(Option.none());
          expect(calls[0]?.cfAigAuthorizationHeader).toEqual(Option.some("Bearer test-token"));
          expect(calls[0]?.body).toMatchObject({ model: "claude-sonnet-4-6" });
          expect(response.text).toBe("hello from the URL gateway");
        }),
    );
  });

  it.effect(
    "fails layer construction with a typed ConfigError when CF_AIG_GATEWAY_ID is missing",
    () =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(
          Layer.build(
            languageModelLayerFromUrl({ model: "claude-sonnet-4-6" }).pipe(
              Layer.provide(FetchHttpClient.layer),
              Layer.provide(stubConfig({ CF_ACCOUNT_ID: "acct", CF_AIG_TOKEN: "test-token" })),
            ),
          ),
        );

        assert(Exit.isFailure(exit), "expected a failure exit");
        const error = Cause.squash(exit.cause);
        expect(error).toBeInstanceOf(Config.ConfigError);
        expect(String(error)).toContain("CF_AIG_GATEWAY_ID");
      }),
  );

  it.effect("fails layer construction with a typed ConfigError when CF_ACCOUNT_ID is missing", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        Layer.build(
          languageModelLayerFromUrl({ model: "claude-sonnet-4-6" }).pipe(
            Layer.provide(FetchHttpClient.layer),
            Layer.provide(stubConfig({ CF_AIG_TOKEN: "test-token" })),
          ),
        ),
      );

      assert(Exit.isFailure(exit), "expected a failure exit");
      const error = Cause.squash(exit.cause);
      expect(error).toBeInstanceOf(Config.ConfigError);
      expect(String(error)).toContain("CF_ACCOUNT_ID");
    }),
  );
});
