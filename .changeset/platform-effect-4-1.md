---
"@thomasfosterau/effect-platform-worker-shared": minor
"@thomasfosterau/effect-platform-worker": minor
"@thomasfosterau/effect-platform-service-worker": minor
"@thomasfosterau/effect-platform-browser": minor
---

Peer on `effect` `^4.1.0` (and `@effect/platform-browser` `^4.1.0` for the browser package). They use `FileSystem.DirectoryEntry`, `FileSystem.lstat` and `Semaphore.takeScoped`, which first shipped in Effect 4.1.0, so the old `^4.0.0` range was never met.
