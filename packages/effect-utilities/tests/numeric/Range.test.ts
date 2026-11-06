import { describe, expect, it } from "vite-plus/test";
import * as Num from "@thomasfosterau/effect-utilities/Num";
import * as Range from "@thomasfosterau/effect-utilities/Range";
import * as Ratio from "@thomasfosterau/effect-utilities/Ratio";

describe("Range", () => {
  it("ranges", () => {
    expect([...Range.range(Num.number)(0, 3)]).toEqual([0, 1, 2]);
    expect([...Range.rangeInclusive(Num.bigint)(1n, 3n)]).toEqual([1n, 2n, 3n]);
    expect([...Range.rangeStep(Num.bigint)(10n, 0n, -3n)]).toEqual([10n, 7n, 4n, 1n]);
    expect([...Range.rangeStepInclusive(Num.number)(0, 6, 2)]).toEqual([0, 2, 4, 6]);
    expect([...Range.rangeStepInclusive(Num.number)(6, 0, -3)]).toEqual([6, 3, 0]);
    expect([...Range.range(Num.number)(3, 0)]).toEqual([]);
    expect(() => [...Range.rangeStep(Num.number)(0, 1, 0)]).toThrow(RangeError);
    expect(
      [...Range.rangeInclusive(Ratio.Field)(Ratio.zero, Ratio.make(2))].map(Ratio.toString),
    ).toEqual(["0", "1", "2"]);
    expect([...Range.linspace(0, 1, 5)]).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect([...Range.linspace(2, 3, 1)]).toEqual([2]);
  });
  it("rejects a zero step and a bad count", () => {
    expect(() => [...Range.rangeStepInclusive(Num.number)(0, 1, 0)]).toThrow(
      /rangeStepInclusive: step must not be zero/,
    );
    expect(() => [...Range.rangeStepInclusive(Num.bigint)(0n, 1n, 0n)]).toThrow(RangeError);
    expect(() => [...Range.linspace(0, 1, -1)]).toThrow(/count must be >= 0/);
    expect(() => [...Range.linspace(0, 1, 2.5)]).toThrow(RangeError);
    expect([...Range.linspace(0, 1, 0)]).toEqual([]);
    expect([...Range.linspace(1, 0, 3)]).toEqual([1, 0.5, 0]);
    // An inclusive range whose step overshoots stops before `end`.
    expect([...Range.rangeStepInclusive(Num.number)(0, 5, 2)]).toEqual([0, 2, 4]);
    expect([...Range.rangeStepInclusive(Num.number)(0, -1, 1)]).toEqual([]);
  });
});
