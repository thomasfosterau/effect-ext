# @thomasfosterau/effect-ai-voyage

## 0.5.0

### Minor Changes

- [#96](https://github.com/thomasfosterau/effect-ext/pull/96) [`1ed5c76`](https://github.com/thomasfosterau/effect-ext/commit/1ed5c768a53bb715343af16763f18784e9d74371) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Raise the `effect` peer floor from `^4.0.0` to `^4.1.0`. Effect 4.1 removed the request details from `AiError`'s `NetworkError` and HTTP context, so errors this package returns no longer carry them (the status, response headers and body are kept).

- [#123](https://github.com/thomasfosterau/effect-ext/pull/123) [`93a05ba`](https://github.com/thomasfosterau/effect-ext/commit/93a05ba9ec262d894b06e8e99264d7635edc9e15) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Absence is spelled the way the rest of the workspace spells it ([#17](https://github.com/thomasfosterau/effect-ext/issues/17)). Breaking on 0.x.
  
  - `VoyageClient.Options` (`apiKey`, `apiUrl`, `transformClient`), `VoyageEmbeddingModel` settings (`inputType`, `outputDimension`, `truncation`) and `VoyageRerankerModel` settings (`truncation`): `x?: T | undefined` is now `x?: T`.
  - `VoyageClient.layerConfig`'s `apiKey`: `Config.Config<Redacted | undefined>` is now `Config.Config<Redacted>`; omit the setting for no key.
  - `VoyageEmbeddingModel.defaultDimension(model)`: `number | undefined` is now `Option.Option<number>`.
  - `inputType`: `"query" | "document" | null` is now `"query" | "document"`; omit it (formerly `null`) to embed the text as-is.

### Patch Changes

- [#100](https://github.com/thomasfosterau/effect-ext/pull/100) [`d3a6bac`](https://github.com/thomasfosterau/effect-ext/commit/d3a6bac4bc36d7f895b605efcaaf1da1487fc92e) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - The AI abstractions and the evals toolkit now spell absence the way the rest of the package does ([#17](https://github.com/thomasfosterau/effect-ext/issues/17)): an optional setting in an options object is `x?: T`, and a value that may be absent in a result is an `Option`. This is breaking on 0.x.
  
  **Options objects: `x?: T | undefined` is now `x?: T`.** A caller holding `undefined` omits the key (or spreads, or uses `Struct.pick`). Affected: `RerankOptions` / `RerankerModel.ProviderOptions` (`topN`), `ClassifyOptions` / `ClassifierModel.ProviderOptions` (`labels`, `multiLabel`, `examples`; `ProviderOptions.multiLabel` stays a required `boolean`), `SpeechOptions`, `ImageOptions`, `TranscriptionOptions`, `VoiceConversionOptions` and each `ProviderOptions` (`voice`, `format`, `sampleRate`, `size`, `count`, `mediaType`, `language`), the evals' `RetrievalGolden.name`, `RetrievalSuite.metrics`, `Ranking.MetricsAtKOptions` (`metrics`, `thresholds`), `Cache.CacheKeyInput.judgeModelId`, `GEvalTemplateParams` and `GEval.judge`'s params (`criteria`, `evaluationSteps`, `rubric`). A `ProviderOptions` now has a key only when the caller supplied it, so a provider that destructures is unaffected.
  
  **Results and provider responses: `T | undefined` is now `Option.Option<T>`, required.**
  
  - `*Usage.inputTokens` (Reranker, Classifier, Image, Moderation), `SpeechUsage.inputCharacters`, `TranscriptionUsage.durationSeconds` and `VoiceConversionUsage.durationSeconds` are `Option<number>`; in a `Schema.Class` model the encoded form is an omitted key (`Schema.OptionFromOptionalKey`), not `undefined`.
  - `TranscriptionResponse.segments` and `.language` are `Option`. `ModerationResult.flags` and `ModerationResponse.modelId` are `Option` (were `Schema.optional`).
  - Every `ProviderResponse` mirrors this: `usage.*` is an `Option`, `TranscriptionModel`'s `segments` / `language` and `ModerationModel`'s `flags` / `modelId` are required `Option`s. A provider that built `{ usage: { inputTokens: n } }` now builds `{ usage: { inputTokens: Option.fromUndefinedOr(n) } }`.
  - Evals: `Result.MetricAggregate.summary` is `Option<Summary>` and `Result.formatSpread` takes an `Option<Summary>`; `ExtractThenClassify.Verdict.reason` is `Option<string>`. The JSON reports are unchanged (`summary` is still the object or `null`; verdicts in `Score.metadata` still omit `reason` when there is none): use the new `Result.summaryReplacer` when stringifying a `SuiteResult` yourself, and `ExtractThenClassify.verdictMetadata` for the metadata form.
  - `GEvalCase`, `GEvalConversationalCase` (now a type alias) and `RagCase` are `Pick`s of the `Golden` / `EvalCase` decoded types instead of hand-written `?: T | undefined` members, so they still accept a decoded case.
  
  The provider packages' published code changed only to build the new `ProviderResponse` shapes; their own APIs are unchanged.
  
  `evals/Cache.hashKey` now canonicalises a golden to `Schema.Json` before hashing. The JSON it hashes is the same as before for every value `JSON.stringify` could already encode, so existing cache keys keep their digests (a pinned-digest test checks this). One key changes: a golden holding a `bigint` used to make `hashKey` die, because `JSON.stringify` throws on one; it is now keyed as `{ "__bigint": "<digits>" }`.

- [#108](https://github.com/thomasfosterau/effect-ext/pull/108) [`06f7c84`](https://github.com/thomasfosterau/effect-ext/commit/06f7c848c95dd299eb47b56c35849af585923270) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Move the details from the README into the exported doc comments.
- Updated dependencies [[`9210f78`](https://github.com/thomasfosterau/effect-ext/commit/9210f7825de4a0582f0404313e54b64c5a0da5f2), [`68c6983`](https://github.com/thomasfosterau/effect-ext/commit/68c69831c24ebc74bbba2416b790a9e4a51f300e), [`1ed5c76`](https://github.com/thomasfosterau/effect-ext/commit/1ed5c768a53bb715343af16763f18784e9d74371), [`c6daa75`](https://github.com/thomasfosterau/effect-ext/commit/c6daa75a9e3f7cb315ad0888ccccd6fa150d6f8f), [`00d27f5`](https://github.com/thomasfosterau/effect-ext/commit/00d27f5950e5189fe5127d2a02931d4fc5c5ec89), [`0aae924`](https://github.com/thomasfosterau/effect-ext/commit/0aae924ff2e1fce4845e95088adbdbe42a81ebe1), [`5e4c9f2`](https://github.com/thomasfosterau/effect-ext/commit/5e4c9f275cea1fd5c2e83b44070a859a5f916f1e), [`d3a6bac`](https://github.com/thomasfosterau/effect-ext/commit/d3a6bac4bc36d7f895b605efcaaf1da1487fc92e), [`87e9258`](https://github.com/thomasfosterau/effect-ext/commit/87e92588099c642f9d7805b2923dcec9b7330c96), [`0f60093`](https://github.com/thomasfosterau/effect-ext/commit/0f6009334aa10e7d3160cf052001eec4cc2468b9), [`3950735`](https://github.com/thomasfosterau/effect-ext/commit/395073596084c6e90cb6087e00ed904b41b5846d), [`37af9fd`](https://github.com/thomasfosterau/effect-ext/commit/37af9fd34cf88d38995af7f81846dadc8c32a0a1), [`a6de9db`](https://github.com/thomasfosterau/effect-ext/commit/a6de9dba3de047e0c817866625177ed6bf502349), [`d8677d2`](https://github.com/thomasfosterau/effect-ext/commit/d8677d274de3ea8902e6a6701a971bbc2f2b2761), [`c88e834`](https://github.com/thomasfosterau/effect-ext/commit/c88e834ae130b24fab8f22b5af4fce65b7b21385), [`55fc0bd`](https://github.com/thomasfosterau/effect-ext/commit/55fc0bdce98da68d7f89f570cba870175a97e7bf)]:
  - @thomasfosterau/effect-ext@0.3.0

## 0.4.1

### Patch Changes

- [#81](https://github.com/thomasfosterau/effect-ext/pull/81) [`ff06937`](https://github.com/thomasfosterau/effect-ext/commit/ff06937db249eda44fe49be614d219be428a4469) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Internal lint clean-up of the AI providers and the evals toolkit ([#24](https://github.com/thomasfosterau/effect-ext/issues/24)). Behaviour is unchanged. Some emitted declarations now omit type arguments equal to their defaults (`Redacted.Redacted` for `Redacted.Redacted<string>`, `Schedule.Schedule<unknown>` for `Schedule.Schedule<unknown, unknown>`); they denote the same types.

- [#77](https://github.com/thomasfosterau/effect-ext/pull/77) [`5ed07b2`](https://github.com/thomasfosterau/effect-ext/commit/5ed07b280c68a39f4722a5994a9e8d15f5093238) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - The published tarball now includes `CHANGELOG.md`, so the release notes can be read from `node_modules` ([#72](https://github.com/thomasfosterau/effect-ext/issues/72)).
- Updated dependencies [[`ff06937`](https://github.com/thomasfosterau/effect-ext/commit/ff06937db249eda44fe49be614d219be428a4469), [`5b8cbd8`](https://github.com/thomasfosterau/effect-ext/commit/5b8cbd8eadcb6de5202890f1e0f4dc254a23fee9), [`6354c4b`](https://github.com/thomasfosterau/effect-ext/commit/6354c4bd06786e7d1dba236d47f7e4b196563e09), [`16c15fd`](https://github.com/thomasfosterau/effect-ext/commit/16c15fd2a93c9c0ed1d294d3a781354666f37f5d), [`2c387ee`](https://github.com/thomasfosterau/effect-ext/commit/2c387ee9c878a9b8debb3c47cfba72b32e1b53ec), [`dd58f51`](https://github.com/thomasfosterau/effect-ext/commit/dd58f515b3a572c5e81fa5fda62c5672dbdf7b88), [`5ed07b2`](https://github.com/thomasfosterau/effect-ext/commit/5ed07b280c68a39f4722a5994a9e8d15f5093238), [`38f447e`](https://github.com/thomasfosterau/effect-ext/commit/38f447e6331bf995b8029e62e1cf5b407e382e6c)]:
  - @thomasfosterau/effect-ext@0.2.0

## 0.4.0

### Minor Changes

- [#30](https://github.com/thomasfosterau/effect-ext/pull/30) [`06fa9d5`](https://github.com/thomasfosterau/effect-ext/commit/06fa9d5d6ef2af6d3dcc23f0299def163df989df) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - **Breaking:** the `effect` peer floor rises from `>=4.0.0-rc.118` to `>=4.0.0`, the first stable release. A consumer still on an `effect` 4.0 release candidate must upgrade to 4.0.0 or later. No API changes.

- [#57](https://github.com/thomasfosterau/effect-ext/pull/57) [`a09d3ca`](https://github.com/thomasfosterau/effect-ext/commit/a09d3ca1a5713af5a9f363b25ae4c7900c95e3a3) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - **Breaking:** the package now depends on `@thomasfosterau/effect-ext` instead of `@thomasfosterau/effect-ai-ext`, which merged into it. The abstractions it implements (`RerankerModel`, `ClassifierModel`, `SpeechModel`, `TranscriptionModel`, `VoiceConversionModel`, `ModerationModel`) are now `@thomasfosterau/effect-ext/<Module>`, with `Context` keys to match, so a consumer moves its own imports of them to `@thomasfosterau/effect-ext` in the same upgrade: a layer this version builds does not provide a tag imported from `@thomasfosterau/effect-ai-ext`.

### Patch Changes

- The package now lives in [`thomasfosterau/effect-ext`](https://github.com/thomasfosterau/effect-ext): its `repository`, `homepage` and `bugs` fields and the README's source links point there. It is built and tested against `effect` 4.0.6; the published peer ranges are unchanged.

- [#52](https://github.com/thomasfosterau/effect-ext/pull/52) [`9540034`](https://github.com/thomasfosterau/effect-ext/commit/95400348770d569e29ca71fb7625e837c2f1c7d7) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - The `effect` peer range, and the `@effect/ai-anthropic`, `@effect/platform-node` and `@effect/platform-browser` peers, change form from `>=4.0.0` to `^4.0.0` per the peer-range policy. Only the form changes: the floor stays 4.0.0, tested there. Effect 5 is no longer admitted. `IdleDetection.watch` now fails its stream when the detector refuses to start on effect 4.0.0, where the stream used to wait forever.
- Updated dependencies [[`b888bd8`](https://github.com/thomasfosterau/effect-ext/commit/b888bd8816a3df41e082bac718d3996ee695ac09), [`9540034`](https://github.com/thomasfosterau/effect-ext/commit/95400348770d569e29ca71fb7625e837c2f1c7d7), [`854263d`](https://github.com/thomasfosterau/effect-ext/commit/854263dff04b6e88c57afea0a688abd61b9cf577), [`5d6b485`](https://github.com/thomasfosterau/effect-ext/commit/5d6b485562ca9b301bc88ecc54070deae711a1ac), [`36b09d0`](https://github.com/thomasfosterau/effect-ext/commit/36b09d0dda98d5f4c747205f2c9b2a63f77fb96e)]:
  - @thomasfosterau/effect-ext@0.1.0

## 0.3.4

### Patch Changes

- 8380ae3: Internal refactor to the Effect lint plugin 0.6.0 rules: native loops, `JSON`, `Map` / `Set` and `Object.*` helpers replaced with `effect/Array`, `effect/Record`, `HashSet` / `MutableHashMap` and Schema JSON codecs. Request bodies, decoded results and error messages are unchanged.
- Updated dependencies [8380ae3]
  - @thomasfosterau/effect-ai-ext@0.5.1

## 0.3.3

### Patch Changes

- a651e14: Model-id and provider-id parameters are spelled `Model | (string & Record<never, never>)` instead of `Model | (string & {})` (#98). The accepted values are unchanged: any string is still accepted, and the known ids still autocomplete. In `effect-ai-cohere`, the embedding and reranker `model` options, which have no list of known ids, are now plain `string`.
- 79921eb: Build with `vp pack` (tsdown) instead of tsup. Every entry point and subpath keeps the same file name and the same runtime and type exports; only the internal chunk files under `dist/` are named differently, and the bundled declarations name types by their own names instead of minified aliases. The published `src/` is reformatted by Oxfmt with no code change.
- Updated dependencies [52cae13]
- Updated dependencies [132f796]
- Updated dependencies [79921eb]
  - @thomasfosterau/effect-ai-ext@0.5.0

## 0.3.2

### Patch Changes

- f900012: Tested against effect 4.0.0 (with @effect/ai-anthropic and @effect/platform-node 4.0.0); peer floor unchanged.
- Updated dependencies [f900012]
  - @thomasfosterau/effect-ai-ext@0.4.2

## 0.3.1

### Patch Changes

- 15080ed: Documentation only. Doc comments now open with their summary (module headers no longer start with `@module` or `@copyright`, so editor hovers show it), the misleading `@since 4.0.0` tags are gone (no 4.0.0 of these packages exists), and comments that cite another repository's issues and decision records say so (`website#NNN`). The `effect-ai-gateway` README examples compile and its barrel has a summary; the `effect-evals` README gains an Install section and the modules its table omitted.
- Updated dependencies [15080ed]
  - @thomasfosterau/effect-ai-ext@0.4.1

## 0.3.0

### Minor Changes

- 3a3db62: **Breaking:** require `effect@>=4.0.0-rc.118` (and `@effect/ai-anthropic` / `@effect/platform-node` `>=4.0.0-rc.118` where peered). Effect rc.118 moved every `effect/unstable/*` module to `effect/*` (for example `effect/unstable/ai/LanguageModel` is now `effect/ai/LanguageModel`), so published builds now import the new paths and no longer resolve against earlier rcs. Upgrade `effect` and its `@effect/*` companions together. Cohere and Mistral encode image data URIs with `effect/encoding/Base64` (the `effect/Encoding` module was split in rc.118).

### Patch Changes

- Updated dependencies [3a3db62]
  - @thomasfosterau/effect-ai-ext@0.4.0

## 0.2.0

### Minor Changes

- 1091f13: **Breaking:** the `effect` peer dependency moves from the exact `4.0.0-beta.99` pin to the open floor `>=4.0.0-rc.113` (issue #32, the shared Effect-floor policy). You need `effect@4.0.0-rc.113` or later; any later rc is accepted. The package is built and tested on `4.0.0-rc.115`, and its type-check and unit suite also pass on rc.113, rc.114 and rc.117. rc.112 and every beta are no longer supported. This is a minor bump because the package is pre-1.0.
  
  `VoyageEmbeddingModel.make` is now typed as `EmbeddingModel.EmbeddingModel`, because rc.113 removed upstream's `EmbeddingModel.Service` alias. The runtime value is unchanged.

### Patch Changes

- 774a352: Fix the `homepage` link in every package manifest: it pointed at a `tree/main/…` path on GitHub, but the repository's default branch is `trunk`, so the link npm shows for each package 404'd. No code changes.
- Updated dependencies [1091f13]
- Updated dependencies [774a352]
  - @thomasfosterau/effect-ai-ext@0.3.0

## 0.1.1

### Patch Changes

- Updated dependencies [ef67371]
  - @thomasfosterau/effect-ai-ext@0.2.0
