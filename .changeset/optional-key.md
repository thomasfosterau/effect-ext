---
"@thomasfosterau/effect-ext": minor
---

Adds the `OptionalKey` module (`@thomasfosterau/effect-ext/OptionalKey`, and `OptionalKey` on the barrel). Under `exactOptionalPropertyTypes`, spread `optionalKey(key, value?)` instead of `...(value !== undefined ? { key: value } : {})`: the result holds the key exactly when the value is not `undefined`. `null` and other falsy values keep their key. `fromOption(key, option)` is the same over an `Option`, and `fields(input)` is the whole-object form: it copies the members that are not `undefined`, typed `Defined<T>`. `presentFields(input)` also drops `null` members (typed `Present<T>`), for the row-to-resource boundary where a nullable column becomes an optional key. Every absent result is one shared, frozen empty object, so an absent key allocates nothing.
