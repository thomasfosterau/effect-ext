---
"@thomasfosterau/effect-platform-browser": minor
---

Add `Navigation`: the current URL and its changes, `navigate`, `back` and `forward`, history state typed by a `Schema`, and `intercept`, which runs an Effect for each navigation a router takes over. It works over the Navigation API, falling back to `history` and `popstate` where the browser lacks it. `Browser.layer` provides it, and `BrowserTesting`'s `TestNavigation` doubles both modes.
