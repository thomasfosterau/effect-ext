/**
 * Unit tests for the first-party Voyage AI Effect AI provider
 * (`src/VoyageClient.ts`, `src/VoyageEmbeddingModel.ts`,
 * `src/VoyageRerankerModel.ts`).
 *
 * The network is stubbed at `FetchHttpClient.Fetch` — the same technique the
 * Mistral package's tests use. Each stub captures the outgoing request (URL,
 * `authorization` header, JSON body) and returns a canned Voyage response, so
 * the tests exercise request construction and response decoding without
 * reaching the network. No live key or live network is involved.
 *
 * @module tests/voyage
 */

import { describe, expect, it, layer } from "@effect/vitest";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Layer from "effect/Layer";
import * as R from "effect/Record";
import * as Redacted from "effect/Redacted";
import { AiError, EmbeddingModel } from "effect/ai";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { RerankerModel } from "@thomasfosterau/effect-ext";
import {
  VoyageClient,
  VoyageEmbeddingModel,
  VoyageRerankerModel,
} from "@thomasfosterau/effect-ai-voyage";
import { expectFailureInstanceOf } from "./helpers/effect";

// ── Fetch stubbing ────────────────────────────────────────────────────

interface CapturedRequest {
  readonly url: string;
  readonly authorization: Option.Option<string>;
  readonly headers: Record<string, string>;
  readonly body: Record<string, unknown>;
}

const makeFetch = (respond: (captured: CapturedRequest) => Response) => {
  const calls: Array<CapturedRequest> = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const body = (await request
      .clone()
      .json()
      .catch(() => ({}))) as Record<string, unknown>;
    const captured: CapturedRequest = {
      url: request.url,
      authorization: Option.fromNullishOr(request.headers.get("authorization")),
      headers: R.fromEntries(request.headers),
      body,
    };
    calls.push(captured);
    return respond(captured);
  };
  return { calls, fetch };
};

const jsonResponse = (body: unknown, status = 200): Response => Response.json(body, { status });

const embeddingBody = (
  vectors: ReadonlyArray<ReadonlyArray<number>>,
  over?: Record<string, unknown>,
) => ({
  object: "list",
  data: vectors.map((embedding, index) => ({ object: "embedding", embedding, index })),
  model: "voyage-3-large",
  usage: { total_tokens: 10 },
  ...over,
});

const rerankBody = (
  results: ReadonlyArray<{ index: number; relevance_score: number }>,
  over?: Record<string, unknown>,
) => ({
  object: "list",
  data: results.map((r) => ({ index: r.index, relevance_score: r.relevance_score })),
  model: "rerank-2.5",
  usage: { total_tokens: 26 },
  ...over,
});

// ── Layers ────────────────────────────────────────────────────────────

const embeddingLayer = (options?: {
  readonly apiKey?: Redacted.Redacted;
  readonly model?: VoyageEmbeddingModel.Options;
}) =>
  VoyageEmbeddingModel.layer(options?.model ?? { model: "voyage-3-large" }).pipe(
    Layer.provide(VoyageClient.layer({ apiKey: options?.apiKey ?? Redacted.make("test-key") })),
    Layer.provide(FetchHttpClient.layer),
  );

const rerankerLayer = (options?: {
  readonly apiKey?: Redacted.Redacted;
  readonly model?: VoyageRerankerModel.Options;
}) =>
  VoyageRerankerModel.layer(options?.model ?? { model: "rerank-2.5" }).pipe(
    Layer.provide(VoyageClient.layer({ apiKey: options?.apiKey ?? Redacted.make("test-key") })),
    Layer.provide(FetchHttpClient.layer),
  );

const embedMany = (inputs: ReadonlyArray<string>) =>
  Effect.flatMap(EmbeddingModel.EmbeddingModel, (model) => model.embedMany(inputs));

const embed = (input: string) =>
  Effect.flatMap(EmbeddingModel.EmbeddingModel, (model) => model.embed(input));

const rerank = (options: RerankerModel.RerankOptions) =>
  Effect.flatMap(RerankerModel.RerankerModel, (model) => model.rerank(options));

// ── Embeddings ────────────────────────────────────────────────────────

