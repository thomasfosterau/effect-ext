import { describe, expect, it } from "vite-plus/test";
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { F32 } from "@thomasfosterau/effect-ext/F32";
import * as fc from "fast-check";
import * as Float from "@thomasfosterau/effect-ext/Float";

describe("Float.F64", () => {
  const F = Float.F64;
  it("total order", () => {
    const sorted = Arr.sort(
      [3, Number.NaN, 0, -0, -1, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY],
      F.Order,
    );
    expect(sorted.map((x) => (Object.is(x, -0) ? "-0" : String(x)))).toEqual([
      "-Infinity",
      "-1",
      "-0",
      "0",
      "3",
      "Infinity",
      "NaN",
    ]);
    expect(F.Equivalence(Number.NaN, Number.NaN)).toBe(true);
    expect(F.Equivalence(0, -0)).toBe(false);
  });
  it("rounding", () => {
    expect(F.round(2.5)).toBe(3);
    expect(F.round(-2.5)).toBe(-3);
    expect(F.roundTiesEven(2.5)).toBe(2);
    expect(F.roundTiesEven(3.5)).toBe(4);
    expect(F.roundTiesEven(-2.5)).toBe(-2);
    expect(F.roundTiesEven(2.4)).toBe(2);
    expect(F.fract(-1.25)).toBe(-0.25);
    expect(F.trunc(-1.7)).toBe(-1);
  });
  it("next representable values", () => {
    expect(F.nextUp(1)).toBe(1 + Number.EPSILON);
    expect(F.nextDown(1)).toBe(1 - Number.EPSILON / 2);
    expect(F.nextUp(0)).toBe(Number.MIN_VALUE);
    expect(F.nextUp(-Number.MIN_VALUE)).toBe(-0);
    expect(F.nextDown(0)).toBe(-Number.MIN_VALUE);
    expect(F.nextUp(Number.MAX_VALUE)).toBe(Number.POSITIVE_INFINITY);
    expect(F.nextUp(Number.NEGATIVE_INFINITY)).toBe(-Number.MAX_VALUE);
  });
  it("classification and sign", () => {
    expect(F.isSubnormal(Number.MIN_VALUE)).toBe(true);
    expect(F.isNormal(1)).toBe(true);
    expect(F.isNormal(0)).toBe(false);
    expect(F.isSignNegative(-0)).toBe(true);
    expect(F.signum(-0)).toBe(-1);
    expect(F.signum(0)).toBe(1);
    expect(F.copysign(3, -0)).toBe(-3);
    expect(F.min(Number.NaN, 1)).toBe(1);
    expect(F.max(2, Number.NaN)).toBe(2);
    expect(F.log(8, 2)).toBeCloseTo(3);
    expect(F.powi(2, 10)).toBe(1024);
    expect(F.toDegrees(Math.PI)).toBe(180);
  });
});

describe("F32", () => {
  it("rounds to single precision", () => {
    const x = F32.from(0.1);
    expect(x).toBe(Math.fround(0.1));
    expect(F32.add(x, x)).toBe(Math.fround(x + x));
    expect(F32.is(0.1)).toBe(false);
    expect(F32.is(0.5)).toBe(true);
    expect(F32.nextUp(F32.from(1))).toBe(1 + 2 ** -23);
    expect(F32.nextDown(F32.from(1))).toBe(1 - 2 ** -24);
    expect(F32.from(1e39)).toBe(Number.POSITIVE_INFINITY);
    expect(F32.maxFinite).toBe(3.4028234663852886e38);
    expect(Result.isFailure(Schema.decodeResult(F32.schema)(0.1))).toBe(true);
    expect(Schema.decodeResult(F32.schemaRounding)(0.1)).toEqual(Result.succeed(Math.fround(0.1)));
  });
});

