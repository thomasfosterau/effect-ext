---
"@thomasfosterau/effect-ext": patch
---

`Web.applyToWebHeaders` and `Web.updateWebHeaders` now apply a header the policy removes (#93). They used to write only the headers a policy added or changed, so a policy that stripped an upstream header (`Headers.remove(headers, "vary")`, say, before `responseVary(…, "locale-invariant")`) silently kept it. `updateWebHeaders` still returns the same response when the policy changed nothing, and a clone otherwise.
