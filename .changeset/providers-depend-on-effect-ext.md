---
"@thomasfosterau/effect-ai-cohere": minor
"@thomasfosterau/effect-ai-voyage": minor
"@thomasfosterau/effect-ai-elevenlabs": minor
"@thomasfosterau/effect-ai-gateway": minor
---

**Breaking:** the package now depends on `@thomasfosterau/effect-ext` instead of `@thomasfosterau/effect-ai-ext`, which merged into it. The abstractions it implements (`RerankerModel`, `ClassifierModel`, `SpeechModel`, `TranscriptionModel`, `VoiceConversionModel`, `ModerationModel`) are now `@thomasfosterau/effect-ext/<Module>`, with `Context` keys to match, so a consumer moves its own imports of them to `@thomasfosterau/effect-ext` in the same upgrade: a layer this version builds does not provide a tag imported from `@thomasfosterau/effect-ai-ext`.
