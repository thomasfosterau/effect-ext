---
"@thomasfosterau/effect-ext": minor
---

`OptionalKey.presentFields(input)` copies the members of `input` that are neither `null` nor `undefined`, typed `Present<T>`: each member that admits `null` or `undefined` becomes optional without them, and every other member stays required. It is for the row-to-resource boundary, where a nullable column becomes an optional key. Keep `fields` for a tri-state update input, where `null` means "clear".
