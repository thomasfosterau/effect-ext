---
"@thomasfosterau/effect-platform-browser": minor
---

Adds the browser services that were effect-ext's `Browser`, one subpath each: `Locks`, `Navigator`, `PageVisibility`, `MediaQuery`, `WakeLock`, `Broadcast`, `IdleDetection`, `Battery`, `Fullscreen`, `ScreenOrientation`, `Notifications` and `PermissionStatus`, with `Browser.layer` providing them all. `BrowserTesting` holds the in-memory doubles for them and for `@effect/platform-browser`'s services. `@effect/platform-browser` is now a peer.
