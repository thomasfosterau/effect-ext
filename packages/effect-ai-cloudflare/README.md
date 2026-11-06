# @thomasfosterau/effect-ai-cloudflare

Cloudflare AI for [Effect](https://effect.website), built on the official [`@effect/ai-cloudflare`](https://www.npmjs.com/package/@effect/ai-cloudflare): its Workers AI decision models, routed through the same **Cloudflare AI Gateway** as the Anthropic, Cohere and OpenAI moderation routes this package adds, by Worker binding or public HTTPS endpoint, BYOK (bring-your-own-key). Provider keys are configured once on the gateway (Cloudflare dashboard) and never live in application code or env vars: this package reads no provider API key (the ones it accepts are `OpenAiModeration`'s optional `apiKey` and Workers AI's Cloudflare API token, below). The Anthropic route repoints the upstream `@effect/ai-anthropic` client rather than reimplementing it.

Published until 0.5.1 as `@thomasfosterau/effect-ai-gateway`, which is deprecated in its favour. Moving is an import change: every export kept its name.

- **`WorkersAi`** — `@effect/ai-cloudflare`'s `CloudflareClient`, `CloudflareDecisionModel` (Clef and Clef-flash for `effect/ai`'s `DecisionModel`) and `CloudflareSchema`, re-exported unchanged, plus `cloudflareClientLayer` / `cloudflareClientLayerConfig`, which build that client from the gateway's account id and gateway id and send the gateway's `cf-aig-authorization` token, and `decisionModelLayerConfig({ model })`, the decision model over that client. Workers AI REST authenticates with a Cloudflare API token (`CF_API_TOKEN` for the `…Config` layers); decisions run over REST only, so there is no Worker-binding variant.
- **`Anthropic`** — repoints `@effect/ai-anthropic`'s client at the gateway's Anthropic route. Drop-in for `AnthropicLanguageModel.layer` + `AnthropicClient.layer`.
- **`Cohere`** — `EmbeddingModel` (`embed-v4.0`) and `RerankerModel` (`rerank-v3.5`) built directly on the gateway's universal `run()` endpoint. The `RerankerModel` abstraction itself comes from `@thomasfosterau/effect-ext/RerankerModel`; this package re-exports none of its names, so import `RerankerModel`, `make`, `RerankResponse` and the rest from there.
- **`OpenAiModeration`** — `ModerationModel` (from `@thomasfosterau/effect-ext`) backed by OpenAI `omni-moderation-latest` through the same universal endpoint. BYOK by default; an application that holds its own OpenAI key passes it as `apiKey` (a `Redacted`) and it is sent as the bearer token. Screens text and images: a batch of strings is one request; a multimodal input (`effect/ai` text and image file parts) is one request per input, its image sent as an `image_url` (a base64 `data:` URI unless it is already a URL). The provider's `flagged` verdict arrives as `ModerationResult.isFlagged`, its per-category booleans as `ModerationResult.flags`, and the dated snapshot that served the call as `ModerationResponse.modelId`. An optional `onCall` hook observes each HTTP call's status, duration and error for a cost / latency ledger.
- **`Binding` / `Url`** — the Worker-binding and public-HTTPS transports.

Every gateway route comes in a binding-based (`make…`) and a binding-free (`make…FromUrl`, config-resolved: `CF_ACCOUNT_ID`, `CF_AIG_GATEWAY_ID`, `CF_AIG_TOKEN`) variant, so callers with no Worker `AI` binding — a local CLI, a plain Node process, CI, an offline evaluation harness — can route through the gateway's public HTTPS endpoint too. All three variables are required: a missing or empty one fails layer construction with a `ConfigError`, and there is no default gateway id.

|  | Worker binding | Public HTTPS endpoint |
| --- | --- | --- |
| Anthropic `LanguageModel` | `anthropicLanguageModelLayer(binding, …)` | `anthropicLanguageModelLayerFromUrl(…)` |
| Cohere `EmbeddingModel` | `makeCohereEmbeddingModel(binding, { inputType })` | `makeCohereEmbeddingModelFromUrl({ inputType })` |
| Cohere `RerankerModel` | `makeCohereReranker(binding)` | `makeCohereRerankerFromUrl` |
| OpenAI `ModerationModel` | `makeOpenAiModerationModel(binding, options?)` | `makeOpenAiModerationModelFromUrl(options?)` |
| Workers AI `DecisionModel` | — (REST only) | `decisionModelLayerConfig({ model })`, or `CloudflareDecisionModel.layer` over `cloudflareClientLayer(…)` |

Both transports share one request body and one lenient response decode per provider, and every failure — a rejected call, a non-2xx status, an unreadable or undecodable body — is an `AiError` (`effect/ai`) naming the provider module and method.

## Install

```sh
pnpm add @thomasfosterau/effect-ai-cloudflare effect @effect/ai-cloudflare @effect/ai-anthropic
```

`effect` and `@effect/ai-cloudflare` (both `^4.0.6`: 4.0.6 is the first `@effect/ai-cloudflare` with AI Gateway routing, and it peers on `effect ^4.0.6`) and `@effect/ai-anthropic` (`^4.0.0`) are peer dependencies (`effect` must be a single copy across your app). `@thomasfosterau/effect-ext` is a dependency; add it yourself to import the `RerankerModel` / `ModerationModel` tags.

