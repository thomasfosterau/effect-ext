import { describe, expect, it } from "vite-plus/test";
import * as Eq from "effect/Equal";
import * as Hash from "effect/Hash";
import * as Schema from "effect/Schema";
import * as fc from "fast-check";
import * as Complex from "@thomasfosterau/effect-utilities/Complex";
import * as Num from "@thomasfosterau/effect-utilities/Num";

const close = Complex.approxEquals(1e-9);

describe("Complex", () => {
  const z = Complex.make(3, 4);
  it("basic arithmetic", () => {
    expect(Complex.abs(z)).toBe(5);
    expect(Complex.toString(Complex.mul(z, Complex.i))).toBe("-4+3i");
    expect(Complex.toString(Complex.conj(z))).toBe("3-4i");
    expect(close(Complex.mul(Complex.div(z, Complex.make(1, -2)), Complex.make(1, -2)), z)).toBe(
      true,
    );
    expect(close(Complex.mul(z, Complex.recip(z)), Complex.one)).toBe(true);
    expect(Complex.normSqr(z)).toBe(25);
    expect(Eq.equals(Complex.make(1, 2), Complex.make(1, 2))).toBe(true);
    expect(Num.sum(Complex.Field)([z, z])).toEqual(Complex.make(6, 8));
  });
  it("transcendental functions", () => {
    expect(close(Complex.exp(Complex.make(0, Math.PI)), Complex.make(-1, 0))).toBe(true);
    expect(close(Complex.exp(Complex.ln(z)), z)).toBe(true);
    expect(close(Complex.mul(Complex.sqrt(z), Complex.sqrt(z)), z)).toBe(true);
    expect(Complex.sqrt(Complex.make(-4))).toEqual(Complex.make(0, 2));
    expect(close(Complex.powi(z, 3), Complex.mul(z, Complex.mul(z, z)))).toBe(true);
    expect(close(Complex.powi(z, -1), Complex.recip(z))).toBe(true);
    expect(close(Complex.powf(z, 0.5), Complex.sqrt(z))).toBe(true);
    expect(close(Complex.powc(Complex.i, Complex.i), Complex.make(Math.exp(-Math.PI / 2)))).toBe(
      true,
    );
    const s = Complex.sin(z);
    const c = Complex.cos(z);
    expect(close(Complex.add(Complex.mul(s, s), Complex.mul(c, c)), Complex.one)).toBe(true);
    expect(close(Complex.tanh(Complex.zero), Complex.zero)).toBe(true);
    const [r, t] = Complex.toPolar(z);
    expect(close(Complex.fromPolar(r, t), z)).toBe(true);
  });
  it("schemas", () => {
    const decoded = Schema.decodeSync(Complex.schemaFromStruct)({ re: 1, im: -1 });
    expect(Complex.toString(decoded)).toBe("1-1i");
    expect(Schema.encodeSync(Complex.schemaFromStruct)(z)).toEqual({ re: 3, im: 4 });
  });
});

const arbPart = fc.double({ noNaN: true, noDefaultInfinity: true, min: -1e6, max: 1e6 });
const arbComplex = fc.tuple(arbPart, arbPart).map(([re, im]) => Complex.make(re, im));
const relClose = (a: Complex.Complex, b: Complex.Complex) =>
  Complex.abs(Complex.sub(a, b)) <= 1e-9 * Math.max(1, Complex.abs(a), Complex.abs(b));

