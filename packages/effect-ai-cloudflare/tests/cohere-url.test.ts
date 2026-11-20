/**
 * Unit tests for the binding-free, URL-based Cohere `EmbeddingModel` and
 * `RerankerModel` providers (`makeCohereEmbeddingModelFromUrl` and
 * `makeCohereRerankerFromUrl` in `src/Cohere.ts`).
 *
 * Config is supplied through `ConfigProvider.fromUnknown` instead of real
 * environment variables, and the network is stubbed at
 * `FetchHttpClient.Fetch` — so these tests exercise the resolved gateway
 * URL, the `cf-aig-authorization` header, request shape, and response
 * mapping without reaching the network or requiring a Worker `AI` binding.
 *
 * @module tests/unit/cohere-url
 */

import { describe, expect, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { AiError } from "effect/ai";
import { FetchHttpClient } from "effect/http";
import {
  COHERE_EMBEDDING_MODEL,
  COHERE_RERANK_MODEL,
  makeCohereEmbeddingModelFromUrl,
  makeCohereRerankerFromUrl,
} from "@thomasfosterau/effect-ai-cloudflare";
import { expectFailureInstanceOf } from "./helpers/effect";

interface CapturedRequest {
  readonly url: string;
  readonly cfAigAuthorizationHeader: Option.Option<string>;
  readonly body: unknown;
}

const stubFetch = (response: { status: number; body: unknown }) => {
  const calls: CapturedRequest[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    calls.push({
      url: request.url,
      cfAigAuthorizationHeader: Option.fromNullishOr(request.headers.get("cf-aig-authorization")),
      body: await request.json(),
    });
    return Response.json(response.body, { status: response.status });
  };
  return { calls, fetch };
};

/** A fetch stub that returns a 200 response whose body is not valid JSON. */
const malformedBodyFetch: typeof globalThis.fetch = async () =>
  new Response("not valid json", {
    status: 200,
    headers: { "content-type": "application/json" },
  });

/** A fetch stub that rejects, simulating a transport-level failure. */
const rejectingFetch: typeof globalThis.fetch = async () => {
  throw new TypeError("network unreachable");
};

const stubConfig = (values: Record<string, string>) =>
  Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown(values));

const GATEWAY_CONFIG = {
  CF_ACCOUNT_ID: "acct",
  CF_AIG_GATEWAY_ID: "website",
  CF_AIG_TOKEN: "test-token",
};

