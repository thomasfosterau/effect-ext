import * as Option from "effect/Option";
import { fromOption, type OptionalKey, optionalKey } from "@thomasfosterau/effect-ext/OptionalKey";

interface Person {
  readonly name: string;
  readonly nickname?: string;
}

// Spreading into a type with an optional key type-checks under
// exactOptionalPropertyTypes, where `{ nickname }` (possibly `undefined`) would not.
export const person = (nickname?: string): Person => ({
  name: "Ada",
  ...optionalKey("nickname", nickname),
});
export const fromSome: Person = { name: "Ada", ...fromOption("nickname", Option.some("Countess")) };

// The key is optional and readonly, and its value type excludes `undefined`.
export const nicknameKey = (nickname?: string): OptionalKey<"nickname", string> => {
  const key = optionalKey("nickname", nickname);
  // @ts-expect-error — the result is readonly
  key.nickname = "x";
  return key;
};

// @ts-expect-error — the value type is carried through
export const wrong: Person = { name: "Ada", ...optionalKey("nickname", 1) };
