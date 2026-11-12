# @thomasfosterau/effect-ai-cloudflare

## Released as @thomasfosterau/effect-ai-gateway

This package was published as `@thomasfosterau/effect-ai-gateway` until 0.5.1 and renamed before its first release under this name (0.1.0). The entries below are that package's.

## 0.1.1

### Patch Changes

- [#81](https://github.com/thomasfosterau/effect-ext/pull/81) [`ff06937`](https://github.com/thomasfosterau/effect-ext/commit/ff06937db249eda44fe49be614d219be428a4469) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Internal lint clean-up of the AI providers and the evals toolkit ([#24](https://github.com/thomasfosterau/effect-ext/issues/24)). Behaviour is unchanged. Some emitted declarations now omit type arguments equal to their defaults (`Redacted.Redacted` for `Redacted.Redacted<string>`, `Schedule.Schedule<unknown>` for `Schedule.Schedule<unknown, unknown>`); they denote the same types.

- [#77](https://github.com/thomasfosterau/effect-ext/pull/77) [`5ed07b2`](https://github.com/thomasfosterau/effect-ext/commit/5ed07b280c68a39f4722a5994a9e8d15f5093238) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - The published tarball now includes `CHANGELOG.md`, so the release notes can be read from `node_modules` ([#72](https://github.com/thomasfosterau/effect-ext/issues/72)).
- Updated dependencies [[`ff06937`](https://github.com/thomasfosterau/effect-ext/commit/ff06937db249eda44fe49be614d219be428a4469), [`5b8cbd8`](https://github.com/thomasfosterau/effect-ext/commit/5b8cbd8eadcb6de5202890f1e0f4dc254a23fee9), [`6354c4b`](https://github.com/thomasfosterau/effect-ext/commit/6354c4bd06786e7d1dba236d47f7e4b196563e09), [`16c15fd`](https://github.com/thomasfosterau/effect-ext/commit/16c15fd2a93c9c0ed1d294d3a781354666f37f5d), [`2c387ee`](https://github.com/thomasfosterau/effect-ext/commit/2c387ee9c878a9b8debb3c47cfba72b32e1b53ec), [`dd58f51`](https://github.com/thomasfosterau/effect-ext/commit/dd58f515b3a572c5e81fa5fda62c5672dbdf7b88), [`5ed07b2`](https://github.com/thomasfosterau/effect-ext/commit/5ed07b280c68a39f4722a5994a9e8d15f5093238), [`38f447e`](https://github.com/thomasfosterau/effect-ext/commit/38f447e6331bf995b8029e62e1cf5b407e382e6c)]:
  - @thomasfosterau/effect-ext@0.2.0

## 0.1.0

### Minor Changes

- [#58](https://github.com/thomasfosterau/effect-ext/pull/58) [`809014c`](https://github.com/thomasfosterau/effect-ext/commit/809014c324bbeb8e6f9ce02a5b1cb33c4f305ca5) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - First release under this name: `@thomasfosterau/effect-ai-gateway` (published to 0.5.1, now deprecated) is renamed `@thomasfosterau/effect-ai-cloudflare` and extends the official `@effect/ai-cloudflare`. Every export of the gateway package keeps its name and behaviour, so moving is an import change. Changes since effect-ai-gateway 0.5.1, besides those listed with this release:
  
  - **Workers AI decision models, from the same package.** The new `WorkersAi` module re-exports `@effect/ai-cloudflare`'s `CloudflareClient`, `CloudflareDecisionModel` (Clef and Clef-flash for `effect/ai`'s `DecisionModel`) and `CloudflareSchema` unchanged, and wires that client to the AI Gateway the other routes use: `cloudflareClientLayer({ gateway, apiToken, apiUrl?, transformClient? })` sets its account id and `gatewayId` from a `GatewayUrlConfig` and sends the gateway's `cf-aig-authorization` token; `cloudflareClientLayerConfig` reads `CF_ACCOUNT_ID`, `CF_AIG_GATEWAY_ID`, `CF_AIG_TOKEN` and `CF_API_TOKEN` (the Cloudflare API token Workers AI REST authenticates with); `decisionModelLayerConfig({ model })` is the decision model over it.
  - **Breaking: new required peer and a higher `effect` floor.** `@effect/ai-cloudflare` is a peer (`^4.0.6`, the first release whose `CloudflareClient` routes through an AI Gateway), and the `effect` peer rises from `^4.0.0` to `^4.0.6`, which that release requires. `@effect/ai-anthropic` stays `^4.0.0`.
  - The package lives in [`thomasfosterau/effect-ext`](https://github.com/thomasfosterau/effect-ext); its `repository`, `homepage` and `bugs` fields point there.

- [#25](https://github.com/thomasfosterau/effect-ext/pull/25) [`db7a951`](https://github.com/thomasfosterau/effect-ext/commit/db7a951bd82f57ebfb89657579d047754cba357d) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - The OpenAI moderation provider follows `ModerationModel`'s multimodal inputs and richer results (effect-ai-ext#143; the abstraction is now `@thomasfosterau/effect-ext/ModerationModel`).
  
  - **Per-category flags.** Each `ModerationResult.flags` is filled from OpenAI's `categories` (nulls dropped).
  - **Resolved model id.** `ModerationResponse.modelId` is OpenAI's dated snapshot.
  - **Call ledger.** `OpenAiModerationOptions.onCall` observes each HTTP call's `status`, `durationMillis` and `error` (`OpenAiModerationCall`), on success and failure, on both transports.
  - Image file parts are sent as `image_url` parts, one request per multimodal input; a non-image file part fails with `AiError.InvalidUserInputError` before any request.

- [#57](https://github.com/thomasfosterau/effect-ext/pull/57) [`a09d3ca`](https://github.com/thomasfosterau/effect-ext/commit/a09d3ca1a5713af5a9f363b25ae4c7900c95e3a3) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - **Breaking:** the package now depends on `@thomasfosterau/effect-ext` instead of `@thomasfosterau/effect-ai-ext`, which merged into it. The abstractions it implements (`RerankerModel`, `ClassifierModel`, `SpeechModel`, `TranscriptionModel`, `VoiceConversionModel`, `ModerationModel`) are now `@thomasfosterau/effect-ext/<Module>`, with `Context` keys to match, so a consumer moves its own imports of them to `@thomasfosterau/effect-ext` in the same upgrade: a layer this version builds does not provide a tag imported from `@thomasfosterau/effect-ai-ext`.

### Patch Changes

- `OpenAiModeration` accepts an image file part whose `data` is in the tagged JSON form that encoding a prompt produces (`{ _tag: "Uint8Array", base64 }` or `{ _tag: "URL", href }`), which `Prompt.FilePartEncoded` admits from `effect` 4.0.6. The first is sent as a `data:` URI and the second as its URL.
- Updated dependencies [[`b888bd8`](https://github.com/thomasfosterau/effect-ext/commit/b888bd8816a3df41e082bac718d3996ee695ac09), [`9540034`](https://github.com/thomasfosterau/effect-ext/commit/95400348770d569e29ca71fb7625e837c2f1c7d7), [`854263d`](https://github.com/thomasfosterau/effect-ext/commit/854263dff04b6e88c57afea0a688abd61b9cf577), [`5d6b485`](https://github.com/thomasfosterau/effect-ext/commit/5d6b485562ca9b301bc88ecc54070deae711a1ac), [`36b09d0`](https://github.com/thomasfosterau/effect-ext/commit/36b09d0dda98d5f4c747205f2c9b2a63f77fb96e)]:
  - @thomasfosterau/effect-ext@0.1.0

## 0.5.1

### Patch Changes

- 83e7751: Doc comments on `GatewayBinding.gatewayId`, `GatewayUrlConfig.gatewayId` and the `Binding`, `Anthropic` and `Cohere` module headers no longer name an application's own bindings package or gateway.
- Updated dependencies [8380ae3]
  - @thomasfosterau/effect-ai-ext@0.5.1

## 0.5.0

### Minor Changes

- 132f796: **Breaking:** two changes ship together, so consumers upgrade once.
  
  - **The deprecated `RerankerModel` re-export is removed.** The gateway no longer exports `RerankerModel`, `RerankerUsage`, `RerankedDocument`, `RerankResponse` or `make`, nor the types `RerankOptions`, `ProviderOptions`, `ProviderResponse` and `Service`; each was tagged `@deprecated` in 0.4.x. Import them from `@thomasfosterau/effect-ai-ext/RerankerModel` instead, which exports the same values. `makeCohereReranker` and `makeCohereRerankerFromUrl` are unchanged and still return that module's `Service`.
  - **The optional `@cloudflare/workers-types` peer floor is now `>=4.20250312.0`** (was `>=4`). A Worker's `env.AI` from an older workers-types release is no longer assignable to `GatewayBinding.ai`, because its `AiGateway` lacks `getUrl()`: upgrade `@cloudflare/workers-types` to `4.20250312.0` or later. The gateway's published types no longer reference that package at all (see the `WorkersAiBinding` patch note), so a project that doesn't install it is unaffected.
  
  Also fixes the bundled declarations of `makeCohereReranker` and `makeCohereRerankerFromUrl`: `Cohere.ts` now imports `@thomasfosterau/effect-ai-ext/RerankerModel` directly instead of through the gateway's internal re-export module (deleted), so `dist/index.d.ts` types their result as that module's `Service` again rather than through a `RerankerModel_d_exports` namespace the `vp pack` declaration bundle never declared.
- 52cae13: **Breaking:** the OpenAI moderation models (`makeOpenAiModerationModel`, `makeOpenAiModerationModelFromUrl`) report the provider's `flagged` verdict as `isFlagged`, following `@thomasfosterau/effect-ai-ext`'s `ModerationModel` rename (#98). The wire field is still OpenAI's `flagged`; it is renamed where the response is decoded. Read `result.isFlagged` instead of `result.flagged`.

### Patch Changes

- 8816de6: `cfAigAuthorizationHeader` now declares its return type as the exact header it builds, the new exported `CfAigAuthorizationHeader` type (`{ readonly "cf-aig-authorization": string }`), instead of `Record<string, string>` (#98). The value is unchanged, and the new type is still assignable wherever a `Record<string, string>` is expected.
- 1ad16db: The published declarations no longer name `@cloudflare/workers-types`' ambient `Ai`, `AIGatewayProviders` and `AIGatewayUniversalRequest` globals, which a consumer that type-checks with `skipLibCheck: false` and doesn't install that optional peer saw as TS2304 (#113). The gateway now types them itself, with new exports:
  
  - `WorkersAiBinding` (`gateway(id)` → `WorkersAiGateway`, the `getUrl` / `run` slice the gateway calls) is the type of `GatewayBinding.ai`. A Worker's `env.AI`, typed `Ai` by `@cloudflare/workers-types` `4.20250312.0` or later (the new peer floor, see the breaking note), is assignable to it, so binding callers pass it unchanged.
  - `GatewayProvider` (the known provider slugs, autocompleted, or any string) types the `provider` parameter of `gatewayUrl` and `gatewayBaseUrl`.
  - `GatewayUniversalRequest` types `gatewayRun`'s request, and `GatewayRunOptions` the options it passes to `run()`.
  
  `@cloudflare/workers-types` stays an optional peer, needed only for your own Worker's typing; its floor rises to `>=4.20250312.0` (see the breaking note).
- 99c8d7d: Replace the dead `docs/decisions/effect-ai-gateway.md` citations in the `Anthropic` and `Cohere` module docs with the website issues that record the decisions (website#847, website#472).
- a651e14: Model-id and provider-id parameters are spelled `Model | (string & Record<never, never>)` instead of `Model | (string & {})` (#98). The accepted values are unchanged: any string is still accepted, and the known ids still autocomplete. In `effect-ai-cohere`, the embedding and reranker `model` options, which have no list of known ids, are now plain `string`.
- 79921eb: Build with `vp pack` (tsdown) instead of tsup. Every entry point and subpath keeps the same file name and the same runtime and type exports; only the internal chunk files under `dist/` are named differently, and the bundled declarations name types by their own names instead of minified aliases. The published `src/` is reformatted by Oxfmt with no code change.
- Updated dependencies [52cae13]
- Updated dependencies [132f796]
- Updated dependencies [79921eb]
  - @thomasfosterau/effect-ai-ext@0.5.0

## 0.4.1

### Patch Changes

- f900012: Tested against effect 4.0.0 (with @effect/ai-anthropic and @effect/platform-node 4.0.0); peer floor unchanged.
- Updated dependencies [f900012]
  - @thomasfosterau/effect-ai-ext@0.4.2

## 0.4.0

### Minor Changes

- 601c2c2: **Breaking:** `gatewayUrlConfig` (and every `make…FromUrl` / `…LayerFromUrl` that reads it) no longer defaults `CF_AIG_GATEWAY_ID` to `"website"`. The variable is now required: a missing or empty value fails layer construction with a typed `Config.ConfigError`, like `CF_ACCOUNT_ID` and `CF_AIG_TOKEN`. Consumers that relied on the default must now set `CF_AIG_GATEWAY_ID` explicitly before upgrading.

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

- 1091f13: **Breaking:** the `effect` and `@effect/ai-anthropic` peer dependencies move from the exact `4.0.0-beta.99` pin to the open floor `>=4.0.0-rc.113` (issue #32, the shared Effect-floor policy). You need `effect@4.0.0-rc.113` or later; any later rc is accepted. The package is built and tested on `4.0.0-rc.115`, and its type-check and unit suite also pass on rc.113, rc.114 and rc.117. rc.112 and every beta are no longer supported. This is a minor bump because the package is pre-1.0.
  
  - **Fixes the load-time crash on current Effect.** `gatewayUrlConfig` now reads its variables with `Config.String` / `Config.Redacted`. Effect rc.113 renamed these from `Config.string` / `Config.redacted`, so on rc.113 or later, 0.1.x failed as soon as it was imported with `TypeError: Config.string is not a function`.
  - `makeCohereEmbeddingModel` and `makeCohereEmbeddingModelFromUrl` are now typed as `EmbeddingModel.EmbeddingModel`, because rc.113 removed upstream's `EmbeddingModel.Service` alias. The runtime values are unchanged.
  - **Fixes the missing `RerankerModel` runtime exports.** In 0.1.x the bundled `dist/index.js` folded the `RerankerModel` deprecation re-export into an internal object, so `make`, `RerankerModel`, `RerankResponse`, `RerankedDocument` and `RerankerUsage` were in the types but not real ESM exports: `import { make } from "@thomasfosterau/effect-ai-gateway"` threw `SyntaxError: … does not provide an export named 'make'` under Node. They are now re-exported directly from `@thomasfosterau/effect-ai-ext/RerankerModel`. Importing from `@thomasfosterau/effect-ai-ext/RerankerModel` directly remains the recommended path.
- 7336d54: Two new providers, both built on the gateway's universal endpoint:
  
  - **`makeCohereRerankerFromUrl`** — the binding-free sibling of `makeCohereReranker`: a `RerankerModel` backed by Cohere `rerank-v3.5` over the gateway's public HTTPS endpoint (config-resolved `CF_ACCOUNT_ID` / `CF_AIG_GATEWAY_ID` / `CF_AIG_TOKEN`, read once at construction), for a plain Node process, a CLI or CI with no Worker `AI` binding. A plain Effect value (`yield* makeCohereRerankerFromUrl`), since it takes no options.
  - **`OpenAiModeration`** — `makeOpenAiModerationModel(binding, options?)` and `makeOpenAiModerationModelFromUrl(options?)`: a `ModerationModel` (`@thomasfosterau/effect-ai-ext`) backed by OpenAI `omni-moderation-latest`. BYOK by default; `options.apiKey` (a `Redacted`) sends the application's own key as the bearer token; `options.model` overrides the model. The response decode is lenient (unknown vendor fields never fail a valid response; `null` "not assessed" scores are dropped rather than graded as zero) and every failure is an `AiError`.
  
  Internally the Cohere and OpenAI modules now share one request/decode pipeline (`internal/transport.ts`) for both the Worker-binding and HTTPS transports, and each Cohere endpoint builds its request body and maps its response once for both transports. No change to the existing Cohere or Anthropic surface.

### Patch Changes

- 774a352: Fix the `homepage` link in every package manifest: it pointed at a `tree/main/…` path on GitHub, but the repository's default branch is `trunk`, so the link npm shows for each package 404'd. No code changes.
- Updated dependencies [1091f13]
- Updated dependencies [774a352]
  - @thomasfosterau/effect-ai-ext@0.3.0

## 0.1.1

### Patch Changes

- Updated dependencies [ef67371]
  - @thomasfosterau/effect-ai-ext@0.2.0
