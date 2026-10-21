# effect-ext

A collection of experimental [Effect](https://effect.website) standard library extensions and additions.

> **Status:** experimental. APIs may change between minor versions until 1.0.

```sh
pnpm add effect-ext effect
```

Requires `effect@^4` and Node.js 22 or later (uses `ArrayBuffer.prototype.transfer`).

## Modules

Each module is available as a subpath export (`effect-ext/Vec`) and from the root barrel
(`import { Vec } from "effect-ext"`).

| Module           | Description                                                                         |
| ---------------- | ----------------------------------------------------------------------------------- |
| `Allocator`      | An `Allocator` service handing out `ArrayBuffer` blocks: heap, arena and tracked.   |
| `Layout`         | Binary layouts (`u8` … `f64`, `bool`, structs, fixed arrays) with C-like alignment. |
| `BufferStruct`   | Structs whose fields live in an `ArrayBuffer`, exposed as ordinary properties.      |
| `Vec`            | A growable, `ArrayBuffer`-backed array, like Rust's `Vec<T>`.                       |
| `StructOfArrays` | A growable struct-of-arrays container with typed-array columns.                     |
| `Utf8String`     | An immutable UTF-8 string backed by a `Uint8Array`, like Rust's `str`.              |

### Allocator

`Allocator.Allocator` is a `Context.Reference`, so it never needs to be provided — it defaults to
the heap allocator (one `ArrayBuffer` per block). Swap it out for a whole program or a single
region:

```ts
import { Effect } from "effect"
import { Allocator, Layout, Vec } from "effect-ext"

const program = Effect.gen(function* () {
  const v = yield* Vec.make(Layout.u32)
  yield* Vec.extend(v, [1, 2, 3])
})

// One 1 MiB bump arena for everything allocated by `program`
program.pipe(Effect.provide(Allocator.layerArena(1024 * 1024)))
```

Allocation failures surface as a typed `AllocationError`. Every data structure has a `makeScoped`
variant that returns its memory to the allocator when the scope closes.

### BufferStruct

```ts
import { Effect } from "effect"
import { BufferStruct, Layout } from "effect-ext"

const Vec2 = Layout.struct({ x: Layout.f32, y: Layout.f32 })
const Body = Layout.struct({ position: Vec2, mass: Layout.f64, alive: Layout.bool })

Effect.gen(function* () {
  const body = yield* BufferStruct.make(Body, { position: { x: 0, y: 0 }, mass: 1, alive: true })
  body.position.x += 5 // nested structs are live views into the same memory
  BufferStruct.bytes(body) // Uint8Array(24)
})
```

`BufferStruct.view(layout, buffer, offset)` overlays a struct on memory you already have.

### Vec

```ts
import { Effect, Option } from "effect"
import { Layout, Vec } from "effect-ext"

const Vec2 = Layout.struct({ x: Layout.f32, y: Layout.f32 })

Effect.gen(function* () {
  const xs = yield* Vec.fromIterable(Layout.f64, [1, 2, 3])
  yield* Vec.push(xs, 4)
  const array: Float64Array = Vec.typedArray(xs) // zero-copy view

  const points = yield* Vec.make(Vec2, { capacity: 1024 })
  yield* Vec.push(points, { x: 1, y: 2 })
  const p = Option.getOrThrow(Vec.at(points, 0)) // BufferStruct view of element 0
})
```

### StructOfArrays

```ts
import { Effect } from "effect"
import { Layout, StructOfArrays } from "effect-ext"

Effect.gen(function* () {
  const particles = yield* StructOfArrays.make({ x: Layout.f32, y: Layout.f32, id: Layout.u32 })
  yield* StructOfArrays.push(particles, { x: 1, y: 2, id: 0 })
  const xs: Float32Array = StructOfArrays.column(particles, "x") // zero-copy column
})
```

### Utf8String

```ts
import { Equal, HashSet } from "effect"
import { Utf8String } from "effect-ext"

const s = Utf8String.fromString("héllo wörld")
Utf8String.byteLength(s) // 13
Utf8String.length(s) // 11 code points
Utf8String.split(s, " ") // zero-copy slices
Equal.equals(s, Utf8String.fromString("héllo wörld")) // true — usable in HashMap / HashSet
```

Byte-wise ordering (`Utf8String.Order`) matches Unicode code point order, unlike JavaScript's
UTF-16 string comparison.

## Development

This repository uses [Vite+](https://viteplus.dev) (`vp`) for formatting, linting, type checking,
testing and packaging, and [Changesets](https://github.com/changesets/changesets) for releases.

```sh
vp install      # install dependencies (also installs the pre-commit hook)
vp check        # format check, lint and type check (vp check --fix to fix)
vp test         # run the test suite (vp test watch for watch mode)
vp pack         # build dist/ with tsdown
vp run changeset  # describe your change for the changelog
```

### Releasing

1. Add a changeset to every pull request that affects the published package.
2. When changesets land on `main`, the release workflow opens a "Version Packages" pull request.
3. Merging that pull request publishes to npm with provenance via trusted publishing.

## License

[MIT](./LICENSE)
