/**
 * TZif (RFC 8536): real tz database files, version 1 files built by hand
 * (leap seconds, indicators), and every structural check the parser makes.
 */

import { describe, expect, it } from "vite-plus/test";
import { Array as Arr, Effect, Option, Order, Result } from "effect";
import { Parser } from "@thomasfosterau/effect-parse";
import { PosixTz, Tzif } from "@thomasfosterau/effect-time";
import * as Zoneinfo from "./fixtures/zoneinfo.ts";

const parseSync = (input: Uint8Array): Tzif.Tzif => Parser.parseSync(Tzif.parser, input);

// An unexpected success gives "", which no expectation below contains.
const failure = (input: Uint8Array): string =>
  Result.match(Parser.parse(Tzif.parser, input), {
    onSuccess: () => "",
    onFailure: (error) => error.message,
  });

const u32 = (n: number): ReadonlyArray<number> => [
  (n >>> 24) & 255,
  (n >>> 16) & 255,
  (n >>> 8) & 255,
  n & 255,
];
const i32 = (n: number): ReadonlyArray<number> => u32(n >>> 0);

interface V1 {
  readonly version?: number;
  readonly times?: ReadonlyArray<number>;
  readonly types?: ReadonlyArray<number>;
  readonly infos?: ReadonlyArray<readonly [number, number, number]>;
  readonly chars?: string;
  readonly leaps?: ReadonlyArray<readonly [number, number]>;
  readonly std?: ReadonlyArray<number>;
  readonly ut?: ReadonlyArray<number>;
  readonly typecnt?: number;
}

// A version 1 TZif file; every field defaults to one UTC type and nothing else.
const v1 = (spec: V1): Uint8Array => {
  const times = spec.times ?? [];
  const infos = spec.infos ?? [[0, 0, 0]];
  const chars = spec.chars ?? "UTC\0";
  const leaps = spec.leaps ?? [];
  const std = spec.std ?? [];
  const ut = spec.ut ?? [];
  return new Uint8Array([
    0x54,
    0x5a,
    0x69,
    0x66,
    spec.version ?? 0,
    ...Array.from({ length: 15 }, () => 0),
    ...u32(ut.length),
    ...u32(std.length),
    ...u32(leaps.length),
    ...u32(times.length),
    ...u32(spec.typecnt ?? infos.length),
    ...u32(chars.length),
    ...times.flatMap(i32),
    ...(spec.types ?? times.map(() => 0)),
    ...infos.flatMap(([offset, dst, index]) => [i32(offset), [dst, index]].flat()),
    ...Array.from(chars, (c) => c.charCodeAt(0)),
    ...leaps.flatMap(([occurrence, correction]) => [i32(occurrence), i32(correction)].flat()),
    ...std,
    ...ut,
  ]);
};

describe("Tzif.parser on the tz database", () => {
  it("reads Etc/UTC", () => {
    const utc = parseSync(Zoneinfo.utc);
    expect(utc.version).toBe(2);
    expect(utc.transitions).toEqual([]);
    expect(utc.localTimeTypes).toEqual([
      { utcOffset: 0, isDst: false, designation: "UTC", standard: false, universal: false },
    ]);
    expect(utc.footer).toEqual(Option.some(Parser.parseSync(PosixTz.parser, "UTC0")));
  });

  it("reads Asia/Tokyo", () => {
    const tokyo = parseSync(Zoneinfo.tokyo);
    expect(tokyo.version).toBe(2);
    expect(tokyo.localTimeTypes.map((t) => t.designation)).toEqual(
      expect.arrayContaining(["LMT", "JST", "JDT"]),
    );
    const last = tokyo.transitions[tokyo.transitions.length - 1];
    expect(last && tokyo.localTimeTypes[last.type]).toMatchObject({
      utcOffset: 9 * 3600,
      isDst: false,
    });
    expect(tokyo.footer).toEqual(Option.some(Parser.parseSync(PosixTz.parser, "JST-9")));
  });

  it("reads Australia/Sydney with 64-bit times in ascending order", () => {
    const sydney = parseSync(Zoneinfo.sydney);
    expect(sydney.transitions.length).toBeGreaterThan(100);
    const times = sydney.transitions.map((t) => t.time);
    expect(times).toEqual(Arr.sort(times, Order.Number));
    expect(sydney.localTimeTypes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ utcOffset: 36000, isDst: false, designation: "AEST" }),
        expect.objectContaining({ utcOffset: 39600, isDst: true, designation: "AEDT" }),
      ]),
    );
    expect(Option.map(sydney.footer, PosixTz.format)).toEqual(
      Option.some("AEST-10AEDT,M10.1.0,M4.1.0/3"),
    );
  });
});

