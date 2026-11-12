import * as Option from "effect/Option";
import {
  type Defined,
  fields,
  fromOption,
  type OptionalKey,
  optionalKey,
  type Present,
  presentFields,
} from "@thomasfosterau/effect-ext/OptionalKey";

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

interface ListOptions {
  readonly collection: string;
  readonly limit?: number;
  readonly cursor?: string;
}

// The whole-object form: forwarded optionals spread into an options bag.
export const list = (collection: string, limit?: number, cursor?: string): ListOptions => ({
  collection,
  ...fields({ limit, cursor }),
});

/** `number`, or absent as `undefined` (spelled without writing the union). */
type MaybeNumber = ReturnType<typeof Option.getOrUndefined<number>>;

// A member that admits `undefined` becomes optional without it; the rest stay required.
export const defined = (limit?: number): Defined<{ a: MaybeNumber; b: string }> =>
  fields({ a: limit, b: "x" });
export const required = (limit?: number): { readonly b: string } => fields({ a: limit, b: "x" });

// @ts-expect-error — a required member stays required
export const missingRequired: Defined<{ b: string }> = {};

/** A row from a nullable SQL column, spelled without writing the union. */
type NullableString = ReturnType<typeof Option.getOrNull<string>>;

interface Resource {
  readonly id: number;
  readonly summary?: string;
}

// The row-to-resource boundary: a nullable column spreads into an optional key.
export const toResource = (id: number, summary: NullableString): Resource => ({
  id,
  ...presentFields({ summary }),
});

// A non-nullable member stays required; a nullable one becomes optional without `null`.
export const present = (
  summary: NullableString,
): Present<{ id: number; summary: NullableString }> => presentFields({ id: 1, summary });
export const requiredId = (summary: NullableString): { readonly id: number } =>
  presentFields({ id: 1, summary });

// @ts-expect-error — a non-nullable member stays required
export const missingId: Present<{ id: number }> = {};
