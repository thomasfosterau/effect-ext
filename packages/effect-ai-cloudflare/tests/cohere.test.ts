/**
 * Unit tests for the gateway-routed Cohere `EmbeddingModel` and
 * `RerankerModel` providers (`src/Cohere.ts`).
 *
 * The `AI` binding's `gateway(id).run(data, options)` is stubbed to
 * capture the outgoing universal-endpoint request and return a canned
 * Cohere v2 response, so the tests exercise request shape (provider,
 * endpoint, model, `output_dimension` pinning), response mapping, and
 * `AiError` failure paths without reaching the network.
 *
 * @module tests/unit/cohere
 */

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { AiError } from "effect/ai";
import { type WorkersAiBinding } from "@thomasfosterau/effect-ai-cloudflare/Binding";
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  RERANK_MODEL,
  makeEmbeddingModel,
  makeReranker,
} from "@thomasfosterau/effect-ai-cloudflare/Cohere";
import { stubAiBinding } from "./helpers/ai";
import { expectFailureInstanceOf } from "./helpers/effect";

/** Expected embedding width for `embed-v4.0`. */
const EXPECTED_DIMENSIONS = 1024;

/** Builds a stub binding whose `gateway(id).run(data)` is canned. */
const stubAi = (response: { status: number; body: unknown }) => {
  const calls: unknown[] = [];
  const ai = stubAiBinding(() => ({
    run: async (data) => {
      calls.push(data);
      return Response.json(response.body, { status: response.status });
    },
  }));
  return { ai, calls };
};

/** Builds a stub binding whose `gateway(id).run(data)` rejects. */
const stubAiReject = (): WorkersAiBinding =>
  stubAiBinding(() => ({
    run: async () => {
      throw new TypeError("gateway unreachable");
    },
  }));