describe("VoyageEmbeddingModel", () => {
  layer(embeddingLayer())((t) => {
    t.effect("posts to the embeddings endpoint with a bearer token and decodes vectors", () =>
      Effect.gen(function* () {
        const { calls, fetch } = makeFetch(() =>
          jsonResponse(
            embeddingBody([
              [0.1, 0.2],
              [0.3, 0.4],
            ]),
          ),
        );

        const response = yield* embedMany(["a", "b"]).pipe(
          Effect.provideService(FetchHttpClient.Fetch, fetch),
        );

        expect(calls).toHaveLength(1);
        expect(calls[0]?.url).toBe("https://api.voyageai.com/v1/embeddings");
        expect(calls[0]?.authorization).toEqual(Option.some("Bearer test-key"));
        expect(calls[0]?.body.model).toBe("voyage-3-large");
        expect(calls[0]?.body.input).toEqual(["a", "b"]);
        expect(response.embeddings.map((e) => e.vector)).toEqual([
          [0.1, 0.2],
          [0.3, 0.4],
        ]);
        expect(response.usage.inputTokens).toBe(10);
      }),
    );
  });

  layer(
    embeddingLayer({
      model: { model: "voyage-3-large", inputType: "document", outputDimension: 256 },
    }),
  )((t) => {
    t.effect("threads inputType and outputDimension into the request", () =>
      Effect.gen(function* () {
        const { calls, fetch } = makeFetch(() => jsonResponse(embeddingBody([[0.1]])));

        yield* embedMany(["doc"]).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch));

        expect(calls[0]?.body.input_type).toBe("document");
        expect(calls[0]?.body.output_dimension).toBe(256);
      }),
    );
  });

  layer(embeddingLayer())((t) => {
    t.effect("omits input_type and output_dimension when unset", () =>
      Effect.gen(function* () {
        const { calls, fetch } = makeFetch(() => jsonResponse(embeddingBody([[0.1]])));

        yield* embedMany(["x"]).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch));

        expect(calls[0]?.body).not.toHaveProperty("input_type");
        expect(calls[0]?.body).not.toHaveProperty("output_dimension");
      }),
    );

    t.effect("reorders decoded vectors by their reported index", () =>
      Effect.gen(function* () {
        const { fetch } = makeFetch(() =>
          jsonResponse({
            object: "list",
            data: [
              { object: "embedding", embedding: [0.2], index: 1 },
              { object: "embedding", embedding: [0.1], index: 0 },
            ],
            model: "voyage-3-large",
            usage: { total_tokens: 4 },
          }),
        );

        const response = yield* embedMany(["a", "b"]).pipe(
          Effect.provideService(FetchHttpClient.Fetch, fetch),
        );

        expect(response.embeddings.map((e) => e.vector)).toEqual([[0.1], [0.2]]);
      }),
    );

    t.effect("embeds a single input via the request resolver", () =>
      Effect.gen(function* () {
        const { calls, fetch } = makeFetch(() => jsonResponse(embeddingBody([[0.5, 0.6]])));

        const response = yield* embed("solo").pipe(
          Effect.provideService(FetchHttpClient.Fetch, fetch),
        );

        expect(response.vector).toEqual([0.5, 0.6]);
        expect(calls[0]?.body.input).toEqual(["solo"]);
      }),
    );

    t.effect("returns an empty response for embedMany([]) without calling Voyage", () =>
      Effect.gen(function* () {
        const { calls, fetch } = makeFetch(() => jsonResponse(embeddingBody([])));

        const response = yield* embedMany([]).pipe(
          Effect.provideService(FetchHttpClient.Fetch, fetch),
        );

        expect(response.embeddings).toHaveLength(0);
        expect(calls).toHaveLength(0);
      }),
    );
  });

  layer(
    VoyageEmbeddingModel.layer({ model: "voyage-3.5" }).pipe(
      Layer.provide(VoyageClient.layer({})),
      Layer.provide(FetchHttpClient.layer),
    ),
  )((t) => {
    t.effect("omits the authorization header when constructed without an API key", () =>
      Effect.gen(function* () {
        const { calls, fetch } = makeFetch(() => jsonResponse(embeddingBody([[0.1]])));

        yield* embedMany(["x"]).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch));

        expect(calls[0]?.authorization).toEqual(Option.none());
      }),
    );
  });

  layer(embeddingLayer())((t) => {
    t.effect("maps a non-2xx status to an AiError", () =>
      Effect.gen(function* () {
        const { fetch } = makeFetch(() => jsonResponse({ detail: "rate limited" }, 429));

        yield* expectFailureInstanceOf(
          embedMany(["x"]).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch)),
          AiError.AiError,
        );
      }),
    );

    t.effect("maps an undecodable success body to an AiError", () =>
      Effect.gen(function* () {
        const { fetch } = makeFetch(() => jsonResponse({ not: "an embeddings response" }));

        yield* expectFailureInstanceOf(
          embedMany(["x"]).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch)),
          AiError.AiError,
        );
      }),
    );

    t.effect("maps a success body that is not JSON at all to an InvalidOutputError", () =>
      Effect.gen(function* () {
        const { fetch } = makeFetch(
          () =>
            new Response("not json", {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
        );

        const error = yield* expectFailureInstanceOf(
          embedMany(["x"]).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch)),
          AiError.AiError,
        );
        expect(error.reason._tag).toBe("InvalidOutputError");
      }),
    );
  });
});

