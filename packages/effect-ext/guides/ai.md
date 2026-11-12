# AI service abstractions

The provider-neutral services `effect/ai` lacks (reranking, classification, text-to-speech, speech-to-text, image generation, moderation, voice conversion), each shaped like `effect/ai`'s own `EmbeddingModel`.

These modules were `@thomasfosterau/effect-ai-ext` (0.5.1, now deprecated): the move is an import change, `@thomasfosterau/effect-ai-ext/<Module>` → `@thomasfosterau/effect-ext/<Module>`. Each service's `Context` key moves with it (`@thomasfosterau/effect-ai-ext/RerankerModel` becomes `@thomasfosterau/effect-ext/RerankerModel`), so a layer built against the old package does not provide the new service.

Provider-neutral AI service **abstractions** that upstream Effect (`effect/ai`) does not yet ship. `effect/ai` gives you `LanguageModel`, `EmbeddingModel`, `Tokenizer`, `Tool`/`Toolkit`, `Chat`, `Prompt`/`Response`, `Model`, `AiError`, and `Telemetry` — and nothing for reranking, classification, speech, transcription, image generation, moderation, or voice conversion.

These modules fill that gap in upstream's own idiom. Every module is written **as if it could merge into `effect/ai` itself** — the same shape as `EmbeddingModel`:

- a `Context.Service` tag (`@thomasfosterau/effect-ext/<Module>`),
- `Schema.Class` response/usage models,
- caller `Options` vs normalised `ProviderOptions`/`ProviderResponse` contracts,
- a `Service` interface whose operations fail only through `AiError`,
- a `make(...)` constructor that **validates** provider results before handing them back, wrapping each operation in `Effect.withSpan`.

No provider code, no HTTP — abstractions only. First-party provider packages (Cohere, Voyage, ElevenLabs, …) implement these services the same way `effect-ai-mistral` implements `LanguageModel`.

## Not a superset of `effect/ai`

`@thomasfosterau/effect-ai-ext`'s barrel re-exported every upstream `effect/ai` module beside the abstractions. The `@thomasfosterau/effect-ext` barrel does not: import upstream modules (`LanguageModel`, `EmbeddingModel`, `AiError`, …) from `effect/ai`, and the abstractions from here.

## Modules

Each module is also available as a per-module subpath (mirroring how `effect` itself ships), e.g. `@thomasfosterau/effect-ext/RerankerModel`, and a namespace on the root barrel. Every module exports the same set of names: the service tag (`RerankerModel.RerankerModel`, …), its `Service` interface, the caller options, the normalised `ProviderOptions` / `ProviderResponse` a provider implements, the `Schema.Class` response and usage models, and `make`.

Absence follows one rule. An optional setting in an options object (`topN?`, `voice?`, `format?`, …) is an optional key: omit it, and a provider's `ProviderOptions` has the key only when the caller gave it. Anything a provider may not report is an `Option` in `ProviderResponse` and in the response models: `usage.inputTokens`, `usage.inputCharacters`, `usage.durationSeconds`, a transcription's `segments` and `language`, a moderation result's `flags` and a moderation response's `modelId` are each `Option.Option<…>` (`Option.none()` when unreported). A `Schema.Class` response model encodes an `Option` as an omitted key.