describe("NotNaN / Finite", () => {
  it("refines", () => {
    expect(Float.NotNaN.option(Number.NaN)).toEqual(Option.none());
    expect(Float.NotNaN(1)).toBe(1);
    expect(() => Float.NotNaN(Number.NaN)).toThrow(/not NaN/);
    const inf = Float.NotNaN(Number.POSITIVE_INFINITY);
    expect(Float.NotNaN.sub(inf, inf)).toEqual(Option.none());
    expect(Float.Finite.mul(Float.Finite(1e300), Float.Finite(1e300))).toEqual(Option.none());
    expect(Float.Finite.add(Float.Finite(1), Float.Finite(2))).toEqual(Option.some(3));
    expect(Float.Finite.is(Number.POSITIVE_INFINITY)).toBe(false);
    expect(Result.isFailure(Schema.decodeResult(Float.Finite.schema)(Number.NaN))).toBe(true);
    expect(Schema.decodeResult(Float.Finite.schema)(1.5)).toEqual(Result.succeed(1.5));
  });
});

const everyOperation = <A extends number>(
  name: string,
  F: Float.Float<A>,
  round: (n: number) => number,
  minSubnormal: number,
) =>
  describe(`${name}: every operation`, () => {
    const nan = Number.NaN;
    const Inf = Number.POSITIVE_INFINITY;
    const finite = fc.double({ noNaN: true, noDefaultInfinity: true, min: -1e30, max: 1e30 });
    const any = fc.oneof(
      fc.double(),
      fc.constantFrom(0, -0, nan, Inf, -Inf, minSubnormal, -minSubnormal),
    );

    it("constants and predicates", () => {
      expect([F.zero, F.one, F.minValue, F.maxValue]).toEqual([0, 1, -Inf, Inf]);
      expect(Object.is(F.negZero, -0)).toBe(true);
      expect(F.isZero(F.negZero)).toBe(true);
      expect(F.isZero(F.minPositive)).toBe(false);
      expect(F.isOne(F.one)).toBe(true);
      expect(F.isOne(F.nextUp(F.one))).toBe(false);
      expect(F.isNaN(F.nan)).toBe(true);
      expect(F.isFinite(F.infinity)).toBe(false);
      expect(F.isFinite(F.maxFinite)).toBe(true);
      expect(F.isInfinite(F.infinity)).toBe(true);
      expect(F.isInfinite(F.negInfinity)).toBe(true);
      expect(F.isInfinite(F.maxFinite)).toBe(false);
      expect(F.isInfinite(F.nan)).toBe(false);
      // Rust: `f64::NAN.is_sign_positive()` depends on the NaN's sign bit; here NaN is neither.
      expect([
        F.isSignPositive(F.zero),
        F.isSignPositive(F.negZero),
        F.isSignPositive(F.from(-1)),
      ]).toEqual([true, false, false]);
      expect([
        F.isSignNegative(F.zero),
        F.isSignNegative(F.negZero),
        F.isSignNegative(F.from(-1)),
        F.isSignNegative(F.one),
      ]).toEqual([false, true, true, false]);
      expect(F.isSubnormal(F.from(minSubnormal))).toBe(true);
      expect(F.isNormal(F.minPositive)).toBe(true);
      expect(F.isSubnormal(F.zero)).toBe(false);
      expect(F.isNormal(F.infinity)).toBe(false);
      expect(F.epsilon).toBe(F.nextUp(F.one) - 1);
    });

    it("arithmetic rounds the exact double result to the type", () => {
      fc.assert(
        fc.property(any, any, (x0, y0) => {
          const x = F.from(x0);
          const y = F.from(y0);
          expect(F.add(x, y)).toBe(round(x + y));
          expect(F.sub(x, y)).toBe(round(x - y));
          expect(F.mul(x, y)).toBe(round(x * y));
          expect(F.div(x, y)).toBe(round(x / y));
          expect(F.sub(y)(x)).toBe(round(x - y));
          expect(F.recip(x)).toBe(round(1 / x));
          expect(F.negate(x)).toBe(-x);
          expect(F.abs(x)).toBe(Math.abs(x));
          expect(F.hypot(x, y)).toBe(round(Math.hypot(x, y)));
          expect(F.atan2(x, y)).toBe(round(Math.atan2(x, y)));
          expect(F.powf(x, y)).toBe(round(x ** y));
          expect(F.log(x, y)).toBe(round(Math.log(x) / Math.log(y)));
          expect(F.mulAdd(x, y, F.one)).toBe(round(x * y + 1));
        }),
        { numRuns: 300 },
      );
      // IEEE 754 specials.
      expect(F.div(F.one, F.zero)).toBe(Inf);
      expect(F.div(F.one, F.negZero)).toBe(-Inf);
      expect(F.recip(F.negZero)).toBe(-Inf);
      expect(F.isNaN(F.div(F.zero, F.zero))).toBe(true);
      expect(F.isNaN(F.mul(F.infinity, F.zero))).toBe(true);
      expect(F.hypot(F.infinity, F.nan)).toBe(Inf);
      expect(F.abs(F.negZero)).toBe(0);
      expect(Object.is(F.abs(F.negZero), 0)).toBe(true);
    });

    it("unary functions agree with Math, rounded", () => {
      fc.assert(
        fc.property(any, (x0) => {
          const x = F.from(x0);
          expect(F.floor(x)).toBe(round(Math.floor(x)));
          expect(F.ceil(x)).toBe(round(Math.ceil(x)));
          expect(F.trunc(x)).toBe(round(Math.trunc(x)));
          expect(F.sqrt(x)).toBe(round(Math.sqrt(x)));
          expect(F.cbrt(x)).toBe(round(Math.cbrt(x)));
          expect(F.exp(x)).toBe(round(Math.exp(x)));
          expect(F.exp2(x)).toBe(round(2 ** x));
          expect(F.expm1(x)).toBe(round(Math.expm1(x)));
          expect(F.ln(x)).toBe(round(Math.log(x)));
          expect(F.ln1p(x)).toBe(round(Math.log1p(x)));
          expect(F.log2(x)).toBe(round(Math.log2(x)));
          expect(F.log10(x)).toBe(round(Math.log10(x)));
          expect(F.sin(x)).toBe(round(Math.sin(x)));
          expect(F.cos(x)).toBe(round(Math.cos(x)));
          expect(F.tan(x)).toBe(round(Math.tan(x)));
          expect(F.asin(x)).toBe(round(Math.asin(x)));
          expect(F.acos(x)).toBe(round(Math.acos(x)));
          expect(F.atan(x)).toBe(round(Math.atan(x)));
          expect(F.sinh(x)).toBe(round(Math.sinh(x)));
          expect(F.cosh(x)).toBe(round(Math.cosh(x)));
          expect(F.tanh(x)).toBe(round(Math.tanh(x)));
          expect(F.asinh(x)).toBe(round(Math.asinh(x)));
          expect(F.acosh(x)).toBe(round(Math.acosh(x)));
          expect(F.atanh(x)).toBe(round(Math.atanh(x)));
          expect(F.toRadians(x)).toBe(round((x * Math.PI) / 180));
          expect(F.toDegrees(x)).toBe(round((x * 180) / Math.PI));
        }),
        { numRuns: 200 },
      );
      expect(F.exp2(F.from(10))).toBe(1024);
      expect(F.toRadians(F.from(180))).toBe(round(Math.PI));
      expect(F.sqrt(F.from(-1))).toBeNaN();
      expect(F.ln(F.zero)).toBe(-Inf);
    });

    it("signum and copysign (Rust semantics)", () => {
      // Rust: `f64::NAN.signum()` is NaN; `0.0.signum() == 1.0`; `(-0.0).signum() == -1.0`.
      expect(F.signum(F.nan)).toBeNaN();
      expect([
        F.signum(F.zero),
        F.signum(F.negZero),
        F.signum(F.from(-3)),
        F.signum(F.infinity),
      ]).toEqual([1, -1, -1, 1]);
      expect(F.copysign(F.from(3), F.one)).toBe(3);
      expect(F.copysign(F.from(-3), F.zero)).toBe(3);
      expect(F.copysign(F.from(3), F.negInfinity)).toBe(-3);
      expect(Object.is(F.copysign(F.zero, F.negZero), -0)).toBe(true);
      expect(F.powi(F.from(2), -2)).toBe(0.25);
      expect(F.powi(F.from(2), 3.9)).toBe(8);
    });

    it("min / max ignore NaN (IEEE minNum / maxNum); clamp keeps NaN", () => {
      fc.assert(
        fc.property(finite, finite, (x0, y0) => {
          const x = F.from(x0);
          const y = F.from(y0);
          expect(F.min(x, y)).toBe(Math.min(x, y) === 0 ? (x <= y ? x : y) : Math.min(x, y));
          expect(F.max(x, y)).toBe(Math.max(x, y) === 0 ? (x >= y ? x : y) : Math.max(x, y));
          expect(F.min(F.nan, x)).toBe(x);
          expect(F.min(x, F.nan)).toBe(x);
          expect(F.max(F.nan, x)).toBe(x);
          expect(F.max(x, F.nan)).toBe(x);
          const [lo, hi] = x <= y ? [x, y] : [y, x];
          const c = F.clamp(F.from(0.5), lo, hi);
          expect(c).toBe(0.5 < lo ? lo : 0.5 > hi ? hi : 0.5);
        }),
        { numRuns: 300 },
      );
      expect(F.min(F.from(1), F.from(2))).toBe(1);
      expect(F.min(F.from(2), F.from(1))).toBe(1);
      expect(F.max(F.from(1), F.from(2))).toBe(2);
      expect(F.max(F.from(2), F.from(1))).toBe(2);
      expect(F.min(F.nan, F.nan)).toBeNaN();
      expect(F.clamp(F.from(-5), F.from(-1), F.from(1))).toBe(-1);
      expect(F.clamp(F.from(5), F.from(-1), F.from(1))).toBe(1);
      expect(F.clamp(F.from(0.5), F.from(-1), F.from(1))).toBe(0.5);
      expect(F.clamp(F.nan, F.from(-1), F.from(1))).toBeNaN();
    });

    it("nextUp / nextDown step one ulp, through zero and the subnormals", () => {
      expect(F.nextUp(F.zero)).toBe(minSubnormal);
      expect(F.nextUp(F.negZero)).toBe(minSubnormal);
      expect(F.nextDown(F.zero)).toBe(-minSubnormal);
      expect(F.nextUp(F.infinity)).toBe(Inf);
      expect(F.nextUp(F.nan)).toBeNaN();
      expect(F.nextDown(F.negInfinity)).toBe(-Inf);
      expect(F.nextUp(F.maxFinite)).toBe(Inf);
      expect(F.nextDown(F.infinity)).toBe(F.maxFinite);
      fc.assert(
        fc.property(finite, (x0) => {
          const x = F.from(x0);
          const up = F.nextUp(x);
          expect(up > x).toBe(true);
          expect(F.nextDown(up)).toBe(x === 0 ? 0 : x);
          // Nothing representable lies strictly between.
          expect(round((x + up) / 2) === x || round((x + up) / 2) === up).toBe(true);
        }),
        { numRuns: 300 },
      );
    });

    it("total order sorts -0 before +0 and NaN last", () => {
      expect(F.Order(F.negZero, F.zero)).toBe(-1);
      expect(F.Order(F.zero, F.negZero)).toBe(1);
      expect(F.Order(F.zero, F.zero)).toBe(0);
      expect(F.Order(F.nan, F.infinity)).toBe(1);
      expect(F.Order(F.infinity, F.nan)).toBe(-1);
      expect(F.Order(F.nan, F.nan)).toBe(0);
      expect(F.Order(F.from(1), F.from(2))).toBe(-1);
      expect(F.Order(F.from(2), F.from(1))).toBe(1);
      expect(F.Equivalence(F.one, F.one)).toBe(true);
    });
  });

