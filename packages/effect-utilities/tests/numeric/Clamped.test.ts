import { describe, expect, it } from "vite-plus/test";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as fc from "fast-check";
import * as Clamped from "@thomasfosterau/effect-utilities/Clamped";
import { getFailure, getSuccess } from "./helpers.ts";

describe("Clamped", () => {
  const Hue = Clamped.make({ min: 0, max: 360, name: "Hue" });
  const Volume = Clamped.int({ min: 0, max: 11 });

  it("make clamps, from validates", () => {
    expect(Hue.make(400)).toBe(360);
    expect(Hue.make(-1)).toBe(0);
    expect(Hue.from(400)).toEqual(Option.none());
    expect(Hue.from(12.5)).toEqual(Option.some(12.5));
    expect(Volume.from(2.5)).toEqual(Option.none());
    expect(Volume.make(2.7)).toBe(2);
    expect(Result.isFailure(Volume.fromResult(12))).toBe(true);
    expect(() => Hue.make(Number.NaN)).toThrow(/NaN/);
    expect(Hue.is(10)).toBe(true);
    expect(Hue.is(-10)).toBe(false);
    expect(Volume.name).toBe("ClampedInt[0, 11]");
  });

  it("saturating arithmetic", () => {
    const v = Volume.make(10);
    expect(Volume.add(v, 5)).toBe(11);
    expect(Volume.sub(5)(v)).toBe(5);
    expect(Volume.mul(v, -1)).toBe(0);
    expect(Volume.div(v, 3)).toBe(3);
    expect(() => Volume.div(v, 0)).toThrow(/by zero/);
    expect(Volume.map(v, (n) => n * n)).toBe(11);
    expect(Volume.checkedAdd(v, 1)).toEqual(Option.some(11));
    expect(Volume.checkedAdd(v, 2)).toEqual(Option.none());
  });

  it("wrapping", () => {
    expect(Hue.wrap(370)).toBe(10);
    expect(Hue.wrap(-10)).toBe(350);
    expect(Hue.wrap(360)).toBe(0);
    expect(Hue.wrappingAdd(Hue.make(350), 20)).toBe(10);
    expect(Volume.wrap(12)).toBe(0);
    expect(Volume.wrap(-1)).toBe(11);
    expect(Volume.wrappingSub(Volume.make(0), 1)).toBe(11);
    fc.assert(
      fc.property(fc.double({ noNaN: true, noDefaultInfinity: true, min: -1e9, max: 1e9 }), (x) => {
        expect(Hue.is(Hue.wrap(x))).toBe(true);
        expect(Hue.is(Hue.make(x))).toBe(true);
      }),
    );
  });

  it("lerp / normalize / rescale", () => {
    const UI = Clamped.UnitInterval;
    expect(Hue.lerp(UI.make(0.5))).toBe(180);
    expect(Hue.normalize(Hue.make(90))).toBe(0.25);
    expect(Hue.rescale(Clamped.Percentage)(Hue.make(90))).toBe(25);
    expect(Clamped.SignedUnitInterval.make(-2)).toBe(-1);
    expect(Hue.isMax(Hue.make(1000))).toBe(true);
    expect(Hue.isMin(Hue.min)).toBe(true);
  });

  it("schemas", () => {
    expect(Result.isFailure(Schema.decodeResult(Volume.schema)(12))).toBe(true);
    expect(Result.isFailure(Schema.decodeResult(Volume.schema)(1.5))).toBe(true);
    expect(Schema.decodeResult(Volume.schema)(5)).toEqual(Result.succeed(5));
    expect(Schema.decodeResult(Volume.schemaClamping)(50)).toEqual(Result.succeed(11));
    expect(Result.isFailure(Schema.decodeResult(Volume.schemaClamping)(Number.NaN))).toBe(true);
    // The clamping decoder maps ±Infinity onto the bounds; the exact schema is finite-only.
    expect(Schema.decodeResult(Volume.schemaClamping)(Number.POSITIVE_INFINITY)).toEqual(
      Result.succeed(11),
    );
    expect(Schema.decodeResult(Volume.schemaClamping)(Number.NEGATIVE_INFINITY)).toEqual(
      Result.succeed(0),
    );
    const Unit = Clamped.make({ min: 0, max: 1, name: "Unit" });
    expect(Result.isFailure(Schema.decodeResult(Unit.schema)(Number.NaN))).toBe(true);
    expect(Result.isFailure(Schema.decodeResult(Unit.schema)(Number.POSITIVE_INFINITY))).toBe(true);
    expect(Schema.toJsonSchemaDocument(Unit.schema).definitions).toEqual({
      Unit: { type: "number", minimum: 0, maximum: 1 },
    });
  });

  it("rejects invalid ranges", () => {
    expect(() => Clamped.make({ min: 1, max: 0 })).toThrow(/invalid range/);
    expect(() => Clamped.int({ min: 0.5, max: 1 })).toThrow(/bounds must be safe integers/);
    expect(() => Clamped.make({ min: 0, max: Number.POSITIVE_INFINITY })).toThrow(/invalid range/);
  });
});

