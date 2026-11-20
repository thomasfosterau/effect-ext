# effect-ext

Experimental extensions to [Effect](https://effect.website) v4: standard-library additions (binary data, Schema helpers, web-platform modules, Rust-style numerics, time formats, AI service abstractions, an LLM evals toolkit) and first-party `effect/ai` providers.

> [!CAUTION]
> Experimental and pre-1.0, largely written with Claude Code. APIs may change between minor versions; pin what you use.

## Install

```sh
pnpm add effect @thomasfosterau/effect-ext
```

`effect` (`^4.0.0`) is a peer: keep a single copy in your app.

## Usage

```ts
import { Effect, Schema } from "effect";
import { Layout, TriState, Vec } from "@thomasfosterau/effect-ext";

const xs = Effect.runSync(Vec.fromIterable(Layout.f64, [1, 2, 3])); // Float64Array-backed

const Update = Schema.Struct({ summary: TriState.clearable(Schema.String) });
TriState.read(Schema.decodeUnknownSync(Update)({ summary: null }).summary); // { _tag: "Clear" }
```

## Packages

| Package | What it is |
| --- | --- |
| [`@thomasfosterau/effect-ext`](packages/effect-ext) | Standard-library extensions, one subpath per module, plus the `./evals` toolkit and `effect-evals` CLI |
| [`@thomasfosterau/effect-ai-mistral`](packages/effect-ai-mistral) | Mistral `LanguageModel` |
| [`@thomasfosterau/effect-ai-cohere`](packages/effect-ai-cohere) | Cohere embed, rerank, classify, chat |
| [`@thomasfosterau/effect-ai-voyage`](packages/effect-ai-voyage) | Voyage AI embed, rerank |
| [`@thomasfosterau/effect-ai-elevenlabs`](packages/effect-ai-elevenlabs) | ElevenLabs speech, transcription, voice conversion |
| [`@thomasfosterau/effect-ai-cloudflare`](packages/effect-ai-cloudflare) | `@effect/ai-cloudflare` plus providers routed through a Cloudflare AI Gateway (BYOK) |
| [`@thomasfosterau/effect-platform-worker-shared`](packages/effect-platform-worker-shared) | What every web worker scope shares: the worker global, a worker `runMain`, schema-typed message ports |
| [`@thomasfosterau/effect-platform-worker`](packages/effect-platform-worker) | Dedicated and shared web workers |
| [`@thomasfosterau/effect-platform-service-worker`](packages/effect-platform-service-worker) | Service workers |
| [`@thomasfosterau/effect-platform-browser`](packages/effect-platform-browser) | Browser main-thread APIs beyond `@effect/platform-browser`: the page side of service workers, Web Push subscriptions |

Each package README lists its entry points and peers; effect-ext's topic guides are in [`packages/effect-ext/guides/`](packages/effect-ext/guides).

## More

[Contributing](docs/CONTRIBUTING.md) · [Publishing](docs/PUBLISHING.md) · [Security](docs/SECURITY.md) · [License](LICENSE.md) (MIT)
