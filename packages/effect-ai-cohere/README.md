# @thomasfosterau/effect-ai-cohere

A first-party [Effect](https://effect.website) AI provider for **Cohere**'s v2 API: `LanguageModel` and `EmbeddingModel` from `effect/ai`, and `RerankerModel` and `ClassifierModel` from [`@thomasfosterau/effect-ext`](https://github.com/thomasfosterau/effect-ext/tree/trunk/packages/effect-ext). Its `apiUrl` option repoints the client at a proxy or a routing layer such as `@thomasfosterau/effect-ai-cloudflare` (BYOK).

## Install

```sh
pnpm add @thomasfosterau/effect-ai-cohere @thomasfosterau/effect-ext effect
```

`effect` (`^4.1.0`) is a peer dependency: it must be a single copy across your app. `@thomasfosterau/effect-ext` is a dependency; add it yourself to import the `RerankerModel` / `ClassifierModel` tags.

## Example

```ts
import { Config, Effect, Layer } from "effect";
import { LanguageModel } from "effect/ai";
import { FetchHttpClient } from "effect/http";
import { CohereClient, CohereLanguageModel } from "@thomasfosterau/effect-ai-cohere";

const CohereClientLive = CohereClient.layerConfig({
  apiKey: Config.Redacted("COHERE_API_KEY"),
}).pipe(Layer.provide(FetchHttpClient.layer));

const CohereLive = CohereLanguageModel.layer({ model: "command-a-03-2025" }).pipe(
  Layer.provide(CohereClientLive),
);

const program = LanguageModel.generateText({ prompt: "Explain Effect in one line" }).pipe(
  Effect.map((response) => response.text),
  Effect.provide(CohereLive),
);
```

## Modules

| Module | What it is |
| --- | --- |
| `CohereClient` | The HTTP client service for `/v2/chat` (with SSE), `/v2/embed` and `/v2/rerank` (`make` / `layer` / `layerConfig`). |
| `CohereLanguageModel` | The `LanguageModel` layer over Command chat models, with request `Config` and `withConfigOverride`. |
| `CohereEmbeddingModel` | The `EmbeddingModel` layer over `/v2/embed` (default `embed-v4.0`, 1024 dimensions). |
| `CohereRerankerModel` | The `RerankerModel` layer over `/v2/rerank` (default `rerank-v3.5`). |
| `CohereClassifierModel` | The `ClassifierModel` layer, backed by chat with structured output. |

Every failure leaves the provider as an `AiError`. Per-export detail is in the [source doc comments](https://github.com/thomasfosterau/effect-ext/tree/trunk/packages/effect-ai-cohere/src).

## Links

- [Source and API doc comments](https://github.com/thomasfosterau/effect-ext/tree/trunk/packages/effect-ai-cohere)
- [Repository README](https://github.com/thomasfosterau/effect-ext/blob/trunk/README.md)
- [Contributing](https://github.com/thomasfosterau/effect-ext/blob/trunk/CONTRIBUTING.md)
- [Cohere API docs](https://docs.cohere.com/reference/about)

## License

MIT
