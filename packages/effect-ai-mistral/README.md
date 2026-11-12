# @thomasfosterau/effect-ai-mistral

An [Effect](https://effect.website) AI provider for **Mistral**: the `LanguageModel` service from `effect/ai` over Mistral's OpenAI-compatible `/v1/chat/completions` API (text, streaming, structured output, tools). Its `apiUrl` option repoints the client at a proxy or a routing layer such as `@thomasfosterau/effect-ai-cloudflare` (BYOK).

## Install

```sh
pnpm add @thomasfosterau/effect-ai-mistral effect
```

`effect` (`^4.1.0`) is a peer dependency: it must be a single copy across your app.

## Example

```ts
import { Config, Effect, Layer } from "effect";
import { LanguageModel } from "effect/ai";
import { FetchHttpClient } from "effect/http";
import { MistralClient, MistralLanguageModel } from "@thomasfosterau/effect-ai-mistral";

const MistralLive = MistralLanguageModel.layer({ model: "mistral-large-latest" }).pipe(
  Layer.provide(MistralClient.layerConfig({ apiKey: Config.Redacted("MISTRAL_API_KEY") })),
  Layer.provide(FetchHttpClient.layer),
);

const program = LanguageModel.generateText({ prompt: "Explain Effect in one line" }).pipe(
  Effect.map((response) => response.text),
  Effect.provide(MistralLive),
);
```

## Modules

| Module | What it is |
| --- | --- |
| `MistralClient` | The HTTP client service (`make` / `layer` / `layerConfig`), with `apiKey`, `apiUrl` and `transformClient` options. |
| `MistralLanguageModel` | The `LanguageModel` layer, model descriptor, request `Config` and `withConfigOverride`. |

Every failure leaves the provider as an `AiError`. Per-export detail is in the [source doc comments](https://github.com/thomasfosterau/effect-ext/tree/trunk/packages/effect-ai-mistral/src).

## Links

- [Source and API doc comments](https://github.com/thomasfosterau/effect-ext/tree/trunk/packages/effect-ai-mistral)
- [Repository README](https://github.com/thomasfosterau/effect-ext/blob/trunk/README.md)
- [Contributing](https://github.com/thomasfosterau/effect-ext/blob/trunk/CONTRIBUTING.md)
- [Mistral API docs](https://docs.mistral.ai/api/)

## License

MIT
