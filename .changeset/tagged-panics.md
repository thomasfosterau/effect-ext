---
"@thomasfosterau/effect-ext": minor
---

Breaking: misuse of the binary-data and numeric modules now throws, or dies with, a tagged error instead of a bare `RangeError` / `TypeError`.

- The new `Panic` module defines `IndexOutOfBoundsError`, `CapacityError`, `CharBoundaryError` and `InvalidArgumentError` (all `Schema.TaggedError`s), plus `isPanic`.
- `Vec`, `StructOfArrays`, `Str`, `StringBuf`, `Layout` and `BufferStruct` use them: an out-of-range `getUnsafe`, a `pushUnsafe` into a full container, a `splitOff` off a character boundary, a reserved field name and so on.
- `Clamped`, `Complex`, `FixedInt`, `Integer`, `Ratio`, `Range` and `Num` throw `ArithmeticError.DomainError` for an argument they cannot accept (a zero step, a fractional exponent, an invalid bit width).

Migration: code that catches these with `instanceof RangeError` or `instanceof TypeError`, or that reads `.message`, should match the new class or its `_tag` instead (`Cause.findDefect` reads one from an `Effect` form's defect). Messages keep the same wording, except a full `pushUnsafe`, which now reads `"<type>: length <n> out of bounds (capacity <cap>)"`.
