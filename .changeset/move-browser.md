---
"@thomasfosterau/effect-ext": minor
---

Breaking: the `Browser` and `BrowserTesting` subpaths and the `Browser` barrel namespace are removed, and `@effect/platform-browser` is no longer a peer. They now live in `@thomasfosterau/effect-platform-browser`: each service is its own subpath there (`Locks`, `Navigator`, `PageVisibility`, …), `Browser.layer` provides them all, and `BrowserTesting` holds the doubles. Their `Context` keys moved too, from `@thomasfosterau/effect-ext/Browser/<Service>` to `@thomasfosterau/effect-platform-browser/<Service>`.
