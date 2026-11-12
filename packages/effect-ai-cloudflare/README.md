# @thomasfosterau/effect-ai-cloudflare

Cloudflare AI for [Effect](https://effect.website), built on the official [`@effect/ai-cloudflare`](https://www.npmjs.com/package/@effect/ai-cloudflare): its Workers AI decision models, plus Anthropic, Cohere and OpenAI moderation routed through a **Cloudflare AI Gateway** by Worker binding or public HTTPS endpoint. Provider keys are BYOK, configured on the gateway and never in application code. Formerly `@thomasfosterau/effect-ai-gateway` (deprecated; every export kept its name).

## Install

```sh
pnpm add @thomasfosterau/effect-ai-cloudflare @thomasfosterau/effect-ext effect @effect/ai-cloudflare @effect/ai-anthropic
```

`effect` and `@effect/ai-cloudflare` (`^4.0.6`, the first `@effect/ai-cloudflare` with AI Gateway routing) and `@effect/ai-anthropic` (`^4.0.0`) are peer dependencies: `effect` must be a single copy across your app. `@cloudflare/workers-types` (`>=4.20250312.0`) is an optional peer, for your own Worker's typing. `@thomasfosterau/effect-ext` is a dependency; add it yourself to import the `RerankerModel` / `ModerationModel` tags.

## Example

```ts
import { Effect } from "effect";
import { LanguageModel } from "effect/ai";
import { anthropicLanguageModelLayer } from "@thomasfosterau/effect-ai-cloudflare";

// Inside a Worker with an `AI` binding (`Ai` is from @cloudflare/workers-types).
declare const env: { AI: Ai };

const layer = anthropicLanguageModelLayer(
  { ai: env.AI, gatewayId: "my-gateway" },
  { model: "claude-sonnet-4-5" },
);

const program = LanguageModel.generateText({ prompt: "Hello" }).pipe(Effect.provide(layer));
```

## Modules

| Module | What it is |
| --- | --- |
| `Anthropic` | `anthropicLanguageModelLayer` / `…FromUrl`: repoints `@effect/ai-anthropic`'s client at the gateway's Anthropic route. |
| `Cohere` | `EmbeddingModel` (`embed-v4.0`) and `RerankerModel` (`rerank-v3.5`) through the gateway's universal endpoint. |
| `OpenAiModeration` | A `ModerationModel` over `omni-moderation-latest`, for text and images. |
| `WorkersAi` | `@effect/ai-cloudflare`'s `CloudflareClient` and `CloudflareDecisionModel`, wired to the gateway (REST only). |
| `Binding` | The Worker-binding transport: `GatewayBinding`, `gatewayUrl`, `gatewayRun`. |
| `Url` | The public-HTTPS transport: `gatewayUrlConfig` (`CF_ACCOUNT_ID`, `CF_AIG_GATEWAY_ID`, `CF_AIG_TOKEN`), `gatewayBaseUrl`, `cfAigAuthorizationHeader`. |

Every route has a binding variant (`make…`) and a binding-free `…FromUrl` variant for a plain Node process, CLI or CI. Every failure is an `AiError`. Per-export detail is in the [source doc comments](https://github.com/thomasfosterau/effect-ext/tree/trunk/packages/effect-ai-cloudflare/src).

## Links

- [Source and API doc comments](https://github.com/thomasfosterau/effect-ext/tree/trunk/packages/effect-ai-cloudflare)
- [Repository README](https://github.com/thomasfosterau/effect-ext/blob/trunk/README.md)
- [Contributing](https://github.com/thomasfosterau/effect-ext/blob/trunk/CONTRIBUTING.md)
- [Cloudflare AI Gateway docs](https://developers.cloudflare.com/ai-gateway/)

## License

MIT
