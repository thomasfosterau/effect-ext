---
"@thomasfosterau/effect-platform-worker-shared": minor
"@thomasfosterau/effect-platform-browser": minor
---

Adds `Usb` to `effect-platform-worker-shared`: WebUSB from a window or a dedicated worker. `request`, `devices` and `connections` reach the granted devices; `open` holds a device for a scope with a configuration selected and an interface claimed, and returns a `Handle` for bulk, interrupt and control transfers (with `inbound` streaming an endpoint's reads). `BrowserTesting` gains `TestUsb`, in-memory devices to drive it.
