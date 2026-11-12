---
"@thomasfosterau/effect-ext": patch
---

`Encoding`'s `DecodeError` / `EncodeError` (`offset`, `codePoint`), `ServiceWorker`'s `PrecacheRejected` (`status`) and `UriTemplate`'s parse error (`position`) declare their numeric fields as `Schema.Int` instead of `Schema.Number`. These fields always held integers; their schemas now say so, and they reject `NaN` and the infinities.
