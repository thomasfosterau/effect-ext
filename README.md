# effect-utilities

Experimental extensions to the [Effect](https://effect.website) standard library, published as one package, [`@thomasfosterau/effect-utilities`](packages/effect-utilities/README.md):

- **Binary data** — an `Allocator` service handing out `ArrayBuffer` blocks, binary `Layout`s with C-like alignment, `BufferStruct`s, a growable `Vec`, a `StructOfArrays` container, and Rust-style UTF-8 `String` / `Str` with byte offsets and Rust's method names.
- **Schema** — partial-update fields that keep "absent" and "cleared" apart, `SchemaIssue` trees rendered as RFC 6901 JSON Pointers, bounded pagination and id-list codecs, branded UUIDs and slugs, exact literal-union tuples, field introspection by decode probe, and URLs whose scheme, host, port, credentials and path are part of their type.

> **Status:** experimental. APIs may change between minor versions until 1.0. This repository and its package have been created using Claude Code.

The Schema modules other than `Url` were developed in `thomasfosterau/effect-schema-ext` and moved here before either package was first published; a `effect-schema-ext#NN` reference in a comment is an issue in that tracker.

## Packages

| Package | Description |
| --- | --- |
| [`@thomasfosterau/effect-utilities`](packages/effect-utilities/README.md) | The extensions, one subpath per module: `Allocator`, `Layout`, `BufferStruct`, `Vec`, `StructOfArrays`, `String`, `Str`, `TriState`, `Issues`, `Bounded`, `Ids`, `LiteralExact`, `Ast`, `Url`. |

Published as ESM with declarations and `"sideEffects": false`; requires Node.js 22 or later.

## Install

```sh
pnpm add @thomasfosterau/effect-utilities effect
```

## Example

```ts
import { Effect, Schema } from "effect";
import { Layout, TriState, Vec } from "@thomasfosterau/effect-utilities";

// A growable Float64Array-backed vector
const xs = Effect.runSync(Vec.fromIterable(Layout.f64, [1, 2, 3]));
Vec.typedArray(xs); // Float64Array [1, 2, 3], zero-copy

// A partial-update field that tells "leave it alone" from "clear it"
const UpdateNote = Schema.Struct({ id: Schema.String, summary: TriState.clearable(Schema.String) });
const cleared = Schema.decodeUnknownSync(UpdateNote)({ id: "n1", summary: null });
TriState.read(cleared.summary); // { _tag: "Clear" }
```

## Documentation

- [Package README](packages/effect-utilities/README.md) — the API reference, module by module.
- [CONTRIBUTING.md](CONTRIBUTING.md) — setup, hooks and the individual checks.
- [AGENTS.md](AGENTS.md) — repository conventions and the verification gates.
- [PUBLISHING.md](PUBLISHING.md) — the changesets release flow and its one-time setup.
- [SECURITY.md](SECURITY.md) — vulnerability reporting and the supply-chain posture.

## License

[MIT](LICENSE)