| Module | Operation(s) | Caller options | Response | `make` validates |
| --- | --- | --- | --- | --- |
| `RerankerModel` | `rerank` | `RerankOptions`: `query`, `documents`, `topN?` | `RerankResponse`: `results` (`RerankedDocument`: `index`, `relevanceScore`), sorted by descending score; `usage.inputTokens` (an `Option`) | every `index` names an input document, indices are unique, count ≤ `topN` (or the document count); no documents → empty response, provider not called |
| `ClassifierModel` | `classify` | `ClassifyOptions`: `inputs`, `labels?`, `multiLabel?`, `examples?` (`ClassifyExample`: `text`, `label`) | `ClassifyResponse`: one `Classification` (`classes`: `ClassScore` `label` / `score`) per input; `usage.inputTokens` (an `Option`) | one classification per input, finite scores, labels within `labels` when given; no inputs → empty response |
| `SpeechModel` | `generate`, `stream` | `SpeechOptions`: `text`, `voice?`, `format?`, `sampleRate?` | `SpeechResponse`: `audio` (`Uint8Array`), `mediaType`, `usage.inputCharacters` (an `Option`); `stream` yields `Uint8Array` chunks | non-empty audio (`generate`); `stream` passes through, traced |
| `TranscriptionModel` | `transcribe` | `TranscriptionOptions`: `audio` (`Uint8Array` or `Stream<Uint8Array>`), `mediaType?`, `language?` | `TranscriptionResponse`: `text`, `segments` (`Option` of `TranscriptionSegment`: `text`, `start`, `end`), `language` (`Option`), `usage.durationSeconds` (`Option`) | segment timestamps finite with `end >= start` |
| `ImageModel` | `generate` | `ImageOptions`: `prompt`, `size?`, `format?`, `count?` | `ImageResponse`: `images` (`ImagePart`: `data` as bytes or base64 string, `mediaType`), `usage.inputTokens` (an `Option`) | at least one image, at most `count` |
| `ModerationModel` | `moderate` | `ModerationOptions`: `inputs` (each a string, or an array of `effect/ai` `Prompt.UserMessagePartEncoded` text / file parts screened as one input) | `ModerationResponse`: one `ModerationResult` (`isFlagged`, `categories`: category → score, `flags`: an `Option` of the provider's category → fired) per input; `modelId` (an `Option`: the model that served the call); `usage.inputTokens` (an `Option`) | one result per input, scores finite in `[0, 1]`; no inputs → empty response; an empty part list → `InvalidUserInputError` |
| `VoiceConversionModel` | `convert` | `VoiceConversionOptions`: `audio` (`Uint8Array` or `Stream<Uint8Array>`), `targetVoice`, `format?` | `VoiceConversionResponse`: `audio`, `mediaType`, `usage.durationSeconds` (an `Option`) | non-empty audio |

A result that fails validation fails the call with an `AiError` whose reason is `InvalidOutputError`. Every operation is wrapped in `Effect.withSpan("<Module>.<operation>")`.

`ClassifierModel` and `ModerationModel` additionally export `fromLanguageModel`, an `Effect<Service, never, LanguageModel>` that backs the abstraction with **any** `LanguageModel` via structured-output prompting (`LanguageModel.generateObject`), running the model's output back through the same `make` validation path.

Were they to merge upstream, each module would become `effect/ai/<Module>`, the sibling of `EmbeddingModel`.

## Example

```ts
import { Effect } from "effect";
import { RerankerModel } from "@thomasfosterau/effect-ext";

// Consumers depend on the tag; a provider layer supplies it.
const program = Effect.gen(function* () {
  const reranker = yield* RerankerModel.RerankerModel;
  const response = yield* reranker.rerank({
    query: "best editor",
    documents: ["vim", "emacs", "nano"],
    topN: 2,
  });
  return response.results; // sorted by descending relevanceScore
});
```

Implementing the service in a provider: `make` takes the provider hook and returns the validated service.

```ts
import { Effect, Layer, Option } from "effect";
import * as RerankerModel from "@thomasfosterau/effect-ext/RerankerModel";

const KeywordReranker = Layer.effect(
  RerankerModel.RerankerModel,
  RerankerModel.make({
    rerank: ({ query, documents }) =>
      Effect.succeed({
        results: documents.map((document, index) => ({
          index,
          relevanceScore: document.includes(query) ? 1 : 0,
        })),
        usage: { inputTokens: Option.none() },
      }),
  }),
);
```

Backing a classifier with a language model:

```ts
import { Effect, Layer } from "effect";
import { LanguageModel } from "effect/ai";
import { ClassifierModel } from "@thomasfosterau/effect-ext";

declare const SomeLanguageModelLayer: Layer.Layer<LanguageModel.LanguageModel>;

const ClassifierLayer = Layer.effect(
  ClassifierModel.ClassifierModel,
  ClassifierModel.fromLanguageModel,
).pipe(Layer.provide(SomeLanguageModelLayer));
```

## `RerankerModel` moved

`RerankerModel` previously lived in `@thomasfosterau/effect-ai-gateway` (since renamed `@thomasfosterau/effect-ai-cloudflare`) — a reranker abstraction never belonged in a routing package. It lives here now: import it from `@thomasfosterau/effect-ext/RerankerModel` (it was `@thomasfosterau/effect-ai-ext/RerankerModel` until the two packages merged). The gateway kept a deprecated re-export through 0.4.x and removed it in 0.5.0, and `@thomasfosterau/effect-ai-cloudflare` exports no `RerankerModel` name; its Cohere reranker (`makeCohereReranker`) returns this module's `Service`.