// ── apiUrl override (BYOK routing contract) ───────────────────────────

describe("VoyageClient apiUrl override", () => {
  layer(
    VoyageEmbeddingModel.layer({ model: "voyage-3-large" }).pipe(
      Layer.provide(
        VoyageClient.layer({
          apiKey: Redacted.make("gw-key"),
          apiUrl: "https://gateway.example/voyage",
        }),
      ),
      Layer.provide(FetchHttpClient.layer),
    ),
  )((t) => {
    t.effect("routes requests through the overridden base URL", () =>
      Effect.gen(function* () {
        const { calls, fetch } = makeFetch(() => jsonResponse(embeddingBody([[0.1]])));

        yield* embedMany(["x"]).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch));

        expect(calls[0]?.url).toBe("https://gateway.example/voyage/v1/embeddings");
        expect(calls[0]?.authorization).toEqual(Option.some("Bearer gw-key"));
      }),
    );
  });

  layer(
    VoyageRerankerModel.layer({ model: "rerank-2.5" }).pipe(
      Layer.provide(
        VoyageClient.layerConfig({
          apiKey: Config.succeed(Redacted.make("cfg-key")),
          apiUrl: Config.succeed("https://proxy.example"),
        }),
      ),
      Layer.provide(FetchHttpClient.layer),
    ),
  )((t) => {
    t.effect("loads apiUrl and apiKey through a Config-driven client layer", () =>
      Effect.gen(function* () {
        const { calls, fetch } = makeFetch(() =>
          jsonResponse(rerankBody([{ index: 0, relevance_score: 0.9 }])),
        );

        yield* rerank({ query: "q", documents: ["d"] }).pipe(
          Effect.provideService(FetchHttpClient.Fetch, fetch),
        );

        expect(calls[0]?.url).toBe("https://proxy.example/v1/rerank");
        expect(calls[0]?.authorization).toEqual(Option.some("Bearer cfg-key"));
      }),
    );
  });
});

// ── Reranking ─────────────────────────────────────────────────────────

layer(rerankerLayer())("VoyageRerankerModel", (t) => {
  t.effect("posts to the rerank endpoint, maps topN to top_k, and sorts by relevance", () =>
    Effect.gen(function* () {
      const { calls, fetch } = makeFetch(() =>
        jsonResponse(
          rerankBody([
            { index: 0, relevance_score: 0.2 },
            { index: 2, relevance_score: 0.9 },
          ]),
        ),
      );

      const response = yield* rerank({
        query: "what is effect?",
        documents: ["a", "b", "c"],
        topN: 2,
      }).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch));

      expect(calls[0]?.url).toBe("https://api.voyageai.com/v1/rerank");
      expect(calls[0]?.body.model).toBe("rerank-2.5");
      expect(calls[0]?.body.query).toBe("what is effect?");
      expect(calls[0]?.body.documents).toEqual(["a", "b", "c"]);
      expect(calls[0]?.body.top_k).toBe(2);
      expect(response.results.map((r) => r.index)).toEqual([2, 0]);
      expect(response.results[0]?.relevanceScore).toBe(0.9);
      expect(response.usage.inputTokens).toStrictEqual(Option.some(26));
    }),
  );

  t.effect("omits top_k when topN is unset", () =>
    Effect.gen(function* () {
      const { calls, fetch } = makeFetch(() =>
        jsonResponse(rerankBody([{ index: 0, relevance_score: 0.5 }])),
      );

      yield* rerank({ query: "q", documents: ["a"] }).pipe(
        Effect.provideService(FetchHttpClient.Fetch, fetch),
      );

      expect(calls[0]?.body).not.toHaveProperty("top_k");
    }),
  );

  t.effect("short-circuits an empty documents array without calling Voyage", () =>
    Effect.gen(function* () {
      const { calls, fetch } = makeFetch(() => jsonResponse(rerankBody([])));

      const response = yield* rerank({ query: "q", documents: [] }).pipe(
        Effect.provideService(FetchHttpClient.Fetch, fetch),
      );

      expect(response.results).toHaveLength(0);
      expect(calls).toHaveLength(0);
    }),
  );

  t.effect("fails with an AiError when the provider returns an out-of-range index", () =>
    Effect.gen(function* () {
      const { fetch } = makeFetch(() =>
        jsonResponse(rerankBody([{ index: 5, relevance_score: 0.5 }])),
      );

      yield* expectFailureInstanceOf(
        rerank({ query: "q", documents: ["a", "b"] }).pipe(
          Effect.provideService(FetchHttpClient.Fetch, fetch),
        ),
        AiError.AiError,
      );
    }),
  );

  t.effect("maps a non-2xx status to an AiError", () =>
    Effect.gen(function* () {
      const { fetch } = makeFetch(() => jsonResponse({ detail: "bad request" }, 400));

      yield* expectFailureInstanceOf(
        rerank({ query: "q", documents: ["a"] }).pipe(
          Effect.provideService(FetchHttpClient.Fetch, fetch),
        ),
        AiError.AiError,
      );
    }),
  );

  t.effect("maps an undecodable success body to an InvalidOutputError", () =>
    Effect.gen(function* () {
      const { fetch } = makeFetch(() => jsonResponse({ not: "a rerank response" }));

      const error = yield* expectFailureInstanceOf(
        rerank({ query: "q", documents: ["a"] }).pipe(
          Effect.provideService(FetchHttpClient.Fetch, fetch),
        ),
        AiError.AiError,
      );
      expect(error.reason._tag).toBe("InvalidOutputError");
    }),
  );
});

