---
"@thomasfosterau/effect-ext": minor
---

Adds the `OptionalKey` module (`@thomasfosterau/effect-ext/OptionalKey`, and `OptionalKey` on the barrel). Under `exactOptionalPropertyTypes`, spread `optionalKey(key, value?)` instead of `...(value !== undefined ? { key: value } : {})`: the result holds the key exactly when the value is not `undefined`. `null` and other falsy values keep their key. `fromOption(key, option)` is the same over an `Option`. Every absent result is one shared, frozen empty object, so an absent key allocates nothing.
