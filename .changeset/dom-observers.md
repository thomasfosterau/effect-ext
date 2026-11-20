---
"@thomasfosterau/effect-platform-browser": minor
---

Adds `DomObservers`: `IntersectionObserver`, `ResizeObserver` and `MutationObserver` as streams (`intersection`, `resize`, `mutation`), each owning one observer for the stream's lifetime, plus `awaitVisible` and `whileVisible`. `Browser.layer` provides it, and `BrowserTesting`'s `TestDomObservers` doubles it.