describe("makeCohereEmbeddingModelFromUrl", () => {
  it.effect(
    "posts the embed request to the config-resolved gateway URL with the cf-aig-authorization header",
    () =>
      Effect.gen(function* () {
        const { calls, fetch } = stubFetch({
          status: 200,
          body: {
            embeddings: {
              float: [
                [0.1, 0.2],
                [0.3, 0.4],
              ],
            },
            meta: { billed_units: { input_tokens: 5 } },
          },
        });

        const response = yield* Effect.gen(function* () {
          const model = yield* makeCohereEmbeddingModelFromUrl({ inputType: "search_document" });
          return yield* model.embedMany(["first", "second"]);
        }).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch), stubConfig(GATEWAY_CONFIG));

        expect(calls).toHaveLength(1);
        expect(calls[0]?.url).toBe(
          "https://gateway.ai.cloudflare.com/v1/acct/website/cohere/v2/embed",
        );
        expect(calls[0]?.cfAigAuthorizationHeader).toEqual(Option.some("Bearer test-token"));
        expect(calls[0]?.body).toEqual({
          model: COHERE_EMBEDDING_MODEL,
          input_type: "search_document",
          texts: ["first", "second"],
          output_dimension: 1024,
          embedding_types: ["float"],
        });
        expect(response.embeddings.map((embedded) => [...embedded.vector])).toEqual([
          [0.1, 0.2],
          [0.3, 0.4],
        ]);
        expect(response.usage.inputTokens).toBe(5);
      }),
  );

  it.effect("fails with AiError on a non-2xx status", () =>
    Effect.gen(function* () {
      const { fetch } = stubFetch({
        status: 401,
        body: { message: "invalid token" },
      });

      const failure = yield* expectFailureInstanceOf(
        Effect.gen(function* () {
          const model = yield* makeCohereEmbeddingModelFromUrl({ inputType: "search_document" });
          return yield* model.embedMany(["text"]);
        }).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch), stubConfig(GATEWAY_CONFIG)),
        AiError.AiError,
      );

      expect(failure.reason._tag).toBe("AuthenticationError");
    }),
  );

  it.effect("fails with AiError when the response body cannot be parsed as JSON", () =>
    Effect.gen(function* () {
      const failure = yield* expectFailureInstanceOf(
        Effect.gen(function* () {
          const model = yield* makeCohereEmbeddingModelFromUrl({ inputType: "search_document" });
          return yield* model.embedMany(["text"]);
        }).pipe(
          Effect.provideService(FetchHttpClient.Fetch, malformedBodyFetch),
          stubConfig(GATEWAY_CONFIG),
        ),
        AiError.AiError,
      );

      expect(failure.message).toContain("response body");
    }),
  );

  it.effect("fails with AiError (not a defect) when the transport call rejects", () =>
    Effect.gen(function* () {
      const failure = yield* expectFailureInstanceOf(
        Effect.gen(function* () {
          const model = yield* makeCohereEmbeddingModelFromUrl({ inputType: "search_document" });
          return yield* model.embedMany(["text"]);
        }).pipe(
          Effect.provideService(FetchHttpClient.Fetch, rejectingFetch),
          stubConfig(GATEWAY_CONFIG),
        ),
        AiError.AiError,
      );

      expect(failure.message).toContain("gateway call failed");
    }),
  );

  it.effect("fails layer construction with a typed ConfigError when CF_ACCOUNT_ID is missing", () =>
    Effect.gen(function* () {
      const { fetch } = stubFetch({ status: 200, body: {} });

      const exit = yield* Effect.exit(
        Effect.gen(function* () {
          const model = yield* makeCohereEmbeddingModelFromUrl({ inputType: "search_document" });
          return yield* model.embedMany(["text"]);
        }).pipe(
          Effect.provideService(FetchHttpClient.Fetch, fetch),
          stubConfig({ CF_AIG_TOKEN: "test-token" }),
        ),
      );

      expect(exit._tag).toBe("Failure");
    }),
  );
});

