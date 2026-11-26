---
"@thomasfosterau/effect-ext": minor
---

Breaking: the `effect` peer floor rises from `^4.0.0` to `^4.0.5`. `Har` and `Warc` redact recorded query parameters through Effect's own `UrlParams.CurrentRedactedNames`, which first shipped in effect 4.0.5. To migrate, upgrade `effect` to 4.0.5 or later; to change which query parameters a recording redacts, provide `UrlParams.CurrentRedactedNames`.
