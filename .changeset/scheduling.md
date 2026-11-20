---
"@thomasfosterau/effect-platform-worker-shared": minor
"@thomasfosterau/effect-platform-browser": minor
---

Add `TaskScheduler` to effect-platform-worker-shared: an `effect/Scheduler` over `scheduler.postTask` (falling back to a `MessageChannel`), with `layer`, `withPriority` and `yieldToMain`. Add `Frames` to effect-platform-browser (animation frames and idle callbacks), part of `Browser.layer`, with the `TestFrames` double.
