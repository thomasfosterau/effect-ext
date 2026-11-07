---
"@thomasfosterau/effect-ext": patch
---

Widen the optional `@thomasfosterau/effect-parse` peer, used by `Robots` and the time modules, from `^0.4.1` to `^0.4.1 || ^0.5.0`, so a consumer on effect-parse 0.5 no longer gets a peer warning. Both minors pass the type check and test suite.
