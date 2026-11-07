---
"@thomasfosterau/effect-ext": minor
---

Allocator and Layout fixes (#18, #19):

- `Allocator.tracked` now tracks its blocks by identity. A double free, or freeing a block it never handed out, no longer drives `liveBlocks` / `liveBytes` negative. Such a call is counted in a new `Stats.invalidDeallocations` and isn't passed on to the underlying allocator, so a stale free can't release the arena block that now occupies the same bytes. A block replaced by `reallocate` is no longer live.
- `Layout.alignUp`, the arena's offset rounding and the alignment check use arithmetic instead of 32-bit bitwise operators. They are now exact at 2^31 bytes and beyond, where `alignUp(2 ** 31, 8)` returned `-2147483648` before.
- `Allocator.makeArena` fails with `AllocationError`, and `makeArenaUnsafe` throws it, for a capacity that isn't a non-negative integer (`1.5` was accepted with `buffer.byteLength` 1).
- The arena's "full" message is the same whether a block grows in place or a new one is bumped: `arena exhausted (N of M bytes free)`.
