# @thomasfosterau/effect-ai-mistral

## 0.5.0

### Minor Changes

- [#96](https://github.com/thomasfosterau/effect-ext/pull/96) [`1ed5c76`](https://github.com/thomasfosterau/effect-ext/commit/1ed5c768a53bb715343af16763f18784e9d74371) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Raise the `effect` peer floor from `^4.0.0` to `^4.1.0`. Effect 4.1 removed the request details from `AiError`'s `NetworkError` and HTTP context, and from `Response`'s response-metadata part, so errors this package returns no longer carry them (the status, response headers and body are kept).

- [#123](https://github.com/thomasfosterau/effect-ext/pull/123) [`93a05ba`](https://github.com/thomasfosterau/effect-ext/commit/93a05ba9ec262d894b06e8e99264d7635edc9e15) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Absence is spelled the way the rest of the workspace spells it ([#17](https://github.com/thomasfosterau/effect-ext/issues/17)): options-object members are `x?: T` (no `| undefined`), and the mapper converts the wire's `null` / omitted values to `Option` at the boundary. Breaking on 0.x.
  
  - `MistralClient.Options` (`apiKey`, `apiUrl`, `transformClient`) and `MistralLanguageModel.ConfigService` members: `x?: T | undefined` is now `x?: T`. A caller holding `undefined` omits the key or uses `Struct.pick`.
  - `MistralClient.layerConfig`'s `apiKey`: `Config.Config<Redacted | undefined>` is now `Config.Config<Redacted>`; omit the setting for no key.
  - `MistralLanguageModel.model(name, config?)` and the `layer` / `make` `config` member: `config?: T | undefined` is now `config?: T` (and `model`'s defaults to `{}`).
  - The wire request interfaces' tool-call `arguments` and tool-message `content` are omitted keys (`x?: string`) rather than `string | undefined`; the JSON sent is unchanged.

### Patch Changes

- [#110](https://github.com/thomasfosterau/effect-ext/pull/110) [`c88e834`](https://github.com/thomasfosterau/effect-ext/commit/c88e834ae130b24fab8f22b5af4fce65b7b21385) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - The response decoder reads Mistral's numeric fields (token usage, choice `index`, `created`) as `Schema.Finite` instead of `Schema.Number`. JSON cannot carry `NaN` or an infinity, so no valid response decodes differently.

- [#108](https://github.com/thomasfosterau/effect-ext/pull/108) [`06f7c84`](https://github.com/thomasfosterau/effect-ext/commit/06f7c848c95dd299eb47b56c35849af585923270) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Move the details from the README into the exported doc comments.

## 0.4.1

### Patch Changes

- [#81](https://github.com/thomasfosterau/effect-ext/pull/81) [`ff06937`](https://github.com/thomasfosterau/effect-ext/commit/ff06937db249eda44fe49be614d219be428a4469) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Internal lint clean-up of the AI providers and the evals toolkit ([#24](https://github.com/thomasfosterau/effect-ext/issues/24)). Behaviour is unchanged. Some emitted declarations now omit type arguments equal to their defaults (`Redacted.Redacted` for `Redacted.Redacted<string>`, `Schedule.Schedule<unknown>` for `Schedule.Schedule<unknown, unknown>`); they denote the same types.

- [#77](https://github.com/thomasfosterau/effect-ext/pull/77) [`5ed07b2`](https://github.com/thomasfosterau/effect-ext/commit/5ed07b280c68a39f4722a5994a9e8d15f5093238) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - The published tarball now includes `CHANGELOG.md`, so the release notes can be read from `node_modules` ([#72](https://github.com/thomasfosterau/effect-ext/issues/72)).

## 0.4.0

### Minor Changes

- [#30](https://github.com/thomasfosterau/effect-ext/pull/30) [`06fa9d5`](https://github.com/thomasfosterau/effect-ext/commit/06fa9d5d6ef2af6d3dcc23f0299def163df989df) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - **Breaking:** the `effect` peer floor rises from `>=4.0.0-rc.118` to `>=4.0.0`, the first stable release. A consumer still on an `effect` 4.0 release candidate must upgrade to 4.0.0 or later. No API changes.

### Patch Changes

- The package now lives in [`thomasfosterau/effect-ext`](https://github.com/thomasfosterau/effect-ext): its `repository`, `homepage` and `bugs` fields and the README's source links point there. It is built and tested against `effect` 4.0.6; the published peer ranges are unchanged.

- [#52](https://github.com/thomasfosterau/effect-ext/pull/52) [`9540034`](https://github.com/thomasfosterau/effect-ext/commit/95400348770d569e29ca71fb7625e837c2f1c7d7) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - The `effect` peer range, and the `@effect/ai-anthropic`, `@effect/platform-node` and `@effect/platform-browser` peers, change form from `>=4.0.0` to `^4.0.0` per the peer-range policy. Only the form changes: the floor stays 4.0.0, tested there. Effect 5 is no longer admitted. `IdleDetection.watch` now fails its stream when the detector refuses to start on effect 4.0.0, where the stream used to wait forever.

## 0.3.4

### Patch Changes

- 8380ae3: Internal refactor to the Effect lint plugin 0.6.0 rules: native loops, `JSON`, `Map` / `Set` and `Object.*` helpers replaced with `effect/Array`, `effect/Record`, `HashSet` / `MutableHashMap` and Schema JSON codecs. Request bodies, decoded results and error messages are unchanged.

## 0.3.3

### Patch Changes

- 13a7edd: Streamed frames and tool-call arguments are parsed with `Schema.fromJsonString(Schema.Json)` instead of a `try`/`catch` around `JSON.parse` (#98). Text that is not JSON is still handed on as the raw string, as before. The one difference is a number literal too large for a finite double (`1e400`), which `JSON.parse` turned into `Infinity`: such text is no longer treated as JSON and is handed on as the raw string.
  
  An SSE frame containing such a literal therefore fails schema decoding, so the stream fails with an `AiError`, as any other malformed frame does.
- 00c8f92: `toolChoice: "none"` now sends the tool definitions with `tool_choice: "none"`, so the model sees the tools but cannot call them. Previously it dropped `tools` and `tool_choice` from the chat-completions request body entirely (#121). A request without a toolkit still sends neither field.
- a651e14: Model-id and provider-id parameters are spelled `Model | (string & Record<never, never>)` instead of `Model | (string & {})` (#98). The accepted values are unchanged: any string is still accepted, and the known ids still autocomplete. In `effect-ai-cohere`, the embedding and reranker `model` options, which have no list of known ids, are now plain `string`.
- 79921eb: Build with `vp pack` (tsdown) instead of tsup. Every entry point and subpath keeps the same file name and the same runtime and type exports; only the internal chunk files under `dist/` are named differently, and the bundled declarations name types by their own names instead of minified aliases. The published `src/` is reformatted by Oxfmt with no code change.

## 0.3.2

### Patch Changes

- f900012: Tested against effect 4.0.0 (with @effect/ai-anthropic and @effect/platform-node 4.0.0); peer floor unchanged.

## 0.3.1

### Patch Changes

- 15080ed: Documentation only. Doc comments now open with their summary (module headers no longer start with `@module` or `@copyright`, so editor hovers show it), the misleading `@since 4.0.0` tags are gone (no 4.0.0 of these packages exists), and comments that cite another repository's issues and decision records say so (`website#NNN`). The `effect-ai-gateway` README examples compile and its barrel has a summary; the `effect-evals` README gains an Install section and the modules its table omitted.

## 0.3.0

### Minor Changes

- 3a3db62: **Breaking:** require `effect@>=4.0.0-rc.118` (and `@effect/ai-anthropic` / `@effect/platform-node` `>=4.0.0-rc.118` where peered). Effect rc.118 moved every `effect/unstable/*` module to `effect/*` (for example `effect/unstable/ai/LanguageModel` is now `effect/ai/LanguageModel`), so published builds now import the new paths and no longer resolve against earlier rcs. Upgrade `effect` and its `@effect/*` companions together. Cohere and Mistral encode image data URIs with `effect/encoding/Base64` (the `effect/Encoding` module was split in rc.118).

## 0.2.0

### Minor Changes

- 1091f13: **Breaking:** the `effect` peer dependency moves from the exact `4.0.0-beta.99` pin to the open floor `>=4.0.0-rc.113` (issue #32, the shared Effect-floor policy). You need `effect@4.0.0-rc.113` or later; any later rc is accepted. The package is built and tested on `4.0.0-rc.115`, and its type-check and unit suite also pass on rc.113, rc.114 and rc.117. rc.112 and every beta are no longer supported. This is a minor bump because the package is pre-1.0.
  
  - **Streaming SSE failures are now `AiError`s.** In the rc line, `Sse.decode()` can fail with `Sse.SseError` (`EventTooLarge`, an event over the decoder's 10 MiB cap). The chat-completions stream now maps that to an `AiError` with an `InvalidOutputError` reason, which is how the upstream Effect providers classify it, so no raw decoder error leaks out of `streamText`.
  - `MistralLanguageModel.make` is now typed as `LanguageModel.LanguageModel`, because rc.113 removed upstream's `LanguageModel.Service` alias. The runtime value is unchanged.

### Patch Changes

- 774a352: Fix the `homepage` link in every package manifest: it pointed at a `tree/main/…` path on GitHub, but the repository's default branch is `trunk`, so the link npm shows for each package 404'd. No code changes.
