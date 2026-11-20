---
"@thomasfosterau/effect-ext": minor
---

Rename the growable UTF-8 string module from `String` to `StringBuf`, so importing it no longer shadows the global `String`. `Str` is unchanged.

Migration: `import { String } from "@thomasfosterau/effect-ext"` becomes `import { StringBuf } from "@thomasfosterau/effect-ext"`, the `./String` subpath becomes `./StringBuf`, the `String` type becomes `StringBuf.StringBuf`, and `String.isString` becomes `StringBuf.isStringBuf`. The type id (`~effect-ext/StringBuf`) and the `toJSON` `_id` (`"StringBuf"`) change to match.
