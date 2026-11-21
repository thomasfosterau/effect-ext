---
"@thomasfosterau/effect-platform-worker-shared": minor
"@thomasfosterau/effect-platform-browser": minor
---

Adds `Hid` to `effect-platform-worker-shared`: WebHID from a window or a dedicated worker. `request`, `devices` and `connections` reach the granted devices; `open` holds a device for a scope and returns a `Handle` that streams its input reports and sends output and feature reports. `BrowserTesting` gains `TestHid`, in-memory devices to drive it.
