---
"@thomasfosterau/effect-platform-worker-shared": minor
"@thomasfosterau/effect-platform-browser": minor
---

Adds `EventSource` to effect-platform-worker-shared: server-sent events in a window and in dedicated and shared workers, as a stream of `effect/encoding/Sse` events through the browser's own reconnects, with `events(url, schema)` to decode JSON payloads. `EventSourceClient` is a context reference that defaults to the ambient `EventSource`. effect-platform-browser's `BrowserTesting` gains `TestEventSource`, an in-memory server.
