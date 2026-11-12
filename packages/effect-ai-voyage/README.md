# @thomasfosterau/effect-ai-voyage

An [Effect](https://effect.website) AI provider for **Voyage AI**: an `effect/ai` `EmbeddingModel` over `/v1/embeddings` and a `@thomasfosterau/effect-ext` `RerankerModel` over `/v1/rerank`. Its `apiUrl` option repoints the client at a proxy or a routing layer such as `@thomasfosterau/effect-ai-cloudflare` (BYOK).

## Install

```sh
pnpm add @thomasfosterau/effect-ai-voyage @thomasfosterau/effect-ext effect
```

`effect` (`^4.1.0`) is a peer dependency: it must be a single copy across your app. `@thomasfosterau/effect-ext` is a dependency; add it yourself to import the `RerankerModel` tag.

## Example

```ts
import { Config, Effect, Layer } from "effect";
import { EmbeddingModel } from "effect/ai";
import { FetchHttpClient } from "effect/http";
import { VoyageClient, VoyageEmbeddingModel } from "@thomasfosterau/effect-ai-voyage";

const ModelLayer = VoyageEmbeddingModel.layer({
  model: "voyage-3-large",
  inputType: "document",
}).pipe(
  Layer.provide(VoyageClient.layerConfig({ apiKey: Config.Redacted("VOYAGE_API_KEY") })),
  Layer.provide(FetchHttpClient.layer),
);

const program = Effect.flatMap(EmbeddingModel.EmbeddingModel, (model) =>
  model.embedMany(["hello", "world"]),
).pipe(
  Effect.map((response) => response.embeddings),
  Effect.provide(ModelLayer),
);
```

## Modules

| Module | What it is |
| --- | --- |
| `VoyageClient` | The HTTP client service (`make` / `layer` / `layerConfig`), with `apiKey`, `apiUrl` and `transformClient` options. |
| `VoyageEmbeddingModel` | The `EmbeddingModel` layer, with `inputType`, `outputDimension` and the `EMBEDDING_MODELS` dimension matrix. |
| `VoyageRerankerModel` | The `RerankerModel` layer and the `RERANKER_MODELS` ids. |

Every failure leaves the provider as an `AiError`. Per-export detail is in the [source doc comments](https://github.com/thomasfosterau/effect-ext/tree/trunk/packages/effect-ai-voyage/src).

## Links

- [Source and API doc comments](https://github.com/thomasfosterau/effect-ext/tree/trunk/packages/effect-ai-voyage)
- [Repository README](https://github.com/thomasfosterau/effect-ext/blob/trunk/README.md)
- [Contributing](https://github.com/thomasfosterau/effect-ext/blob/trunk/CONTRIBUTING.md)
- [Voyage AI API docs](https://docs.voyageai.com/reference/embeddings-api)

## License

MIT
