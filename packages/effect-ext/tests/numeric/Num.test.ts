import { describe, expect, it } from "vite-plus/test";
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as fc from "fast-check";
import * as Integer from "@thomasfosterau/effect-ext/Integer";
import * as Num from "@thomasfosterau/effect-ext/Num";
import * as Ratio from "@thomasfosterau/effect-ext/Ratio";
import { U8 } from "@thomasfosterau/effect-ext/U8";
import { U64 } from "@thomasfosterau/effect-ext/U64";

/** Trial division up to the square root, as an obviously correct reference for `isPrime`. */
const isPrimeReference = (n: number) =>
  n >= 2 &&
  Arr.every(Arr.range(2, Math.max(2, Math.floor(Math.sqrt(n)))), (d) => d * d > n || n % d !== 0);

describe("Num", () => {
  it("generic folds", () => {
    expect(Num.sum(Num.number)([1, 2, 3])).toBe(6);
    expect(Num.product(Num.bigint)([2n, 3n, 4n])).toBe(24n);
    expect(Num.pow(Num.bigint)(3n, 40)).toBe(3n ** 40n);
    expect(Num.pow(Num.bigint)(0)(3n)).toBe(1n);
    expect(() => Num.pow(Num.number)(2, -1)).toThrow(RangeError);
    expect(Num.square(Num.number)(5)).toBe(25);
    expect(Num.mulAdd(Num.number)(2, 3, 4)).toBe(10);
    expect(Num.isPositive(Num.bigint)(1n)).toBe(true);
    expect(Num.isNegative(Num.number)(-1)).toBe(true);
    expect(Num.clamp(Num.number.Order, 0, 10)(11)).toBe(10);
    expect(Ratio.toString(Num.sum(Ratio.Field)([Ratio.make(1, 2), Ratio.make(1, 3)]))).toBe("5/6");
  });
  it("instances", () => {
    expect(Num.number.signum(-3)).toBe(-1);
    expect(Num.number.div(1, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(Num.bigint.signum(-3n)).toBe(-1n);
    expect(() => Num.bigint.div(1n, 0n)).toThrow(/divide by zero/);
    expect(() => Num.bigint.rem(1n, 0n)).toThrow(/by zero/);
  });
});

describe("Integer", () => {
  const I = Num.bigint;
  it("gcd / lcm", () => {
    expect(Integer.gcd(I)(12n, -18n)).toBe(6n);
    expect(Integer.gcd(I)(0n, 0n)).toBe(0n);
    expect(Integer.lcm(I)(4n, -6n)).toBe(12n);
    expect(Integer.lcm(I)(0n, 6n)).toBe(0n);
  });
  it.each([
    [240n, 46n],
    [-7n, 3n],
    [0n, 5n],
    [17n, -51n],
  ] as const)("extendedGcd(%s, %s) gives Bézout coefficients", (a, b) => {
    const { gcd, x, y } = Integer.extendedGcd(I)(a, b);
    expect(a * x + b * y).toBe(gcd);
    expect(gcd).toBe(Integer.gcd(I)(a, b));
  });
  it("floored / ceiled division", () => {
    expect(Integer.divFloor(I)(-7n, 2n)).toBe(-4n);
    expect(Integer.modFloor(I)(-7n, 2n)).toBe(1n);
    expect(Integer.modFloor(I)(7n, -2n)).toBe(-1n);
    expect(Integer.divCeil(I)(7n, 2n)).toBe(4n);
    expect(Integer.divCeil(I)(-7n, 2n)).toBe(-3n);
    expect(Integer.divRem(I)(-7n, 2n)).toEqual([-3n, -1n]);
    expect(Integer.nextMultipleOf(I)(10n, 4n)).toBe(12n);
    expect(Integer.nextMultipleOf(I)(12n, 4n)).toBe(12n);
    expect(Integer.prevMultipleOf(I)(10n, 4n)).toBe(8n);
    expect(Integer.isEven(I)(4n)).toBe(true);
    expect(Integer.isOdd(I)(-3n)).toBe(true);
    expect(Integer.isMultipleOf(I)(0n, 0n)).toBe(true);
    expect(Integer.isMultipleOf(I)(9n, 3n)).toBe(true);
  });
  it("roots", () => {
    expect(Integer.sqrt(10n ** 40n + 1n)).toEqual(Option.some(10n ** 20n));
    expect(Integer.sqrt(-1n)).toEqual(Option.none());
    expect(Integer.cbrt(-28n)).toBe(-3n);
    expect(Integer.nthRoot(2n ** 100n, 10)).toEqual(Option.some(1024n));
    expect(Integer.nthRoot(2n ** 100n - 1n, 10)).toEqual(Option.some(1023n));
    expect(Integer.nthRoot(-16n, 4)).toEqual(Option.none());
    expect(Integer.nthRoot(-27n, 3)).toEqual(Option.some(-3n));
  });
  it("combinatorics and modular arithmetic", () => {
    expect(Integer.factorial(20n)).toEqual(Option.some(2432902008176640000n));
    expect(Integer.factorial(-1n)).toEqual(Option.none());
    expect(Integer.binomial(50n, 25n)).toBe(126410606437752n);
    expect(Integer.binomial(5n, 6n)).toBe(0n);
    expect(Integer.modPow(4n, 13n, 497n)).toBe(445n);
    expect(Integer.modPow(-2n, 3n, 5n)).toBe(2n);
    expect(Integer.modInverse(3n, 11n)).toEqual(Option.some(4n));
    expect(Integer.modInverse(2n, 4n)).toEqual(Option.none());
  });
  it("isPrime", () => {
    const upTo5000 = Arr.makeBy(5001, (i) => i);
    expect(Arr.map(upTo5000, (i) => Integer.isPrime(BigInt(i)))).toEqual(
      Arr.map(upTo5000, isPrimeReference),
    );
    expect(Integer.isPrime(2n ** 61n - 1n)).toBe(true);
    expect(Integer.isPrime(2n ** 61n + 1n)).toBe(false);
    expect(Integer.isPrime(3215031751n)).toBe(false); // strong pseudoprime to bases 2, 3, 5, 7
  });
});

describe("Num instances: every member", () => {
  it("number", () => {
    const N = Num.number;
    expect([N.zero, N.one, N.minValue, N.maxValue]).toEqual([0, 1, -Infinity, Infinity]);
    expect([N.isZero(0), N.isZero(-0), N.isZero(1)]).toEqual([true, true, false]);
    expect([N.isOne(1), N.isOne(0)]).toEqual([true, false]);
    expect(N.add(1, 2)).toBe(3);
    expect(N.sub(1, 3)).toBe(-2);
    expect(N.sub(3)(1)).toBe(-2);
    expect(N.mul(2, 3)).toBe(6);
    expect(N.recip(4)).toBe(0.25);
    expect(N.recip(-0)).toBe(-Infinity);
    expect(N.negate(2)).toBe(-2);
    expect(Object.is(N.negate(0), -0)).toBe(true);
    expect(N.abs(-2)).toBe(2);
    expect(N.Equivalence(1, 1)).toBe(true);
    expect(N.Order(1, 2)).toBe(-1);
    // Rust's f64::signum: NaN -> NaN; here ±0 keeps its sign (num-traits `Signed::signum`).
    expect(N.signum(Number.NaN)).toBeNaN();
    expect([N.signum(5), N.signum(-5), N.signum(Infinity)]).toEqual([1, -1, 1]);
    expect(Object.is(N.signum(0), 0)).toBe(true);
    expect(Object.is(N.signum(-0), -0)).toBe(true);
  });
  it("bigint", () => {
    const Z = Num.bigint;
    expect([Z.isZero(0n), Z.isZero(1n)]).toEqual([true, false]);
    expect([Z.isOne(1n), Z.isOne(-1n), Z.isOne(0n)]).toEqual([true, false, false]);
    expect(Z.sub(5n, 7n)).toBe(-2n);
    expect(Z.mul(-3n, 4n)).toBe(-12n);
    expect(Z.div(-7n, 2n)).toBe(-3n);
    expect(Z.rem(-7n, 2n)).toBe(-1n);
    expect(Z.negate(5n)).toBe(-5n);
    expect(Z.negate(-5n)).toBe(5n);
    expect([Z.abs(-5n), Z.abs(5n), Z.abs(0n)]).toEqual([5n, 5n, 0n]);
    expect([Z.signum(7n), Z.signum(-7n), Z.signum(0n)]).toEqual([1n, -1n, 0n]);
    fc.assert(
      fc.property(fc.bigInt(), (n) => {
        expect(Z.mul(Z.signum(n), Z.abs(n))).toBe(n);
        expect(Z.add(n, Z.negate(n))).toBe(0n);
      }),
    );
  });
});

/** Floor of the k-th root of n >= 0 by bisection, an obviously correct reference. */
const rootRef = (n: bigint, k: bigint): bigint => {
  const go = (lo: bigint, hi: bigint): bigint => {
    if (lo >= hi) return lo;
    const mid = (lo + hi + 1n) / 2n;
    return mid ** k <= n ? go(mid, hi) : go(lo, mid - 1n);
  };
  return go(0n, n);
};

describe("Integer: remaining branches", () => {
  it("roots agree with a bisection reference", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 30n }),
        fc.integer({ min: 1, max: 7 }),
        (n, k) => {
          expect(Integer.nthRoot(n, k)).toEqual(Option.some(rootRef(n, BigInt(k))));
          expect(Integer.nthRoot(-n, 3)).toEqual(Option.some(-rootRef(n, 3n)));
          expect(Integer.cbrt(n)).toBe(rootRef(n, 3n));
          expect(Integer.cbrt(-n)).toBe(-rootRef(n, 3n) + 0n);
        },
      ),
      { numRuns: 200 },
    );
    expect(Integer.nthRoot(0n, 5)).toEqual(Option.some(0n));
    expect(Integer.nthRoot(1n, 5)).toEqual(Option.some(1n));
    expect(Integer.nthRoot(99n, 1)).toEqual(Option.some(99n));
    expect(Integer.nthRoot(99n, 2)).toEqual(Option.some(9n));
    expect(Integer.nthRoot(8n, 0)).toEqual(Option.none());
    expect(Integer.nthRoot(8n, -3)).toEqual(Option.none());
    expect(Integer.nthRoot(8n, 1.5)).toEqual(Option.none());
    expect(Integer.cbrt(27n)).toBe(3n);
  });
  it("binomial is symmetric", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 60n }), fc.bigInt({ min: 0n, max: 60n }), (n, k) => {
        expect(Integer.binomial(n, k)).toBe(Integer.binomial(n, n - k));
      }),
    );
    // C(10, 7) = C(10, 3) = 120
    expect(Integer.binomial(10n, 7n)).toBe(120n);
    expect(Integer.binomial(10n, -1n)).toBe(0n);
    expect(Integer.binomial(-3n, 1n)).toBe(0n);
  });
  it("modPow and modInverse edge cases", () => {
    expect(() => Integer.modPow(2n, 3n, 0n)).toThrow(/modPow by zero/);
    expect(() => Integer.modPow(2n, -1n, 5n)).toThrow(RangeError);
    expect(Integer.modPow(7n, 100n, 1n)).toBe(0n);
    expect(Integer.modPow(7n, 100n, -1n)).toBe(0n);
    // The result is in [0, |modulus|).
    expect(Integer.modPow(3n, 3n, -5n)).toBe(2n);
    expect(Integer.modPow(5n, 0n, 7n)).toBe(1n);
    expect(Integer.modInverse(3n, 0n)).toEqual(Option.none());
    expect(Integer.modInverse(-3n, 11n)).toEqual(Option.some(7n));
    expect(Integer.modInverse(3n, -11n)).toEqual(Option.some(4n));
  });
});

describe("integer literal parsing", () => {
  it("accepts upper- and lower-case digits up to radix 36", () => {
    expect(U8.parse("FF", 16)).toEqual(Result.succeed(255));
    expect(U8.parse("fF", 16)).toEqual(Result.succeed(255));
    expect(U8.parse("Z", 36)).toEqual(Result.succeed(35));
    expect(U64.parse("ZZZZ", 36)).toEqual(Result.succeed(36n ** 4n - 1n));
    expect(Result.isFailure(U8.parse("G", 16))).toBe(true);
    expect(Result.isFailure(U8.parse("1_0"))).toBe(true);
    expect(Result.isFailure(U8.parse("-"))).toBe(true);
  });
  it("rejects radixes outside 2..36", () => {
    expect(Result.isFailure(U8.parse("1", 1))).toBe(true);
    expect(Result.isFailure(U8.parse("1", 37))).toBe(true);
    expect(Result.isFailure(U8.parse("1", 2.5))).toBe(true);
    expect(Result.isSuccess(U8.parse("1", 2))).toBe(true);
  });
});
