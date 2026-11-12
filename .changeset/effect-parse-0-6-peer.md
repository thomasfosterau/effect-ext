---
"@thomasfosterau/effect-ext": patch
---

Widen the optional `@thomasfosterau/effect-parse` peer, used by `Robots` and the time modules, from `^0.4.1 || ^0.5.0` to `^0.4.1 || ^0.5.0 || ^0.6.0`, so an app on effect-parse 0.6 no longer gets an unmet-peer warning. effect-parse 0.6's breaking changes do not reach what these modules use. Every repetition in their grammars consumes input; they don't serialise a `ParseError`'s `input`; and they don't use `ParserStream`. The robots and time suites pass on 0.6.0.
