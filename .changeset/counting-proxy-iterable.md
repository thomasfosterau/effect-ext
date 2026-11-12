---
"@thomasfosterau/effect-ext": patch
---

`Observability.countingProxy` takes its method names as any `Iterable<string>` (an array, a `HashSet` or a `Set`), not only a native `ReadonlySet` (#98). They are read once, into a `HashSet`, when the proxy is made, so each call still costs one lookup. Every existing call keeps working.
