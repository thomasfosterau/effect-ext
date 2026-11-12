# Binary data

An `Allocator` service, binary `Layout`s, `BufferStruct`s, `Vec`, `StructOfArrays`, and Rust-style UTF-8 `String` / `Str`. Part of [`@thomasfosterau/effect-ext`](https://github.com/thomasfosterau/effect-ext/tree/trunk/packages/effect-ext). The per-export reference is the doc comments in `src/`.

## Allocator

`Allocator.Allocator` is a `Context.Reference`, so it never needs to be provided — it defaults to the heap allocator (one `ArrayBuffer` per block). Swap it out for a whole program or a single region:

```ts
import { Effect } from "effect";
import { Allocator, Layout, Vec } from "@thomasfosterau/effect-ext";

const program = Effect.gen(function* () {
  const v = yield* Vec.make(Layout.u32);
  yield* Vec.extend(v, [1, 2, 3]);
});

// One 1 MiB bump arena for everything allocated by `program`
program.pipe(Effect.provide(Allocator.layerArena(1024 * 1024)));
```

Allocation failures surface as a typed `AllocationError`. Every data structure has a `makeScoped` variant that returns its memory to the allocator when the scope closes.

## BufferStruct

```ts
import { Effect } from "effect";
import { BufferStruct, Layout } from "@thomasfosterau/effect-ext";

const Vec2 = Layout.struct({ x: Layout.f32, y: Layout.f32 });
const Body = Layout.struct({ position: Vec2, mass: Layout.f64, alive: Layout.bool });

Effect.gen(function* () {
  const body = yield* BufferStruct.make(Body, { position: { x: 0, y: 0 }, mass: 1, alive: true });
  body.position.x += 5; // nested structs are live views into the same memory
  BufferStruct.bytes(body); // Uint8Array(24)
});
```

`BufferStruct.view(layout, buffer, offset)` overlays a struct on memory you already have.

## Vec

```ts
import { Effect, Option } from "effect";
import { Layout, Vec } from "@thomasfosterau/effect-ext";

const Vec2 = Layout.struct({ x: Layout.f32, y: Layout.f32 });

Effect.gen(function* () {
  const xs = yield* Vec.fromIterable(Layout.f64, [1, 2, 3]);
  yield* Vec.push(xs, 4);
  const array: Float64Array = Vec.typedArray(xs); // zero-copy view

  const points = yield* Vec.make(Vec2, { capacity: 1024 });
  yield* Vec.push(points, { x: 1, y: 2 });
  const p = Option.getOrThrow(Vec.at(points, 0)); // BufferStruct view of element 0
});
```

## StructOfArrays

```ts
import { Effect } from "effect";
import { Layout, StructOfArrays } from "@thomasfosterau/effect-ext";

Effect.gen(function* () {
  const particles = yield* StructOfArrays.make({ x: Layout.f32, y: Layout.f32, id: Layout.u32 });
  yield* StructOfArrays.push(particles, { x: 1, y: 2, id: 0 });
  const xs: Float32Array = StructOfArrays.column(particles, "x"); // zero-copy column
});
```

## String and Str

These mirror Rust's `String` and `str`. Both hold valid UTF-8, and as in Rust, indices are byte offsets and lengths are in bytes. A `String` is growable and mutable, and its memory comes from the current `Allocator`. A `Str` is an immutable, zero-copy string slice with Rust's `str` API, and works as a key in Effect's `HashMap` and `HashSet`.

```ts
import * as Effect from "effect/Effect";
import { Str, String } from "@thomasfosterau/effect-ext";

Effect.gen(function* () {
  const s = yield* String.from("héllo");
  yield* String.pushStr(s, " wörld");
  yield* String.push(s, "!");
  String.pop(s); // Option.some("!")
  String.len(s); // 13 (bytes)

  // For the full `str` API, take an immutable snapshot (a copy that later
  // mutation cannot affect):
  const words = Str.split(String.toStr(s), " "); // [Str("héllo"), Str("wörld")]
});

const line = Str.fromString("  key = value  ");
Str.splitOnce(Str.trim(line), " = "); // Option.some([Str("key"), Str("value")])
Str.find(line, (c) => c === "="); // Option.some(6) — patterns can be strings or char predicates
Str.split(Str.fromString("abc"), ""); // ["", "a", "b", "c", ""], as in Rust
```

`Str.Order` compares strings byte-wise, which matches Unicode code point order (unlike JavaScript's UTF-16 comparison).
