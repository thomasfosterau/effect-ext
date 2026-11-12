# Numeric

Rust-style numeric types, modelled on Rust's primitive integers and the [`num`](https://github.com/rust-num/num) crates: fixed-width integers `I8` ... `I128`, `U8` ... `U128` (and any width you define) with strict, checked, wrapping, saturating and overflowing arithmetic, clamped ranges, floats with IEEE 754 total ordering, exact rationals, complex numbers and `num-traits` style type classes. These were `effect-numeric`.

Numeric types modelled on Rust's primitive integers and its [`num`](https://github.com/rust-num/num) crates (merged in from thomasfosterau/effect-numeric, which was never published). Rust's documented semantics are the spec. Everything is Effect-native: values are `Brand`ed, failures are `Schema.TaggedError`s carried in `Result` / `Option` (lift them with `Effect.fromResult`), every type ships a `Schema`, `Order` and `Equivalence`, value objects implement `Equal` / `Hash`, and every binary operation is dual. The barrel re-exports each integer module and `F32` as its one value (`import { U8 } from "@thomasfosterau/effect-ext"`) and the rest as namespaces; each is also its own subpath (`@thomasfosterau/effect-ext/U8`, `@thomasfosterau/effect-ext/Ratio`, …).

## Fixed-width integers

```ts
import { Effect, Option, pipe } from "effect";
import { I8 } from "@thomasfosterau/effect-ext/I8";
import { U8 } from "@thomasfosterau/effect-ext/U8";
import { U64 } from "@thomasfosterau/effect-ext/U64";

const a = U8.make(200); // U8 (throws OutOfRangeError if out of range)
const b = U8.make(100);

U8.add(a, b); // Result.fail(OverflowError) — strict
U8.checkedAdd(a, b); // Option.none()
U8.wrappingAdd(a, b); // 44
U8.saturatingAdd(a, b); // 255
U8.overflowingAdd(a, b); // [44, true]

pipe(a, U8.saturatingSub(b)); // 100 — every binary op is dual

U8.from(256); // Option.none() — Rust's TryFrom
U8.wrappingFrom(-1); // 255 — Rust's `as` between integers
U8.saturatingFrom(1e9); // 255 — Rust's `as` from a float

I8.checkedDiv(I8.MIN, I8.make(-1)); // Option.none()
I8.remEuclid(I8.make(-7), I8.make(3)); // Result.succeed(2)

U64.wrappingMul(U64.MAX, U64.MAX); // 1n
```

Strict operations return a `Result`, which lifts straight into an `Effect` with typed, tagged errors:

```ts
const program = Effect.gen(function* () {
  const total = yield* Effect.fromResult(U8.add(a, b));
  return total;
}).pipe(Effect.catchTag("OverflowError", (e) => Effect.succeed(U8.MAX)));
```

| Prefix        | On overflow / invalid input    | Returns                      |
| ------------- | ------------------------------ | ---------------------------- |
| _(none)_      | fails with a tagged error      | `Result<A, ArithmeticError>` |
| `checked`     | returns `None`                 | `Option<A>`                  |
| `wrapping`    | wraps modulo 2^bits            | `A`                          |
| `saturating`  | clamps to `MIN` / `MAX`        | `A`                          |
| `overflowing` | wraps and reports the overflow | `readonly [A, boolean]`      |

Each module also provides `pow`, shifts, `divEuclid` / `remEuclid`, `abs`, `signum`, `isqrt`, `ilog2` / `ilog10` / `ilog`, `midpoint`, `absDiff`, `isPowerOfTwo`, `checkedNextPowerOfTwo`, bit operations (`countOnes`, `leadingZeros`, `trailingZeros`, `rotateLeft`, `reverseBits`, `swapBytes`, …), byte conversions (`toBeBytes`, `fromLeBytes`, …), `parse` / `toString` in any radix, ranges, `Order`, `Equivalence`, and two schemas:

```ts
import { Schema } from "effect";

Schema.decodeSync(U8.schema)(42); // 42 as U8
Schema.decodeSync(U64.schemaFromString)("18446744073709551615"); // U64.MAX
```

Types of up to 32 bits are represented by `number`, wider types by `bigint`.

### Custom widths

```ts
import type { Brand } from "effect";
import * as FixedInt from "@thomasfosterau/effect-ext/FixedInt";

type U4 = number & Brand.Brand<"U4">;
const U4 = FixedInt.make<U4>({ name: "U4", bits: 4, signed: false });

type I256 = bigint & Brand.Brand<"I256">;
const I256 = FixedInt.makeBig<I256>({ name: "I256", bits: 256, signed: true });
```

## Wrapping, Saturating, Checked, Overflowing

Rust's `Wrapping<T>` and `Saturating<T>` change what `+` means for a type. Here they are type class instances you pick once and then use everywhere — including in generic algorithms:

```ts
import * as Checked from "@thomasfosterau/effect-ext/Checked";
import { I8 } from "@thomasfosterau/effect-ext/I8";
import { I64 } from "@thomasfosterau/effect-ext/I64";
import * as Integer from "@thomasfosterau/effect-ext/Integer";
import * as Num from "@thomasfosterau/effect-ext/Num";
import * as Overflowing from "@thomasfosterau/effect-ext/Overflowing";
import * as Saturating from "@thomasfosterau/effect-ext/Saturating";
import { U8 } from "@thomasfosterau/effect-ext/U8";
import * as Wrapping from "@thomasfosterau/effect-ext/Wrapping";

const W = Wrapping.U8; // Integral<U8> & Signed<U8> & Bounded<U8>
W.add(U8.make(250), U8.make(10)); // 4
Num.sum(Wrapping.U8)([U8.make(200), U8.make(100)]); // 44

Saturating.I8.mul(I8.make(-100), I8.make(2)); // -128
Checked.U8.sum([U8.make(100), U8.make(200)]); // Option.none()
Overflowing.U8.add(U8.MAX, U8.one); // [0, true]

Integer.gcd(Wrapping.I64)(I64.make(-12n), I64.make(18n)); // 6n
```

