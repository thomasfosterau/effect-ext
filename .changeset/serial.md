---
"@thomasfosterau/effect-platform-worker-shared": minor
"@thomasfosterau/effect-platform-browser": minor
---

Adds `Serial` to `effect-platform-worker-shared`: Web Serial from a window or a dedicated worker. `request`, `ports` and `connections` reach the granted ports; `open` holds a port for a scope and returns a `Connection` that streams reads, writes bytes and sets the control lines, and closes the port when the scope closes. `BrowserTesting` gains `TestSerial`, in-memory ports to drive it.
