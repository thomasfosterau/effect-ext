---
"@thomasfosterau/effect-ai-voyage": minor
---

Absence is spelled the way the rest of the workspace spells it (#17). Breaking on 0.x.

- `VoyageClient.Options` (`apiKey`, `apiUrl`, `transformClient`), `VoyageEmbeddingModel` settings (`inputType`, `outputDimension`, `truncation`) and `VoyageRerankerModel` settings (`truncation`): `x?: T | undefined` is now `x?: T`.
- `VoyageClient.layerConfig`'s `apiKey`: `Config.Config<Redacted | undefined>` is now `Config.Config<Redacted>`; omit the setting for no key.
- `VoyageEmbeddingModel.defaultDimension(model)`: `number | undefined` is now `Option.Option<number>`.
- `inputType`: `"query" | "document" | null` is now `"query" | "document"`; omit it (formerly `null`) to embed the text as-is.