describe("Clamped: remaining branches", () => {
  const Hue = Clamped.make({ min: 0, max: 360, name: "Hue" });
  const Volume = Clamped.int({ min: 0, max: 11 });

  it("wrap refuses non-finite input with a DomainError", () => {
    expect(() => Hue.wrap(Number.POSITIVE_INFINITY)).toThrow(/Hue: wrap: cannot wrap Infinity/);
    expect(() => Volume.wrap(Number.NaN)).toThrow(/cannot wrap NaN/);
    expect(() => Hue.wrappingAdd(Hue.make(1), Number.NEGATIVE_INFINITY)).toThrow(/cannot wrap/);
  });

  it("a zero-width range", () => {
    const Point = Clamped.make({ min: 5, max: 5 });
    expect(Point.name).toBe("Clamped[5, 5]");
    expect(Point.wrap(123.4)).toBe(5);
    expect(Point.wrap(-7)).toBe(5);
    expect(Point.normalize(Point.make(9))).toBe(0);
    expect(Point.lerp(Clamped.UnitInterval.make(1))).toBe(5);
    // An integer zero-width range still has one member, so it wraps modulo 1.
    const One = Clamped.int({ min: 3, max: 3 });
    expect(One.wrap(10)).toBe(3);
  });

  it("checked arithmetic on a continuous range keeps fractions", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 360, noNaN: true }),
        fc.double({ min: -400, max: 400, noNaN: true }),
        (a, b) => {
          const h = Hue.make(a);
          const exactSub = h - b;
          expect(Hue.checkedSub(h, b)).toEqual(
            exactSub >= 0 && exactSub <= 360 ? Option.some(exactSub + 0) : Option.none(),
          );
          const exactAdd = h + b;
          expect(Hue.checkedAdd(b)(h)).toEqual(
            exactAdd >= 0 && exactAdd <= 360 ? Option.some(exactAdd + 0) : Option.none(),
          );
        },
      ),
    );
    expect(Hue.checkedSub(Hue.make(10), 2.5)).toEqual(Option.some(7.5));
    expect(Hue.checkedSub(Hue.make(10), 11)).toEqual(Option.none());
    // On an integer range the exact result is truncated first.
    expect(Volume.checkedSub(Volume.make(5), 1.5)).toEqual(Option.some(3));
    expect(Volume.checkedSub(Volume.make(0), 1)).toEqual(Option.none());
  });

  it("fromResult, -0 normalisation, and the clamping schema's encoder", () => {
    expect(Hue.fromResult(12.5)).toEqual(Result.succeed(12.5));
    expect(Object.is(getSuccess(Hue.fromResult(-0)), 0)).toBe(true);
    expect(Object.is(Hue.make(-0), 0)).toBe(true);
    const e = getFailure(Volume.fromResult(-1));
    expect([e._tag, e.message]).toEqual([
      "OutOfRangeError",
      "ClampedInt[0, 11]: -1 is not a valid value in range [0, 11]",
    ]);
    expect(Schema.encodeSync(Volume.schemaClamping)(Volume.make(7))).toBe(7);
    expect(Schema.encodeSync(Hue.schemaClamping)(Hue.make(12.5))).toBe(12.5);
    expect([Volume.minValue, Volume.maxValue, Volume.integer, Hue.integer]).toEqual([
      0,
      11,
      true,
      false,
    ]);
    expect(Hue.Order(Hue.make(1), Hue.make(2))).toBe(-1);
    expect(Hue.Equivalence(Hue.make(1), Hue.make(1))).toBe(true);
    expect(Hue.is("1")).toBe(false);
    expect(Volume.is(1.5)).toBe(false);
  });

  it("arithmetic that produces NaN fails with a DomainError naming the operation", () => {
    expect(() => Hue.mul(Hue.make(0), Number.POSITIVE_INFINITY)).toThrow(
      /Hue: multiply: result is NaN/,
    );
    expect(() => Hue.map(Hue.make(1), () => Number.NaN)).toThrow(/Hue: map: result is NaN/);
    expect(() => Hue.add(Hue.make(1), Number.NaN)).toThrow(/Hue: add/);
    expect(() => Hue.sub(Hue.make(1), Number.NaN)).toThrow(/Hue: subtract/);
    expect(Hue.div(Hue.make(90), -1)).toBe(0);
    expect(Clamped.Percentage.make(150)).toBe(100);
  });
});
