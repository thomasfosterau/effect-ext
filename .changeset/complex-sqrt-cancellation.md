---
"@thomasfosterau/effect-ext": patch
---

`Complex.sqrt` no longer loses a part that is tiny next to the other one to cancellation (#39): `sqrt(1 + 1e-10i)` is `1 + 5e-11i` (was `1 + 0i`) and `sqrt(-1 + 1e-10i)` is `5e-11 + 1i` (was `0 + 1i`), matching num-complex. It now uses the stable form, which recovers the smaller part by division rather than by subtracting nearly equal terms.
