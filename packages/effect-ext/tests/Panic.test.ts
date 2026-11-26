import { describe, expect, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Result from "effect/Result";
import * as Layout from "@thomasfosterau/effect-ext/Layout";
import * as Panic from "@thomasfosterau/effect-ext/Panic";
import * as StringBuf from "@thomasfosterau/effect-ext/StringBuf";
import * as Vec from "@thomasfosterau/effect-ext/Vec";

/** The defect an effect died with, or the cause it ended with otherwise. */
const defectOf = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.map(Effect.exit(effect), (exit) =>
    Exit.isFailure(exit) ? Result.getOrUndefined(Cause.findDefect(exit.cause)) : undefined,
  );

describe("Panic", () => {
  it("derives each message from the fields", () => {
    expect(new Panic.IndexOutOfBoundsError({ type: "Vec", index: 4, length: 3 }).message).toBe(
      "Vec: index 4 out of bounds (length 3)",
    );
    expect(new Panic.CapacityError({ type: "Vec", length: 5, capacity: 4 }).message).toBe(
      "Vec: length 5 out of bounds (capacity 4)",
    );
    expect(new Panic.CharBoundaryError({ type: "Str", index: 1, length: 4 }).message).toBe(
      "Str: 1 is not a character boundary of a 4-byte string",
    );
    expect(
      new Panic.InvalidArgumentError({ operation: "Str.repeat", reason: "invalid repeat count -1" })
        .message,
    ).toBe("Str.repeat: invalid repeat count -1");
  });

  it("isPanic recognises every panic and nothing else", () => {
    expect(
      Panic.isPanic(new Panic.IndexOutOfBoundsError({ type: "Vec", index: 0, length: 0 })),
    ).toBe(true);
    expect(Panic.isPanic(new Panic.CapacityError({ type: "Vec", length: 1, capacity: 0 }))).toBe(
      true,
    );
    expect(Panic.isPanic(new Panic.CharBoundaryError({ type: "Str", index: 1, length: 2 }))).toBe(
      true,
    );
    expect(Panic.isPanic(new Panic.InvalidArgumentError({ operation: "x", reason: "y" }))).toBe(
      true,
    );
    expect(Panic.isPanic(new RangeError("x"))).toBe(false);
    expect(Panic.isPanic("IndexOutOfBoundsError")).toBe(false);
  });

  it.effect("an Effect form dies with a panic whose fields can be read", () =>
    Effect.gen(function* () {
      const v = yield* Vec.fromIterable(Layout.u8, [1, 2, 3]);
      const defect = yield* defectOf(Vec.insert(v, 10, 0));
      expect(defect).toBeInstanceOf(Panic.IndexOutOfBoundsError);
      expect(defect).toMatchObject({ _tag: "IndexOutOfBoundsError", index: 10, length: 3 });
    }),
  );

  it.effect("a StringBuf off a character boundary dies with CharBoundaryError", () =>
    Effect.gen(function* () {
      const s = yield* StringBuf.from("é");
      const defect = yield* defectOf(StringBuf.splitOff(s, 1));
      expect(defect).toMatchObject({ _tag: "CharBoundaryError", type: "StringBuf", index: 1 });
    }),
  );
});
