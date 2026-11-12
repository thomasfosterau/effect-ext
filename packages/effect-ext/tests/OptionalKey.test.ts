import { describe, expect, it } from "vite-plus/test";
import * as Option from "effect/Option";
import { fields, fromOption, optionalKey } from "@thomasfosterau/effect-ext/OptionalKey";

const introduce = (name: string, nickname?: string) => ({
  name,
  ...optionalKey("nickname", nickname),
});

describe("optionalKey", () => {
  it("omits the key when the value is undefined", () => {
    expect(optionalKey("a", undefined)).toStrictEqual({});
    expect(optionalKey("a")).toStrictEqual({});
    expect("a" in { x: 1, ...optionalKey("a", undefined) }).toBe(false);
  });

  it("keeps null as a value", () => {
    expect(optionalKey("a", null)).toStrictEqual({ a: null });
  });

  it("keeps falsy but defined values", () => {
    expect(optionalKey("a", "")).toStrictEqual({ a: "" });
    expect(optionalKey("a", 0)).toStrictEqual({ a: 0 });
    expect(optionalKey("a", false)).toStrictEqual({ a: false });
    expect(optionalKey("a", Number.NaN)).toStrictEqual({ a: Number.NaN });
  });

  it("spreads into an object literal", () => {
    expect(introduce("Ada")).toStrictEqual({ name: "Ada" });
    expect(introduce("Ada", "Countess")).toStrictEqual({ name: "Ada", nickname: "Countess" });
  });

  it("shares one frozen empty object for every absent key", () => {
    const absent = optionalKey("a", undefined);
    expect(absent).toBe(optionalKey("b", undefined));
    expect(absent).toBe(fromOption("c", Option.none()));
    expect(Object.isFrozen(absent)).toBe(true);
  });

  it("builds a fresh object for each present key", () => {
    expect(optionalKey("a", 1)).not.toBe(optionalKey("a", 1));
  });
});

describe("fromOption", () => {
  it("holds the key for Some", () => {
    expect(fromOption("a", Option.some(1))).toStrictEqual({ a: 1 });
    expect(fromOption("a", Option.some(null))).toStrictEqual({ a: null });
  });

  it("omits the key for None", () => {
    expect(fromOption("a", Option.none<number>())).toStrictEqual({});
  });
});

describe("fields", () => {
  it("drops undefined members and keeps every other value", () => {
    expect(fields({ a: undefined, b: null, c: 0, d: "", e: false, f: 1 })).toStrictEqual({
      b: null,
      c: 0,
      d: "",
      e: false,
      f: 1,
    });
  });

  it("returns an empty object when every member is undefined", () => {
    expect(fields({ a: undefined })).toStrictEqual({});
  });

  it("spreads into an options object", () => {
    expect({ collection: "posts", ...fields({ limit: 10, cursor: undefined }) }).toStrictEqual({
      collection: "posts",
      limit: 10,
    });
  });
});
