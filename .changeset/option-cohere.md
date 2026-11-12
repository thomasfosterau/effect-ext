---
"@thomasfosterau/effect-ai-cohere": minor
---

Absence is spelled the way the rest of the workspace spells it (#17): options-object members are `x?: T` (no `| undefined`), and the mapper converts the wire's `null` / omitted values to `Option` at the boundary. Breaking on 0.x.

- `CohereClient.Options` (`apiKey`, `apiUrl`, `transformClient`), `CohereEmbeddingModel` / `CohereRerankerModel` / `CohereClassifierModel` settings and `CohereLanguageModel.ConfigService` members: `x?: T | undefined` is now `x?: T`. A caller holding `undefined` omits the key or uses `Struct.pick`.
- `CohereClient.layerConfig`'s `apiKey`: `Config.Config<Redacted | undefined>` is now `Config.Config<Redacted>`; omit the setting for no key.
- `CohereLanguageModel.model(name, config?)` and the `layer` / `make` `config` member: `config?: T | undefined` is now `config?: T` (and `model`'s defaults to `{}`).
- The wire request interfaces' tool-call `arguments` and tool-message `content` are omitted keys (`x?: string`) rather than `string | undefined`; the JSON sent is unchanged.
