/**
 * IANA time zone names: the naming grammar, the check against the
 * runtime's tz data, aliases and case, the runtime's list, and the `Schema`.
 */

import { describe, expect, it } from "vite-plus/test";
import { DateTime, Effect, Option, Result, Schema } from "effect";
import { Parser } from "@thomasfosterau/effect-parse";
import { IanaTimeZone } from "@thomasfosterau/effect-time";

// An unexpected success gives "", which no expectation below contains.
const failure = (input: string): string =>
  Result.match(Parser.parse(IanaTimeZone.parser, input), {
    onSuccess: () => "",
    onFailure: (error) => error.message,
  });

describe("IanaTimeZone.parser", () => {
  it.each([
    "Europe/Paris",
    "America/Argentina/Buenos_Aires",
    "Australia/Sydney",
    "Etc/GMT+5",
    "UTC",
  ])("reads %s", (input) => {
    const zone = Parser.parseSync(IanaTimeZone.parser, input);
    expect(DateTime.isTimeZoneNamed(zone)).toBe(true);
  });

  it("gives the runtime's canonical spelling for an alias or another case", () => {
    expect(Parser.parseSync(IanaTimeZone.parser, "US/Eastern").id).toBe("America/New_York");
    expect(Parser.parseSync(IanaTimeZone.parser, "europe/paris").id).toBe("Europe/Paris");
  });

  it("rejects a well-formed name the runtime does not know", () => {
    expect(failure("Mars/Olympus_Mons")).toContain(
      '"Mars/Olympus_Mons" is not a time zone the runtime knows',
    );
  });

  it("rejects names the tz naming rules do not allow", () => {
    expect(failure("")).toContain("time zone name component");
    expect(failure("Europe//Paris")).toContain("time zone name component");
    expect(failure("./Paris")).toContain("time zone name component");
    expect(failure("-Europe/Paris")).toContain("time zone name component");
    expect(failure("Europe/AVeryLongCityName")).toContain("time zone name component");
    expect(failure("Europe/Paris ")).toContain("end of input");
  });
});

describe("IanaTimeZone.known and isKnown", () => {
  it("ask the runtime", () => {
    expect(Option.map(IanaTimeZone.known("US/Eastern"), (zone) => zone.id)).toEqual(
      Option.some("America/New_York"),
    );
    expect(IanaTimeZone.known("Nowhere/Special")).toEqual(Option.none());
    expect(IanaTimeZone.isKnown("Asia/Tokyo")).toBe(true);
    expect(IanaTimeZone.isKnown("Asia/Atlantis")).toBe(false);
  });
});

describe("IanaTimeZone.supported", () => {
  it("is the runtime's list, every entry of which the parser reads", () => {
    const list = IanaTimeZone.supported();
    expect(list).toEqual(Intl.supportedValuesOf("timeZone"));
    expect(list.length).toBeGreaterThan(300);
    expect(list.every((zone) => Result.isSuccess(Parser.parse(IanaTimeZone.parser, zone)))).toBe(
      true,
    );
  });
});

describe("IanaTimeZone.parse", () => {
  it("fails with a ParseError", () =>
    Effect.runPromise(Effect.flip(IanaTimeZone.parse("Nowhere/Special"))).then((error) => {
      expect(error._tag).toBe("ParseError");
    }));
});

describe("IanaTimeZone.FromString", () => {
  it("decodes to the zone and encodes its id", () => {
    const zone = Schema.decodeSync(IanaTimeZone.FromString)("Pacific/Auckland");
    expect(zone.id).toBe("Pacific/Auckland");
    expect(Schema.encodeSync(IanaTimeZone.FromString)(zone)).toBe("Pacific/Auckland");
  });

  it("reports an unknown zone as an issue", () => {
    expect(() => Schema.decodeSync(IanaTimeZone.FromString)("Nowhere/Special")).toThrow(
      /time zone the runtime knows/,
    );
  });
});
