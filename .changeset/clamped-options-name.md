---
"@thomasfosterau/effect-ext": minor
---

`Clamped.Options.name` is `readonly name?: string`, not `string | undefined`, following the package's options-member rule (#17). A caller holding `undefined` omits the key: spread `OptionalKey.optionalKey("name", name)`.
