---
"effect-numeric": patch
---

The arithmetic error classes (`OverflowError`, `DivisionByZeroError`, `OutOfRangeError`, `DomainError`, `ParseError`) are now nominally branded in their emitted types, so a structurally identical object no longer type-checks where one of them is expected. Runtime behaviour is unchanged.

`Clamped`'s exact `schema` and every number-backed `FixedInt` type's `schemaFromString` now decode through `Schema.Finite` / `Schema.FiniteFromString`. They accept exactly the same values as before, but `NaN` and `±Infinity` now fail with "Expected a finite number", and a `Clamped` schema's JSON Schema now carries its `minimum` / `maximum` instead of a bare `number` that admitted `"NaN"` / `"Infinity"` strings. `Clamped`'s `schemaClamping` still maps `±Infinity` onto its bounds, and the `Float`, `F32` and `Complex` schemas still accept every IEEE 754 value.
