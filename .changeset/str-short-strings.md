---
"@thomasfosterau/effect-ext": patch
---

`Str`: equality, `Str.Order` and `Equal.equals` compare bytes in an indexed loop rather than a callback per byte (about 3× faster for 12 bytes, 5× for 64), and `toString` on a `Str` or `StringBuf` of up to 12 ASCII bytes builds the string without `TextDecoder`; `String(str)` no longer goes through the ordinary `valueOf`-then-`toString` conversion. Results are unchanged for every input.
