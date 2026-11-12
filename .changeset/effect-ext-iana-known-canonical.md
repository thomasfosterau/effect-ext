---
"@thomasfosterau/effect-ext": patch
---

`IanaTimeZone.known` returns the runtime's canonical zone (`US/Eastern` gives `America/New_York`) on Effect 4.1 as it did on 4.0; Effect 4.1's `DateTime.zoneMakeNamed` keeps the alias it is given.
