---
"@thomasfosterau/effect-ext": minor
---

`ServiceWorker.CacheHandle.keys` is now an `Effect` rather than a function returning one. Migrate `yield* cache.keys()` to `yield* cache.keys` (and `Effect.flatMap(cache.keys, …)`); a hand-written `CacheHandle` supplies `keys: Effect.…` instead of `keys: () => Effect.…`.
