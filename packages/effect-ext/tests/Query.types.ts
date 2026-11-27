/**
 * @copyright Thomas Foster
 *
 * Type-level tests for `Query`: `fields` checks field names and values
 * against the record type, ordering and text operators take only fields of
 * the right kind, and a filter for one record type is not a filter for
 * another; dotted paths reach nested structs, and `exists` takes a field
 * embedding related records and a filter over their type. Checked by the package's `check` task (tsconfig.test.json); the
 * expect-error directives are the assertions. Never executed.
 *
 * @module tests/Query.types
 */

import * as Option from "effect/Option";
import { Query } from "@thomasfosterau/effect-ext";

interface Person {
  readonly name: string;
  readonly age: number;
  readonly nickname: Option.Option<string>;
  readonly tags: ReadonlyArray<string>;
  readonly address: {
    readonly city: string;
    readonly geo: Option.Option<{ readonly lat: number }>;
  };
  readonly pets: ReadonlyArray<{ readonly kind: string }>;
}

interface Order {
  readonly total: number;
}

const p = Query.fields<Person>();

export const byName = p.eq("name", "Ada");
export const byNickname = p.gt("nickname", "A");
export const hasNickname = p.isSome("nickname");

// @ts-expect-error -- isSome takes only Option fields
export const someOnString = p.isSome("name");
export const byTags = p.eq("tags", ["a"]);

// @ts-expect-error -- not a field of Person
export const unknownField = p.eq("email", "x");

// @ts-expect-error -- age is a number
export const wrongValue = p.eq("age", "36");

// @ts-expect-error -- an array is not ordered
export const unorderedField = p.lt("tags", ["a"]);

// @ts-expect-error -- age is not a string field
export const textOnNumber = p.contains("age", "3");

// @ts-expect-error -- an array cannot be a sort key
export const sortByTags = p.asc("tags");

// @ts-expect-error -- a Person filter does not filter Orders
export const crossed: Query.Filter<Order> = byName;

// The match-everything filter fits any record type.
export const anything: Query.Filter<Order> = Query.all;

// @ts-expect-error -- combinators keep one record type
export const mixed = Query.and(byName, Query.fields<Order>().gt("total", 1));

// Dotted paths reach nested structs, through an Option, with the leaf's type.
export const byCity = p.eq("address.city", "Hobart");
export const byLatitude = p.gt("address.geo.lat", 0);
export const hasGeo = p.isSome("address.geo");

// @ts-expect-error -- city is a string
export const wrongNestedValue = p.eq("address.city", 1);

// @ts-expect-error -- not a path into Person
export const unknownPath = p.eq("address.zip", "7000");

// @ts-expect-error -- arrays are not descended into
export const intoArray = p.eq("pets.kind", "cat");

// @ts-expect-error -- latitude is not a string
export const textOnNestedNumber = p.contains("address.geo.lat", "4");

export const sortByCity = p.asc("address.city");

// `exists` takes an embedding field and a filter over the related type.
const pet = Query.fields<{ readonly kind: string }>();
export const catOwners = p.exists("pets", pet.eq("kind", "cat"));

// @ts-expect-error -- a Person filter is not a filter over pets
export const wrongRelated = p.exists("pets", p.eq("name", "Ada"));

// @ts-expect-error -- age embeds no related records
export const notARelationship = p.exists("age", Query.all);

// The untyped `exists` fits any record type, and combines with typed filters.
export const untyped: Query.Filter<Order> = Query.exists("lines", Query.all);
export const combined: Query.Filter<Person> = Query.and(byName, Query.exists("friends", byName));
