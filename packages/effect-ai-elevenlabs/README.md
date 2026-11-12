# @thomasfosterau/effect-ai-elevenlabs

An [Effect](https://effect.website) AI provider for **ElevenLabs**: the `SpeechModel` (text-to-speech, one-shot and backpressured streaming), `TranscriptionModel` (Scribe speech-to-text) and `VoiceConversionModel` (speech-to-speech) abstractions from [`@thomasfosterau/effect-ext`](https://github.com/thomasfosterau/effect-ext/tree/trunk/packages/effect-ext). Its `apiUrl` option repoints the client at a proxy or a routing layer such as `@thomasfosterau/effect-ai-cloudflare` (BYOK).

## Install

```sh
pnpm add @thomasfosterau/effect-ai-elevenlabs @thomasfosterau/effect-ext effect
```

`effect` (`^4.1.0`) is a peer dependency: it must be a single copy across your app. `@thomasfosterau/effect-ext` is a dependency, listed above because you import the service tags (`SpeechModel`, …) from it.

## Example

```ts
import { Config, Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import * as SpeechModel from "@thomasfosterau/effect-ext/SpeechModel";
import { ElevenLabsClient, ElevenLabsSpeechModel } from "@thomasfosterau/effect-ai-elevenlabs";

const SpeechLayer = ElevenLabsSpeechModel.layer({
  voiceId: "21m00Tcm4TlvDq8ikWAM",
  modelId: "eleven_multilingual_v2",
}).pipe(
  Layer.provide(ElevenLabsClient.layerConfig({ apiKey: Config.Redacted("ELEVENLABS_API_KEY") })),
  Layer.provide(FetchHttpClient.layer),
);

const speak = Effect.flatMap(SpeechModel.SpeechModel, (model) =>
  model.generate({ text: "Hello from Effect" }),
).pipe(Effect.provide(SpeechLayer));
```

## Modules

| Module | What it is |
| --- | --- |
| `ElevenLabsClient` | The HTTP client service (`make` / `layer` / `layerConfig`); the key is sent as the `xi-api-key` header. |
| `ElevenLabsSpeechModel` | The `SpeechModel` layer: `generate` for the full audio, `stream` for audio chunks. |
| `ElevenLabsTranscriptionModel` | The `TranscriptionModel` layer over Scribe, with word timestamps and detected language. |
| `ElevenLabsVoiceConversionModel` | The `VoiceConversionModel` layer (speech-to-speech). |

Every failure leaves the provider as an `AiError`. Per-export detail is in the [source doc comments](https://github.com/thomasfosterau/effect-ext/tree/trunk/packages/effect-ai-elevenlabs/src).

## Links

- [Source and API doc comments](https://github.com/thomasfosterau/effect-ext/tree/trunk/packages/effect-ai-elevenlabs)
- [Repository README](https://github.com/thomasfosterau/effect-ext/blob/trunk/README.md)
- [Contributing](https://github.com/thomasfosterau/effect-ext/blob/trunk/CONTRIBUTING.md)
- [ElevenLabs API docs](https://elevenlabs.io/docs/api-reference/introduction)

## License

MIT
