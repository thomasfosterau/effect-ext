---
"@thomasfosterau/effect-ext": minor
---

The numeric modules of `effect-numeric` and the time-format modules of `@thomasfosterau/effect-time` join `@thomasfosterau/effect-ext` (merged in from thomasfosterau/effect-numeric and thomasfosterau/effect-time with their history; neither package was ever published). Each module is one subpath with the same exports:

- **Numeric** — `I8`, `I16`, `I32`, `I64`, `I128`, `U8`, `U16`, `U32`, `U64` and `U128` (Rust's fixed-width integers, with strict, checked, wrapping, saturating and overflowing arithmetic), `FixedInt` (any width), the `Wrapping`, `Saturating`, `Checked` and `Overflowing` strategies, `Clamped`, `Float` and `F32`, `Ratio`, `Complex`, the `num-traits` style `Num`, `Integer` and `Range`, and `ArithmeticError`. The barrel re-exports them, the integer modules and `F32` as their one value (`import { U8 } from "@thomasfosterau/effect-ext"`).
- **Time** — `Rfc3339`, `Rfc9557`, `IsoDuration`, `PosixTz`, `CronExpression`, `RRule`, `IanaTimeZone` and `Tzif`, each a parser, an effectful decoder, a printer and a `Schema` over Effect's own `DateTime`, duration amounts and `Cron`. They need the optional peer `@thomasfosterau/effect-parse` (`^0.4.1`), so they are subpaths only, like `Robots`.

effect-time's re-exports of `effect/Clock` and `effect/DateTime` are not carried: import them from `effect`.