everyOperation("F64", Float.F64, (n) => n, 2 ** -1074);
everyOperation("F32", F32, Math.fround, 2 ** -149);

describe("Float.totalOrder", () => {
  it("is the IEEE 754 totalOrder on numbers", () => {
    expect(Float.totalOrder(-0, -0)).toBe(0);
    expect(Float.totalOrder(-0, 0)).toBe(-1);
    expect(Float.totalOrder(Number.NaN, 1)).toBe(1);
    expect(Float.totalOrder(1, Number.NaN)).toBe(-1);
    expect(Float.totalOrder(Number.NEGATIVE_INFINITY, -Number.MAX_VALUE)).toBe(-1);
  });
});

describe("NotNaN / Finite: remaining operations", () => {
  it("div, map, result and is", () => {
    const { Finite, NotNaN } = Float;
    expect(Finite.div(Finite(1), Finite(4))).toEqual(Option.some(0.25));
    // Division by zero leaves `Finite` but not `NotNaN` (unless it is 0/0).
    expect(Finite.div(Finite(1), Finite(0))).toEqual(Option.none());
    expect(NotNaN.div(NotNaN(1), NotNaN(0))).toEqual(Option.some(Number.POSITIVE_INFINITY));
    expect(NotNaN.div(NotNaN(0), NotNaN(0))).toEqual(Option.none());
    expect(Finite.sub(Finite(5), Finite(2))).toEqual(Option.some(3));
    expect(NotNaN.add(NotNaN(Number.POSITIVE_INFINITY), NotNaN(Number.NEGATIVE_INFINITY))).toEqual(
      Option.none(),
    );
    expect(NotNaN.mul(NotNaN(2), NotNaN(3))).toEqual(Option.some(6));
    expect(Finite.map(Finite(4), Math.sqrt)).toEqual(Option.some(2));
    expect(Finite.map(Finite(-1), Math.sqrt)).toEqual(Option.none());
    expect(Finite.map(Math.exp)(Finite(1000))).toEqual(Option.none());
    expect(NotNaN.map(NotNaN(-1), Math.log)).toEqual(Option.none());
    expect(NotNaN.map(NotNaN(0), Math.log)).toEqual(Option.some(Number.NEGATIVE_INFINITY));
    expect(Result.isSuccess(Finite.result(1))).toBe(true);
    expect(Result.isFailure(Finite.result(Number.NEGATIVE_INFINITY))).toBe(true);
    expect(Result.isFailure(NotNaN.result(Number.NaN))).toBe(true);
    expect(NotNaN.is(Number.POSITIVE_INFINITY)).toBe(true);
    expect(NotNaN.is(Number.NaN)).toBe(false);
    expect(Finite.is(-0)).toBe(true);
    expect(Finite.option(Number.NaN)).toEqual(Option.none());
    expect(Arr.sort([Finite(3), Finite(-1), Finite(2)], Finite.Order)).toEqual([-1, 2, 3]);
    expect(Result.isFailure(Schema.decodeResult(NotNaN.schema)(Number.NaN))).toBe(true);
    expect(Schema.decodeResult(NotNaN.schema)(Number.POSITIVE_INFINITY)).toEqual(
      Result.succeed(Number.POSITIVE_INFINITY),
    );
  });
});

describe("F32 schemas", () => {
  it("schemaRounding encodes the f32 unchanged", () => {
    const x = F32.from(0.1);
    expect(Schema.encodeSync(F32.schemaRounding)(x)).toBe(Math.fround(0.1));
    expect(Schema.encodeSync(F32.schema)(x)).toBe(Math.fround(0.1));
    expect(F32.is(Number.NaN)).toBe(true);
    expect(F32.is("0.5")).toBe(false);
    expect(Schema.decodeResult(F32.schemaRounding)(1e39)).toEqual(
      Result.succeed(Number.POSITIVE_INFINITY),
    );
  });
});
