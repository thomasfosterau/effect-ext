---
"@thomasfosterau/effect-ext": patch
"@thomasfosterau/effect-ai-mistral": patch
"@thomasfosterau/effect-ai-cohere": patch
"@thomasfosterau/effect-ai-voyage": patch
"@thomasfosterau/effect-ai-elevenlabs": patch
---

The `effect` peer range, and the `@effect/ai-anthropic`, `@effect/platform-node` and `@effect/platform-browser` peers, change form from `>=4.0.0` to `^4.0.0` per the peer-range policy. Only the form changes: the floor stays 4.0.0, tested there. Effect 5 is no longer admitted. `IdleDetection.watch` now fails its stream when the detector refuses to start on effect 4.0.0, where the stream used to wait forever.
