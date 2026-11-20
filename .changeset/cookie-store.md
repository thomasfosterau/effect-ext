---
"@thomasfosterau/effect-platform-worker-shared": minor
"@thomasfosterau/effect-platform-browser": minor
---

Adds `CookieStore` to effect-platform-worker-shared: cookies in a window and a service worker over the Cookie Store API, falling back to `document.cookie` (through `effect/http/Cookies`) where a window lacks it, with `get`, `getAll`, `set` (`expires` as a `DateTime`), `remove`, a `changes` stream, and `cookie(name, schema)` for one cookie read, written and watched through a schema. effect-platform-browser's `BrowserTesting` gains `TestCookieStore`, an in-memory jar behind either API.
