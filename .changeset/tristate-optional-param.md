---
"@thomasfosterau/effect-ext": patch
---

`TriState.read`, `TriState.suppliedValue` and `TriState.toNullOr` declare their parameter as optional, `field?: Option.Option<A>`, instead of `field: Option.Option<A> | undefined`. The parameter accepts exactly the same arguments, so this is not a break: an absent key read from a decoded input (`undefined`) is still the tri-state's outer "absent" half.