This package's published types need nothing from `@cloudflare/workers-types`: it types the Worker's `AI` binding with its own structural slice, `WorkersAiBinding` (`gateway(id)` → `{ getUrl, run }`), and provider slugs as `GatewayProvider`. So a project that type-checks with `skipLibCheck: false` and never installs `@cloudflare/workers-types` (a plain Node process using the `…FromUrl` variants, say) still type-checks it. `@cloudflare/workers-types` stays an optional peer (`>=4.20250312.0`) for your own Worker's typing: a Worker's `env.AI`, typed `Ai` by that package, is assignable to `WorkersAiBinding`, so you pass it unchanged. The floor is the first release whose `AiGateway` declares `getUrl()`; an older release's `env.AI` is not assignable, so upgrade it.

## Usage

```ts
import { Effect, Layer, Schema } from "effect";
import { Decision, DecisionModel, LanguageModel } from "effect/ai";
import { ModerationModel } from "@thomasfosterau/effect-ext";
import {
  anthropicLanguageModelLayer,
  decisionModelLayerConfig,
  makeCohereRerankerFromUrl,
  makeOpenAiModerationModel,
} from "@thomasfosterau/effect-ai-cloudflare";

// Inside a Worker with an `AI` binding. `Ai` is from @cloudflare/workers-types,
// and any `WorkersAiBinding` works too.
declare const env: { AI: Ai };
const gateway = { ai: env.AI, gatewayId: "my-gateway" };

const layer = anthropicLanguageModelLayer(gateway, { model: "claude-sonnet-4-5" });
const program = LanguageModel.generateText({ prompt: "Hello" }).pipe(Effect.provide(layer));

// Moderation as a ModerationModel service.
const moderationLayer = Layer.effect(
  ModerationModel.ModerationModel,
  makeOpenAiModerationModel(gateway),
);

// A plain Node process (an evaluation harness, say): the reranker over the
// gateway's HTTPS endpoint. Config is read once, at construction.
declare const documents: ReadonlyArray<string>;
const rerank = Effect.gen(function* () {
  const reranker = yield* makeCohereRerankerFromUrl;
  return yield* reranker.rerank({ query: "fiber interruption", documents, topN: 20 });
});

// A Workers AI decision (Clef-flash) through the same gateway. Reads
// CF_ACCOUNT_ID, CF_AIG_GATEWAY_ID, CF_AIG_TOKEN and CF_API_TOKEN.
const Triage = Decision.make({
  input: Schema.String,
  decisions: { urgent: Decision.probability({ instructions: "Does this need attention now?" }) },
});
const urgent = DecisionModel.decide(Triage, { input: "Checkout is failing." }).pipe(
  Effect.provide(decisionModelLayerConfig({ model: "clef-flash" })),
);
```

## Lower-level exports

The provider builders above are made from these, exported for routing a provider this package does not cover:

| Export | What it is |
| --- | --- |
| `GatewayBinding` | `{ ai: WorkersAiBinding; gatewayId: string }`: the Worker's `env.AI` plus the gateway id to route through. |
| `WorkersAiBinding`, `WorkersAiGateway`, `GatewayRunOptions` | The structural slice of the Workers `Ai` binding the gateway calls (`gateway(id)` → `getUrl(provider)`, `run(request, { signal })`). |
| `GatewayProvider` | The provider slugs the gateway routes (`"anthropic"`, `"cohere"`, `"openai"`, …). |
| `GatewayUniversalRequest` | One step of a universal-endpoint request: `provider`, `endpoint`, `headers`, `query`. |
| `gatewayUrl(binding, provider)` | The provider's base URL on the gateway, resolved through the binding: pass it as an upstream client's `apiUrl`. |
| `gatewayRun(binding, request)` | Calls the universal endpoint through the binding; interrupting the effect aborts the request. |
| `gatewayUrlConfig` | A `Config<GatewayUrlConfig>` reading `CF_ACCOUNT_ID`, `CF_AIG_GATEWAY_ID` and `CF_AIG_TOKEN` (a `Redacted`). |
| `gatewayBaseUrl(config, provider)` | `https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/<provider>`. |
| `cfAigAuthorizationHeader(config)` | The `{ "cf-aig-authorization": "Bearer …" }` header the public endpoint authenticates with. |
| `CohereEmbeddingOptions`, `OpenAiModerationOptions` | The builders' options: `inputType` (`"search_document"` / `"search_query"`); `apiKey?`, `model?`, `onCall?`. |
| `OpenAiModerationCall` | What `onCall` sees for one settled HTTP call: `status` (`undefined` if the transport failed before a response), `durationMillis`, `error` (the `AiError`, or `undefined`). |
| `CloudflareClientOptions` | `cloudflareClientLayer`'s options: `gateway` (a `GatewayUrlConfig`), `apiToken`, `apiUrl?`, `transformClient?`. |
| `COHERE_EMBEDDING_MODEL`, `COHERE_EMBEDDING_DIMENSIONS`, `COHERE_RERANK_MODEL`, `OPENAI_MODERATION_MODEL` | The pinned models: `embed-v4.0` at 1024 dimensions, `rerank-v3.5`, `omni-moderation-latest` (the moderation default; `model` overrides it). |

To route a first-party provider client (`@thomasfosterau/effect-ai-mistral`, `-cohere`, `-voyage`, `-elevenlabs`) through the gateway instead, pass `gatewayUrl(...)` or `gatewayBaseUrl(...)` as its client's `apiUrl` and omit its `apiKey`; over the public endpoint, also set `cfAigAuthorizationHeader(...)` on each request through the client's `transformClient`, as `anthropicLanguageModelLayerFromUrl` does.

## License

MIT