// ── Client-level behaviour ────────────────────────────────────────────

/** A fetch stub that rejects, simulating a transport-level failure. */
const networkDownFetch: typeof globalThis.fetch = async () => {
  throw new TypeError("network down");
};

describe("VoyageClient", () => {
  layer(embeddingLayer())((t) => {
    t.effect("maps a transport failure to an AiError", () =>
      expectFailureInstanceOf(
        embedMany(["x"]).pipe(Effect.provideService(FetchHttpClient.Fetch, networkDownFetch)),
        AiError.AiError,
      ),
    );
  });

  layer(
    VoyageEmbeddingModel.layer({ model: "voyage-3-large" }).pipe(
      Layer.provide(
        VoyageClient.layer({
          apiKey: Redacted.make("k"),
          transformClient: (client) =>
            HttpClient.mapRequest(client, HttpClientRequest.setHeader("x-test", "1")),
        }),
      ),
      Layer.provide(FetchHttpClient.layer),
    ),
  )((t) => {
    t.effect("applies a transformClient to outgoing requests", () =>
      Effect.gen(function* () {
        const { calls, fetch } = makeFetch(() => jsonResponse(embeddingBody([[0.1]])));

        yield* embedMany(["x"]).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch));

        expect(calls[0]?.headers["x-test"]).toBe("1");
      }),
    );
  });
});

// ── Model / dimension matrix ──────────────────────────────────────────

describe("VoyageEmbeddingModel.EMBEDDING_MODELS", () => {
  it.each(["voyage-3-large", "voyage-3.5", "voyage-3.5-lite", "voyage-code-3"] as const)(
    "documents the Matryoshka model %s with four selectable dimensions and a 1024 default",
    (id) => {
      const info = VoyageEmbeddingModel.EMBEDDING_MODELS[id];
      expect(info.defaultDimension).toBe(1024);
      expect(info.dimensions).toEqual([256, 512, 1024, 2048]);
    },
  );

  it("documents fixed-dimension models with a single dimension entry", async () => {
    expect(VoyageEmbeddingModel.EMBEDDING_MODELS["voyage-code-2"].defaultDimension).toBe(1536);
    expect(VoyageEmbeddingModel.EMBEDDING_MODELS["voyage-3-lite"].defaultDimension).toBe(512);
  });

  it.each(R.toEntries(VoyageEmbeddingModel.EMBEDDING_MODELS))(
    "lists the %s model's default dimension among its dimensions",
    (_id, info) => {
      expect(info.dimensions).toContain(info.defaultDimension);
    },
  );

  it("resolves a known model's default dimension and none for an unknown id", async () => {
    expect(VoyageEmbeddingModel.defaultDimension("voyage-3-large")).toEqual(Option.some(1024));
    expect(VoyageEmbeddingModel.defaultDimension("nonexistent-model")).toEqual(Option.none());
  });
});