/** Builds a stub binding whose `gateway(id).run(data)` returns a 200 response with an unparseable body. */
const stubAiMalformedBody = (): WorkersAiBinding =>
  stubAiBinding(() => ({
    run: async () =>
      new Response("not valid json", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  }));

const binding = (ai: WorkersAiBinding) => ({ ai, gatewayId: "website" });

// ── Embeddings ───────────────────────────────────────────────────────

describe("Cohere embeddings", () => {
  it("pins output_dimension to the database's vector column width", () => {
    expect(EMBEDDING_DIMENSIONS).toBe(EXPECTED_DIMENSIONS);
  });

  it.effect("posts the embed request with output_dimension pinned to 1024", () =>
    Effect.gen(function* () {
      const { ai, calls } = stubAi({
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
        const model = yield* makeEmbeddingModel(binding(ai), {
          inputType: "search_document",
        });
        return yield* model.embedMany(["first", "second"]);
      });

      expect(calls).toEqual([
        {
          provider: "cohere",
          endpoint: "v2/embed",
          headers: { "content-type": "application/json" },
          query: {
            model: EMBEDDING_MODEL,
            input_type: "search_document",
            texts: ["first", "second"],
            output_dimension: 1024,
            embedding_types: ["float"],
          },
        },
      ]);
      expect(response.embeddings.map((embedded) => [...embedded.vector])).toEqual([
        [0.1, 0.2],
        [0.3, 0.4],
      ]);
      expect(response.usage.inputTokens).toBe(5);
    }),
  );

  it.effect("forwards search_query as the input type for query-time embeddings", () =>
    Effect.gen(function* () {
      const { ai, calls } = stubAi({
        status: 200,
        body: { embeddings: { float: [[0.5]] } },
      });

      yield* Effect.gen(function* () {
        const model = yield* makeEmbeddingModel(binding(ai), { inputType: "search_query" });
        return yield* model.embedMany(["query text"]);
      });

      expect((calls[0] as { query: { input_type: string } }).query.input_type).toBe("search_query");
    }),
  );

  it.effect("does not call the provider for an empty input array", () =>
    Effect.gen(function* () {
      const { ai, calls } = stubAi({ status: 200, body: { embeddings: { float: [] } } });

      yield* Effect.gen(function* () {
        const model = yield* makeEmbeddingModel(binding(ai), {
          inputType: "search_document",
        });
        return yield* model.embedMany([]);
      });

      expect(calls).toHaveLength(0);
    }),
  );

  it.effect("fails with AiError on a non-2xx status", () =>
    Effect.gen(function* () {
      const { ai } = stubAi({ status: 401, body: { message: "invalid api key" } });

      const failure = yield* expectFailureInstanceOf(
        Effect.gen(function* () {
          const model = yield* makeEmbeddingModel(binding(ai), {
            inputType: "search_document",
          });
          return yield* model.embedMany(["text"]);
        }),
        AiError.AiError,
      );

      expect(failure.reason._tag).toBe("AuthenticationError");
    }),
  );

  it.effect("fails with AiError when the response body has the wrong shape", () =>
    Effect.gen(function* () {
      const { ai } = stubAi({ status: 200, body: { unexpected: "shape" } });

      const failure = yield* expectFailureInstanceOf(
        Effect.gen(function* () {
          const model = yield* makeEmbeddingModel(binding(ai), {
            inputType: "search_document",
          });
          return yield* model.embedMany(["text"]);
        }),
        AiError.AiError,
      );

      expect(failure.message).toContain("expected shape");
    }),
  );

  it.effect("fails with AiError when the response body cannot be parsed as JSON", () =>
    Effect.gen(function* () {
      const failure = yield* expectFailureInstanceOf(
        Effect.gen(function* () {
          const model = yield* makeEmbeddingModel(binding(stubAiMalformedBody()), {
            inputType: "search_document",
          });
          return yield* model.embedMany(["text"]);
        }),
        AiError.AiError,
      );

      expect(failure.message).toContain("response body");
    }),
  );

  it.effect("fails with AiError (not a defect) when the gateway binding call rejects", () =>
    Effect.gen(function* () {
      const failure = yield* expectFailureInstanceOf(
        Effect.gen(function* () {
          const model = yield* makeEmbeddingModel(binding(stubAiReject()), {
            inputType: "search_document",
          });
          return yield* model.embedMany(["text"]);
        }),
        AiError.AiError,
      );

      expect(failure.message).toContain("gateway call failed");
    }),
  );
});

// ── Reranking ────────────────────────────────────────────────────────

describe("Cohere reranker", () => {
  it.effect("posts the rerank request and maps results by descending relevance", () =>
    Effect.gen(function* () {
      const { ai, calls } = stubAi({
        status: 200,
        body: {
          results: [
            { index: 1, relevance_score: 0.9 },
            { index: 0, relevance_score: 0.2 },
          ],
          meta: { billed_units: { search_units: 1 } },
        },
      });

      const response = yield* Effect.gen(function* () {
        const reranker = yield* makeReranker(binding(ai));
        return yield* reranker.rerank({
          query: "needle",
          documents: ["hay", "needle-adjacent"],
          topN: 2,
        });
      });

      expect(calls).toEqual([
        {
          provider: "cohere",
          endpoint: "v2/rerank",
          headers: { "content-type": "application/json" },
          query: {
            model: RERANK_MODEL,
            query: "needle",
            documents: ["hay", "needle-adjacent"],
            top_n: 2,
          },
        },
      ]);
      expect(response.results.map((result) => result.index)).toEqual([1, 0]);
      expect(response.results[0]?.relevanceScore).toBe(0.9);
      expect(response.usage.inputTokens).toStrictEqual(Option.some(1));
    }),
  );

  it.effect("omits top_n when topN is not given", () =>
    Effect.gen(function* () {
      const { ai, calls } = stubAi({
        status: 200,
        body: { results: [{ index: 0, relevance_score: 1 }] },
      });

      yield* Effect.gen(function* () {
        const reranker = yield* makeReranker(binding(ai));
        return yield* reranker.rerank({ query: "q", documents: ["only"] });
      });

      expect(calls[0]).not.toHaveProperty("query.top_n");
    }),
  );

  it.effect("fails with AiError on a non-2xx status", () =>
    Effect.gen(function* () {
      const { ai } = stubAi({ status: 429, body: { message: "rate limited" } });

      const failure = yield* expectFailureInstanceOf(
        Effect.gen(function* () {
          const reranker = yield* makeReranker(binding(ai));
          return yield* reranker.rerank({ query: "q", documents: ["a", "b"] });
        }),
        AiError.AiError,
      );

      expect(failure.reason._tag).toBe("RateLimitError");
    }),
  );

  it.effect("still maps a non-2xx status when its body cannot be read", () =>
    Effect.gen(function* () {
      const ai = stubAiBinding(() => ({
        run: async () => {
          const response = new Response(null, { status: 429 });
          // The body read is best-effort: a rejected `text()` leaves the
          // description empty rather than replacing the status mapping.
          Object.defineProperty(response, "text", {
            value: () => Promise.reject(new TypeError("body stream already read")),
          });
          return response;
        },
      }));

      const failure = yield* expectFailureInstanceOf(
        Effect.gen(function* () {
          const reranker = yield* makeReranker(binding(ai));
          return yield* reranker.rerank({ query: "q", documents: ["a", "b"] });
        }),
        AiError.AiError,
      );

      expect(failure.reason._tag).toBe("RateLimitError");
    }),
  );

  it.effect("fails with AiError (not a defect) when the gateway binding call rejects", () =>
    Effect.gen(function* () {
      const failure = yield* expectFailureInstanceOf(
        Effect.gen(function* () {
          const reranker = yield* makeReranker(binding(stubAiReject()));
          return yield* reranker.rerank({ query: "q", documents: ["a", "b"] });
        }),
        AiError.AiError,
      );

      expect(failure.message).toContain("gateway call failed");
    }),
  );
});
