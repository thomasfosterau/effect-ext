# @thomasfosterau/effect-ai-elevenlabs

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

- 8816de6: `ElevenLabsClient`'s `speechToText` and `speechToSpeech` form types now accept `undefined` for their optional fields (#98). The client builds the multipart body from them without a type assertion, and an `undefined` field is still left out of the body. The bytes sent are unchanged.
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
  
  No API changes.

### Patch Changes

- 774a352: Fix the `homepage` link in every package manifest: it pointed at a `tree/main/…` path on GitHub, but the repository's default branch is `trunk`, so the link npm shows for each package 404'd. No code changes.
- Updated dependencies [1091f13]
- Updated dependencies [774a352]
  - @thomasfosterau/effect-ai-ext@0.3.0

## 0.1.1

### Patch Changes

- Updated dependencies [ef67371]
  - @thomasfosterau/effect-ai-ext@0.2.0
