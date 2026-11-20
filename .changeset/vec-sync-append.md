---
"@thomasfosterau/effect-ext": minor
---

Adds synchronous appends to `Vec` and `StructOfArrays`, so a hot loop can fill them without running an `Effect` per element: `pushResult` and `reserveResult` (allocation failure as a `Result`), `pushUnsafe` (into reserved capacity), and `setLenUnsafe` with `Vec.spareCapacity` / `Vec.spareBytes` / `StructOfArrays.spareColumn` for bulk fills of the memory past the length, as Rust's `spare_capacity_mut` and `set_len`. Reading a whole struct record (a struct `Layout`'s `read`, `Vec.get` of a struct, `StructOfArrays.get` / `getUnsafe`) is about a quarter faster.
