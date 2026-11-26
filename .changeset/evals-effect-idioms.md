---
"@thomasfosterau/effect-ext": patch
---

Evals: `jsonValidity` parses through `Schema.fromJsonString`, so the `reason` for unparseable output is now the schema error's message. `Cache.hashKey` hex-encodes with `effect/encoding`'s `Hex` (keys are unchanged). The `effect-evals` CLI discovers eval files through `FileSystem.glob` instead of Node's `fs.promises.glob`; as before, `node_modules` and `.git` are skipped, and so are other dot-directories.
