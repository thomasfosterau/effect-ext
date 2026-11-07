---
"@thomasfosterau/effect-ext": patch
---

`Robots` group selection now compares product tokens (#79). Both the `User-agent:` value and the crawler's name are reduced to their leading run of letters, `_` and `-` (RFC 9309 §2.2.1), so `User-agent: GardeneriaBot/1.0` binds the `GardeneriaBot` crawler, and a crawler passing its versioned name still finds its group. Matching remains exact or prefix, never substring, and a line with no token matches nothing.
