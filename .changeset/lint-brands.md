---
"@thomasfosterau/effect-ext": minor
"@thomasfosterau/effect-platform-browser": minor
"@thomasfosterau/effect-platform-service-worker": minor
"@thomasfosterau/effect-platform-worker-shared": minor
"@thomasfosterau/effect-platform-worker": minor
---

Brand every `Schema` error and value class (`Schema.TaggedError<Self, { readonly brand: unique symbol }>`, and the same on effect-ext's AI response classes such as `ClassifyResponse`, `RerankResponse` and `SpeechResponse`). A structurally identical object no longer type-checks where one of these classes is expected: construct it with `new` instead.
