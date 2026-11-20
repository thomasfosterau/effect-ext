---
"@thomasfosterau/effect-platform-worker-shared": minor
"@thomasfosterau/effect-platform-browser": minor
---

Add `Performance` to effect-platform-worker-shared: high-resolution time, user timing (`mark`, `measure`, `timed`) and the performance timeline as a stream (`observe`), the same in a window and every worker, as a context reference over the ambient `performance`. Add `WebVitals` to effect-platform-browser: LCP, CLS, INP, FCP and TTFB as streams over that timeline, each a pure fold that runs over fixture entries, plus `BrowserTesting`'s `TestPerformance`, a timeline on a manual clock.
