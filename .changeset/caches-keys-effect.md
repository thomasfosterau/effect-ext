---
"@thomasfosterau/effect-platform-service-worker": minor
---

`CacheHandle.keys` is an `Effect` rather than a function returning one: write `yield* cache.keys` instead of `yield* cache.keys()`.
