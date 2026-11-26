/**
 * @copyright Thomas Foster
 *
 * Type-level tests for `Query`: `fields` checks field names and values
 * against the record type, ordering and text operators take only fields of
 * the right kind, and a filter for one record type is not a filter for
 * another. Checked by the package's `check` task (tsconfig.test.json); the
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