describe("Tzif.parser on version 1 files", () => {
  it("reads transitions, types, designations, leap seconds and indicators", () => {
    const file = v1({
      times: [-100, 0, 3600],
      types: [0, 1, 0],
      infos: [
        [3600, 0, 0],
        [7200, 1, 4],
      ],
      chars: "CET\0CEST\0",
      leaps: [
        [78796800, 1],
        [94694401, 2],
      ],
      std: [1, 0],
      ut: [1, 0],
    });
    expect(parseSync(file)).toEqual({
      version: 1,
      transitions: [
        { time: -100, type: 0 },
        { time: 0, type: 1 },
        { time: 3600, type: 0 },
      ],
      localTimeTypes: [
        { utcOffset: 3600, isDst: false, designation: "CET", standard: true, universal: true },
        { utcOffset: 7200, isDst: true, designation: "CEST", standard: false, universal: false },
      ],
      leapSeconds: [
        { occurrence: 78796800, correction: 1 },
        { occurrence: 94694401, correction: 2 },
      ],
      footer: Option.none(),
    });
  });

  it("reads a designation that shares its characters with another", () => {
    const file = v1({
      infos: [
        [0, 0, 0],
        [0, 0, 1],
      ],
      chars: "XYZ\0",
    });
    expect(parseSync(file).localTimeTypes.map((t) => t.designation)).toEqual(["XYZ", "YZ"]);
  });
});

describe("Tzif.parser checks", () => {
  it("rejects what is not a TZif file", () => {
    expect(failure(new Uint8Array([0x50, 0x4b, 3, 4]))).toContain('"TZif" magic number');
    expect(failure(v1({ version: 0x35 }))).toContain("version (0, '2', '3' or '4')");
  });

  it("checks the counts", () => {
    expect(failure(v1({ infos: [], typecnt: 0 }))).toContain("typecnt is 0");
    expect(failure(v1({ chars: "" }))).toContain("charcnt is 0");
    expect(
      failure(
        v1({
          infos: [
            [0, 0, 0],
            [0, 0, 0],
          ],
          ut: [0],
        }),
      ),
    ).toContain("isutcnt is neither 0 nor typecnt");
    expect(
      failure(
        v1({
          infos: [
            [0, 0, 0],
            [0, 0, 0],
          ],
          std: [0],
        }),
      ),
    ).toContain("isstdcnt is neither 0 nor typecnt");
  });

  it("checks the data", () => {
    expect(failure(v1({ times: [10, 5] }))).toContain("not in ascending order");
    expect(failure(v1({ times: [0], types: [1] }))).toContain("local time type index (0-0)");
    expect(failure(v1({ infos: [[0, 2, 0]] }))).toContain("DST indicator (0 or 1)");
    expect(failure(v1({ infos: [[0, 0, 4]] }))).toContain("designation index (0-3)");
    expect(failure(v1({ infos: [[-(2 ** 31), 0, 0]] }))).toContain("UT offset (not -2^31)");
    expect(failure(v1({ std: [2], ut: [0] }))).toContain("indicator (0 or 1)");
    expect(failure(v1({ std: [0], ut: [1] }))).toContain("UT indicator is set without");
  });

  it("checks the footer of a version 2 file", () => {
    const broken = Zoneinfo.tokyo.slice();
    // The footer is "\nJST-9\n": turn the offset into a letter.
    broken[broken.length - 2] = 0x58;
    expect(failure(broken)).toContain("invalid footer");
    expect(failure(Zoneinfo.tokyo.subarray(0, Zoneinfo.tokyo.length - 1))).toContain("newline");
  });

  it("bounds the footer and requires printable ASCII, failing rather than throwing", () => {
    // Tokyo's file ends "\nJST-9\n"; keep everything before the footer.
    const body = Zoneinfo.tokyo.subarray(0, Zoneinfo.tokyo.length - "\nJST-9\n".length);
    const withFooter = (footer: ReadonlyArray<number>) =>
      new Uint8Array([...body, 0x0a, ...footer]);
    const huge = new Uint8Array(body.length + 1 + 1_000_000).fill(0x41);
    huge.set(body);
    huge[body.length] = 0x0a;
    expect(failure(huge)).toContain(
      "newline ending the footer (at most 255 printable ASCII bytes)",
    );
    expect(failure(withFooter([...Array.from({ length: 256 }, () => 0x41), 0x0a]))).toContain(
      "newline ending the footer",
    );
    expect(failure(withFooter([0x4a, 0x01, 0x0a]))).toContain("newline ending the footer");
    expect(failure(withFooter([0x4a, 0xc3, 0xa9, 0x0a]))).toContain("newline ending the footer");
  });

  it("bounds designations and requires printable ASCII", () => {
    expect(failure(v1({ chars: `${"A".repeat(33)}\0` }))).toContain("longer than 32 bytes");
    expect(parseSync(v1({ chars: `${"A".repeat(32)}\0` })).localTimeTypes[0]?.designation).toBe(
      "A".repeat(32),
    );
    expect(failure(v1({ chars: "U\u0001C\0" }))).toContain("not printable ASCII");
    expect(failure(v1({ chars: "UTC" }))).toContain("not NUL-terminated");
  });

  it("rejects a truncated file", () => {
    expect(failure(Zoneinfo.sydney.subarray(0, 200))).not.toBe("");
  });
});

describe("Tzif.parse", () => {
  it("parses a whole file as an Effect", () =>
    Effect.runPromise(Tzif.parse(Zoneinfo.utc)).then((utc) => {
      expect(utc.localTimeTypes[0]?.designation).toBe("UTC");
    }));

  it("fails with a ParseError on trailing bytes", () =>
    Effect.runPromise(Effect.flip(Tzif.parse(new Uint8Array([...Zoneinfo.utc, 0])))).then(
      (error) => {
        expect(error._tag).toBe("ParseError");
      },
    ));
});