describe("makeCohereRerankerFromUrl", () => {
  const rerankResponse = {
    results: [
      { index: 1, relevance_score: 0.2 },
      { index: 0, relevance_score: 0.9 },
    ],
    meta: { billed_units: { search_units: 1 } },
  };

  it.effect(
    "posts the rerank request to the config-resolved gateway URL with the cf-aig-authorization header",
    () =>
      Effect.gen(function* () {
        const { calls, fetch } = stubFetch({ status: 200, body: rerankResponse });

        const response = yield* Effect.gen(function* () {
          const reranker = yield* makeCohereRerankerFromUrl;
          return yield* reranker.rerank({ query: "monstera", documents: ["a", "b"], topN: 2 });
        }).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch), stubConfig(GATEWAY_CONFIG));

        expect(calls).toHaveLength(1);
        expect(calls[0]?.url).toBe(
          "https://gateway.ai.cloudflare.com/v1/acct/website/cohere/v2/rerank",
        );
        expect(calls[0]?.cfAigAuthorizationHeader).toEqual(Option.some("Bearer test-token"));
        expect(calls[0]?.body).toEqual({
          model: COHERE_RERANK_MODEL,
          query: "monstera",
          documents: ["a", "b"],
          top_n: 2,
        });
        // `RerankerModel.make` normalises to descending relevance regardless of
        // the provider's ordering.
        expect(response.results.map((entry) => [entry.index, entry.relevanceScore])).toEqual([
          [0, 0.9],
          [1, 0.2],
        ]);
        expect(response.usage.inputTokens).toStrictEqual(Option.some(1));
      }),
  );

  it.effect("omits top_n when the caller gives none", () =>
    Effect.gen(function* () {
      const { calls, fetch } = stubFetch({ status: 200, body: rerankResponse });

      yield* Effect.gen(function* () {
        const reranker = yield* makeCohereRerankerFromUrl;
        return yield* reranker.rerank({ query: "monstera", documents: ["a", "b"] });
      }).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch), stubConfig(GATEWAY_CONFIG));

      expect(calls[0]?.body).toEqual({
        model: COHERE_RERANK_MODEL,
        query: "monstera",
        documents: ["a", "b"],
      });
    }),
  );

  it.effect("resolves config once at construction, not per request", () =>
    Effect.gen(function* () {
      const { calls, fetch } = stubFetch({ status: 200, body: rerankResponse });

      yield* Effect.gen(function* () {
        const reranker = yield* makeCohereRerankerFromUrl;
        yield* reranker.rerank({ query: "one", documents: ["a", "b"] });
        yield* reranker.rerank({ query: "two", documents: ["a", "b"] });
      }).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch), stubConfig(GATEWAY_CONFIG));

      expect(calls.map((call) => call.url)).toEqual([
        "https://gateway.ai.cloudflare.com/v1/acct/website/cohere/v2/rerank",
        "https://gateway.ai.cloudflare.com/v1/acct/website/cohere/v2/rerank",
      ]);
    }),
  );

  it.effect("fails with AiError on a non-2xx status", () =>
    Effect.gen(function* () {
      const { fetch } = stubFetch({ status: 429, body: { message: "slow down" } });

      const failure = yield* expectFailureInstanceOf(
        Effect.gen(function* () {
          const reranker = yield* makeCohereRerankerFromUrl;
          return yield* reranker.rerank({ query: "q", documents: ["a"] });
        }).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch), stubConfig(GATEWAY_CONFIG)),
        AiError.AiError,
      );

      expect(failure.module).toBe("Cohere");
      expect(failure.method).toBe("rerank");
      expect(failure.reason._tag).toBe("RateLimitError");
    }),
  );

  it.effect("fails with AiError when the response body cannot be parsed as JSON", () =>
    Effect.gen(function* () {
      const failure = yield* expectFailureInstanceOf(
        Effect.gen(function* () {
          const reranker = yield* makeCohereRerankerFromUrl;
          return yield* reranker.rerank({ query: "q", documents: ["a"] });
        }).pipe(
          Effect.provideService(FetchHttpClient.Fetch, malformedBodyFetch),
          stubConfig(GATEWAY_CONFIG),
        ),
        AiError.AiError,
      );

      expect(failure.message).toContain("response body");
    }),
  );

  it.effect("fails with AiError (not a defect) when the transport call rejects", () =>
    Effect.gen(function* () {
      const failure = yield* expectFailureInstanceOf(
        Effect.gen(function* () {
          const reranker = yield* makeCohereRerankerFromUrl;
          return yield* reranker.rerank({ query: "q", documents: ["a"] });
        }).pipe(
          Effect.provideService(FetchHttpClient.Fetch, rejectingFetch),
          stubConfig(GATEWAY_CONFIG),
        ),
        AiError.AiError,
      );

      expect(failure.message).toContain("gateway call failed");
    }),
  );

  it.effect("fails with AiError when the response does not match the rerank shape", () =>
    Effect.gen(function* () {
      const { fetch } = stubFetch({ status: 200, body: { results: "nope" } });

      const failure = yield* expectFailureInstanceOf(
        Effect.gen(function* () {
          const reranker = yield* makeCohereRerankerFromUrl;
          return yield* reranker.rerank({ query: "q", documents: ["a"] });
        }).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch), stubConfig(GATEWAY_CONFIG)),
        AiError.AiError,
      );

      expect(failure.reason._tag).toBe("InvalidOutputError");
    }),
  );

  it.effect("fails construction with a typed ConfigError when CF_AIG_TOKEN is missing", () =>
    Effect.gen(function* () {
      const { calls, fetch } = stubFetch({ status: 200, body: rerankResponse });

      const exit = yield* Effect.exit(
        makeCohereRerankerFromUrl.pipe(
          Effect.provideService(FetchHttpClient.Fetch, fetch),
          stubConfig({ CF_ACCOUNT_ID: "acct" }),
        ),
      );

      expect(exit._tag).toBe("Failure");
      expect(calls).toHaveLength(0);
    }),
  );
});