describe("Complex: remaining operations", () => {
  it("negate, conj, scale and division agree with the field laws", () => {
    fc.assert(
      fc.property(arbComplex, arbComplex, (a, b) => {
        expect(Complex.negate(a)).toEqual(Complex.make(-a.re, -a.im));
        expect(relClose(Complex.add(a, Complex.negate(a)), Complex.zero)).toBe(true);
        expect(Complex.scale(a, 2)).toEqual(Complex.make(a.re * 2, a.im * 2));
        expect(Complex.scale(3)(a)).toEqual(Complex.make(a.re * 3, a.im * 3));
        // a * conj(a) = |a|^2 (real)
        const n = Complex.mul(a, Complex.conj(a));
        expect(Math.abs(n.re - Complex.normSqr(a))).toBeLessThanOrEqual(1e-9 * Math.max(1, n.re));
        // (a / b) * b = a whenever b != 0 (both branches of Smith's algorithm)
        fc.pre(Complex.abs(b) > 1e-3);
        expect(relClose(Complex.mul(Complex.div(a, b), b), a)).toBe(true);
      }),
      { numRuns: 300 },
    );
    // Smith's algorithm, |re| >= |im| with a non-zero imaginary part.
    expect(close(Complex.div(Complex.make(5, 5), Complex.make(2, 1)), Complex.make(3, 1))).toBe(
      true,
    );
    // ... and |re| < |im|.
    expect(close(Complex.div(Complex.make(5, 5), Complex.make(1, 2)), Complex.make(3, -1))).toBe(
      true,
    );
    // Division by a real.
    expect(Complex.div(Complex.make(4, -6), Complex.make(2))).toEqual(Complex.make(2, -3));
    // Division by zero yields non-finite parts, as IEEE floats do.
    expect(Complex.isFinite(Complex.div(Complex.one, Complex.zero))).toBe(false);
  });

  it("principal square root on every branch", () => {
    expect(Complex.sqrt(Complex.make(9))).toEqual(Complex.make(3, 0));
    expect(Object.is(Complex.sqrt(Complex.make(4, -0)).im, -0)).toBe(true);
    expect(Complex.sqrt(Complex.make(-4, -0))).toEqual(Complex.make(0, -2));
    expect(Complex.sqrt(Complex.make(-4, 0))).toEqual(Complex.make(0, 2));
    // num-complex: sqrt(-2i) = 1 - i, sqrt(2i) = 1 + i.
    expect(close(Complex.sqrt(Complex.make(0, -2)), Complex.make(1, -1))).toBe(true);
    expect(close(Complex.sqrt(Complex.make(0, 2)), Complex.make(1, 1))).toBe(true);
    // Well-conditioned inputs only (parts on a 1/16 grid): when |im| is tiny next to |re|,
    // `sqrt` loses the small part to cancellation (sqrt(1 + 1e-10i) gives 1+0i).
    const grid = fc.integer({ min: -1000, max: 1000 }).map((n) => n / 16);
    fc.assert(
      fc.property(fc.tuple(grid, grid), ([re, im]) => {
        const a = Complex.make(re, im);
        const r = Complex.sqrt(a);
        expect(r.re).toBeGreaterThanOrEqual(0);
        expect(relClose(Complex.mul(r, r), a)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it("powers: zero bases, real and complex exponents, bad exponents", () => {
    // Rust num-complex: `0^0 = 1`, `0^x = 0` otherwise.
    expect(Complex.powf(Complex.zero, 0)).toBe(Complex.one);
    expect(Complex.powf(Complex.zero, 2.5)).toBe(Complex.zero);
    expect(Complex.powf(Complex.make(0, 1), 0)).toEqual(Complex.make(1, 0));
    expect(close(Complex.powf(Complex.make(0, 1), 2), Complex.make(-1, 0))).toBe(true);
    expect(close(Complex.powf(Complex.make(-8), 1 / 3), Complex.make(1, Math.sqrt(3)))).toBe(true);
    expect(Complex.powc(Complex.zero, Complex.zero)).toBe(Complex.one);
    expect(Complex.powc(Complex.zero, Complex.i)).toBe(Complex.zero);
    expect(Complex.powc(Complex.zero, Complex.one)).toBe(Complex.zero);
    expect(close(Complex.powc(Complex.make(2), Complex.make(3)), Complex.make(8))).toBe(true);
    expect(close(Complex.powc(Complex.i, Complex.zero), Complex.one)).toBe(true);
    expect(Complex.powi(Complex.i, 0)).toEqual(Complex.one);
    expect(close(Complex.powi(Complex.i, 4), Complex.one)).toBe(true);
    expect(() => Complex.powi(Complex.i, 1.5)).toThrow(RangeError);
    expect(() => Complex.powi(Complex.i, Number.POSITIVE_INFINITY)).toThrow(/safe integer/);
  });

  it("tan, tanh, sinh and cosh satisfy their identities", () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.double({ min: -3, max: 3, noNaN: true }),
          fc.double({ min: -3, max: 3, noNaN: true }),
        ),
        ([re, im]) => {
          const z = Complex.make(re, im);
          const c = Complex.cos(z);
          fc.pre(Complex.abs(c) > 1e-3);
          expect(relClose(Complex.mul(Complex.tan(z), c), Complex.sin(z))).toBe(true);
          // cosh² − sinh² = 1
          const ch = Complex.cosh(z);
          const sh = Complex.sinh(z);
          expect(relClose(Complex.sub(Complex.mul(ch, ch), Complex.mul(sh, sh)), Complex.one)).toBe(
            true,
          );
          fc.pre(Complex.abs(ch) > 1e-3);
          expect(relClose(Complex.mul(Complex.tanh(z), ch), sh)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
    expect(close(Complex.tan(Complex.make(Math.PI / 4)), Complex.one)).toBe(true);
    // tan(i) = i·tanh(1)
    expect(close(Complex.tan(Complex.i), Complex.make(0, Math.tanh(1)))).toBe(true);
  });

  it("predicates", () => {
    expect(Complex.isNaN(Complex.make(Number.NaN, 0))).toBe(true);
    expect(Complex.isNaN(Complex.make(0, Number.NaN))).toBe(true);
    expect(Complex.isNaN(Complex.make(1, 2))).toBe(false);
    expect(Complex.isFinite(Complex.make(1, 2))).toBe(true);
    expect(Complex.isFinite(Complex.make(Number.POSITIVE_INFINITY, 0))).toBe(false);
    expect(Complex.isFinite(Complex.make(0, Number.NEGATIVE_INFINITY))).toBe(false);
    expect(Complex.isFinite(Complex.make(0, Number.NaN))).toBe(false);
    expect(Complex.isReal(Complex.make(3))).toBe(true);
    expect(Complex.isReal(Complex.make(3, -0))).toBe(true);
    expect(Complex.isReal(Complex.i)).toBe(false);
    expect(Complex.isComplex(Complex.i)).toBe(true);
    expect(Complex.isComplex({ re: 0, im: 1 })).toBe(false);
  });

  it("Equivalence is ===-based; Equal is Object.is-based", () => {
    expect(Complex.Equivalence(Complex.make(1, 2), Complex.make(1, 2))).toBe(true);
    expect(Complex.Equivalence(Complex.make(0, 0), Complex.make(-0, -0))).toBe(true);
    expect(Complex.Equivalence(Complex.make(1, 2), Complex.make(1, 3))).toBe(false);
    expect(Complex.Equivalence(Complex.make(2, 2), Complex.make(1, 2))).toBe(false);
    const nan = Complex.make(Number.NaN, 0);
    expect(Complex.Equivalence(nan, nan)).toBe(false);
    expect(Eq.equals(nan, Complex.make(Number.NaN, 0))).toBe(true);
    expect(Eq.equals(Complex.make(0, 0), Complex.make(-0, 0))).toBe(false);
    expect(Hash.hash(Complex.make(1, 2))).toBe(Hash.hash(Complex.make(1, 2)));
    // The default tolerance is 1e-12.
    const eq = Complex.approxEquals();
    expect(eq(Complex.one, Complex.make(1 + 1e-13))).toBe(true);
    expect(eq(Complex.one, Complex.make(1 + 1e-11))).toBe(false);
  });

  it("toString signs the imaginary part, -0 included", () => {
    expect(Complex.toString(Complex.make(1, -0))).toBe("1-0i");
    expect(Complex.toString(Complex.make(-1.5, 0))).toBe("-1.5+0i");
    expect(String(Complex.make(0, -2))).toBe("0-2i");
  });

  it("the Field instance", () => {
    const F = Complex.Field;
    expect(F.isZero(Complex.zero)).toBe(true);
    expect(F.isZero(Complex.make(-0, -0))).toBe(true);
    expect(F.isZero(Complex.make(0, 1))).toBe(false);
    expect(F.isZero(Complex.make(1, 0))).toBe(false);
    expect(F.isOne(Complex.make(1, 0))).toBe(true);
    expect(F.isOne(Complex.make(1, 1))).toBe(false);
    expect(F.isOne(Complex.make(2, 0))).toBe(false);
    expect(F.isOne(Complex.i)).toBe(false);
    expect(F.Equivalence(F.one, Complex.one)).toBe(true);
    expect(close(F.div(Complex.make(2, 2), Complex.make(1, 1)), Complex.make(2))).toBe(true);
    expect(close(F.recip(Complex.i), Complex.make(0, -1))).toBe(true);
    expect(F.sub(Complex.i, Complex.i)).toEqual(Complex.zero);
    expect(Num.product(F)([Complex.i, Complex.i])).toEqual(Complex.make(-1, 0));
  });

  it("schema accepts only Complex values", () => {
    expect(Schema.is(Complex.schema)(Complex.i)).toBe(true);
    expect(Schema.is(Complex.schema)({ re: 0, im: 1 })).toBe(false);
  });
});
