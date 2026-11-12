---
"@thomasfosterau/effect-ext": minor
"@thomasfosterau/effect-ai-cloudflare": patch
"@thomasfosterau/effect-ai-cohere": patch
"@thomasfosterau/effect-ai-voyage": patch
"@thomasfosterau/effect-ai-elevenlabs": patch
---

The AI abstractions and the evals toolkit now spell absence the way the rest of the package does (#17): an optional setting in an options object is `x?: T`, and a value that may be absent in a result is an `Option`. This is breaking on 0.x.

**Options objects: `x?: T | undefined` is now `x?: T`.** A caller holding `undefined` omits the key (or spreads, or uses `Struct.pick`). Affected: `RerankOptions` / `RerankerModel.ProviderOptions` (`topN`), `ClassifyOptions` / `ClassifierModel.ProviderOptions` (`labels`, `multiLabel`, `examples`; `ProviderOptions.multiLabel` stays a required `boolean`), `SpeechOptions`, `ImageOptions`, `TranscriptionOptions`, `VoiceConversionOptions` and each `ProviderOptions` (`voice`, `format`, `sampleRate`, `size`, `count`, `mediaType`, `language`), the evals' `RetrievalGolden.name`, `RetrievalSuite.metrics`, `Ranking.MetricsAtKOptions` (`metrics`, `thresholds`), `Cache.CacheKeyInput.judgeModelId`, `GEvalTemplateParams` and `GEval.judge`'s params (`criteria`, `evaluationSteps`, `rubric`). A `ProviderOptions` now has a key only when the caller supplied it, so a provider that destructures is unaffected.

**Results and provider responses: `T | undefined` is now `Option.Option<T>`, required.**

- `*Usage.inputTokens` (Reranker, Classifier, Image, Moderation), `SpeechUsage.inputCharacters`, `TranscriptionUsage.durationSeconds` and `VoiceConversionUsage.durationSeconds` are `Option<number>`; in a `Schema.Class` model the encoded form is an omitted key (`Schema.OptionFromOptionalKey`), not `undefined`.
- `TranscriptionResponse.segments` and `.language` are `Option`. `ModerationResult.flags` and `ModerationResponse.modelId` are `Option` (were `Schema.optional`).
- Every `ProviderResponse` mirrors this: `usage.*` is an `Option`, `TranscriptionModel`'s `segments` / `language` and `ModerationModel`'s `flags` / `modelId` are required `Option`s. A provider that built `{ usage: { inputTokens: n } }` now builds `{ usage: { inputTokens: Option.fromUndefinedOr(n) } }`.
- Evals: `Result.MetricAggregate.summary` is `Option<Summary>` and `Result.formatSpread` takes an `Option<Summary>`; `ExtractThenClassify.Verdict.reason` is `Option<string>`. The JSON reports are unchanged (`summary` is still the object or `null`; verdicts in `Score.metadata` still omit `reason` when there is none): use the new `Result.summaryReplacer` when stringifying a `SuiteResult` yourself, and `ExtractThenClassify.verdictMetadata` for the metadata form.
- `GEvalCase`, `GEvalConversationalCase` (now a type alias) and `RagCase` are `Pick`s of the `Golden` / `EvalCase` decoded types instead of hand-written `?: T | undefined` members, so they still accept a decoded case.

The provider packages' published code changed only to build the new `ProviderResponse` shapes; their own APIs are unchanged.

`evals/Cache.hashKey` now canonicalises a golden to `Schema.Json` before hashing. The JSON it hashes is the same as before for every value `JSON.stringify` could already encode, so existing cache keys keep their digests (a pinned-digest test checks this). One key changes: a golden holding a `bigint` used to make `hashKey` die, because `JSON.stringify` throws on one; it is now keyed as `{ "__bigint": "<digits>" }`.