## Clamped types

```ts
import * as Clamped from "@thomasfosterau/effect-ext/Clamped";

const Volume = Clamped.int({ min: 0, max: 11 });
type Volume = Clamped.ValueOf<typeof Volume>; // ClampedInt<0, 11>

Volume.make(42); // 11 — clamps
Volume.from(42); // Option.none() — validates
Volume.add(Volume.make(10), 5); // 11 — saturating arithmetic

const Hue = Clamped.make({ min: 0, max: 360 });
Hue.wrap(370); // 10
Hue.rescale(Clamped.Percentage)(Hue.make(90)); // 25

Clamped.UnitInterval.make(1.5); // 1
```

Bounds are tracked in the type, so a `Clamped<0, 1>` can't be passed where a `Clamped<0, 100>` is expected. Each clamped type has a strict `schema` and a lenient `schemaClamping`.

## Floats

```ts
import { Array } from "effect";
import { F32 } from "@thomasfosterau/effect-ext/F32";
import * as Float from "@thomasfosterau/effect-ext/Float";

Array.sort([3, NaN, -0, 0, -1], Float.F64.Order); // [-1, -0, 0, 3, NaN] — IEEE totalOrder
Float.F64.roundTiesEven(2.5); // 2
Float.F64.nextUp(1); // 1.0000000000000002

F32.add(F32.from(0.1), F32.from(0.2)); // single precision arithmetic

Float.Finite.mul(Float.Finite(1e300), Float.Finite(1e300)); // Option.none()
Float.NotNaN.option(NaN); // Option.none()
```

## Ratio and Complex

```ts
import { Equal, pipe } from "effect";
import * as Complex from "@thomasfosterau/effect-ext/Complex";
import * as Ratio from "@thomasfosterau/effect-ext/Ratio";

const third = Ratio.make(1, 3);
pipe(third, Ratio.add(Ratio.make(1, 6)), Ratio.toString); // "1/2"
Equal.equals(Ratio.make(2, 4), Ratio.make(1, 2)); // true
Ratio.approximate(Math.PI, 1000n); // Option.some(355/113)
Ratio.fromNumber(0.1); // Option.some(3602879701896397/36028797018963968), the double's exact value
Ratio.toFixed(Ratio.make(2, 3), 4); // "0.6667"

const z = Complex.make(3, 4);
Complex.abs(z); // 5
Complex.toString(Complex.mul(z, Complex.i)); // "-4+3i"
```

## Type classes and generic code

| Type class                   | Rust equivalent                       |
| ---------------------------- | ------------------------------------- |
| `Zero`, `One`, `Bounded`     | `num_traits::{Zero, One, Bounded}`    |
| `Num`, `OrderedNum`          | `num_traits::Num`                     |
| `Signed`                     | `num_traits::Signed`                  |
| `Integral`                   | `num_integer::Integer`                |
| `Fractional`                 | field operations                      |
| `Float.Float`                | `num_traits::Float`                   |
| `Checked.CheckedOps`         | `CheckedAdd`, `CheckedMul`, …         |
| `Wrapping.WrappingOps`       | `WrappingAdd`, `WrappingMul`, …       |
| `Saturating.SaturatingOps`   | `SaturatingAdd`, `SaturatingMul`, …   |
| `Overflowing.OverflowingOps` | `OverflowingAdd`, `OverflowingMul`, … |

Instances: `Num.number`, `Num.bigint`, `Wrapping.*`, `Saturating.*`, `Float.F64`, `F32`, `Ratio.Field`, `Complex.Field`. Every `FixedInt` module implements the `*Ops` type classes directly.

```ts
import * as Integer from "@thomasfosterau/effect-ext/Integer";
import * as Num from "@thomasfosterau/effect-ext/Num";
import * as Range from "@thomasfosterau/effect-ext/Range";
import * as Ratio from "@thomasfosterau/effect-ext/Ratio";

const mean =
  <A>(N: Num.Fractional<A>, fromCount: (n: number) => A) =>
  (xs: ReadonlyArray<A>) =>
    N.div(Num.sum(N)(xs), fromCount(xs.length));

mean(Ratio.Field, Ratio.fromInteger)([Ratio.make(1), Ratio.make(2)]); // 3/2

Integer.extendedGcd(Num.bigint)(240n, 46n); // { gcd: 2n, x: -9n, y: 47n }
Integer.divFloor(Num.bigint)(-7n, 2n); // -4n
Integer.isPrime(2n ** 61n - 1n); // true
Integer.modPow(4n, 13n, 497n); // 445n

Array.from(Range.rangeStep(Num.bigint)(10n, 0n, -3n)); // [10n, 7n, 4n, 1n]
```

Type class instances are total: where an operation is undefined (integer division by zero), instances throw a `DivisionByZeroError`, mirroring a Rust panic. Use the `Result` / `Option` returning functions on the concrete modules to handle those cases as values.
