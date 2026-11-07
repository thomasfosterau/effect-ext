---
"@thomasfosterau/effect-ext": patch
---

Internal lint clean-up of the web-platform modules (#31). Behaviour is unchanged. Two parameters were renamed in the emitted declarations, `UriTemplate.match(self, url)` (was `matcher`) and `WellKnown.suffixOf(uri)` (was `url`), with the same types.
