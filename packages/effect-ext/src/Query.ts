/**
 * LINQ-style queries as **data**: a {@link Filter} is a small expression tree
 * (comparisons, membership, text matching, `and` / `or` / `not`), a
 * {@link Query} adds sorting and a window, and both are plain JSON-shaped
 * values.
 *
 * Because a query is data rather than a closure, one value serves four
 * places:
 *
 * - **Build it typed**: {@link fields} gives constructors whose field names
 *   and values are checked against the record type.
 * - **Store or send it**: {@link QueryFor}, {@link FilterFor} and
 *   {@link SortFor} are JSON codecs derived from a `Schema.Struct`, which
 *   reject unknown fields and decode each value with that field's schema.
 * - **Parse it from a URL**: `QueryParams` reads one from `URLSearchParams`
 *   in a pluggable dialect (JSON:API-style brackets, OData, your own).
 * - **Run it**: {@link run} evaluates it over any `Iterable`; a backend (SQL,
 *   an index, a remote API) walks the same {@link Expr} tree instead.
 *
 * **`Option` fields** are compared by their inner value, as SQL compares a
 * nullable column: `None` matches no comparison, membership or text test
 * (not even `ne`), and {@link Present} tests for `Some`.
 *
 * @copyright Thomas Foster
 * @since 0.5.0
 */

import * as Arr from "effect/Array";
import * as DateTime from "effect/DateTime";
import * as Eq from "effect/Equal";
import { dual } from "effect/Function";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as P from "effect/Predicate";
import * as R from "effect/Record";
import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";

// ---------------------------------------------------------------------------
// The expression tree
// ---------------------------------------------------------------------------

/**
 * The ordering comparisons a {@link Compare} node can make.
 *
 * @since 0.5.0
 * @category models
 */
export type CompareOp = "eq" | "ne" | "lt" | "lte" | "gt" | "gte";

/**
 * The string tests a {@link Text} node can make.
 *
 * @since 0.5.0
 * @category models
 */
export type TextOp = "contains" | "startsWith" | "endsWith";

/**
 * Matches every record: the empty filter.
 *
 * @since 0.5.0
 * @category models
 */
export interface All {
  readonly _tag: "All";
}

/**
 * Compares one field with a value.
 *
 * @since 0.5.0
 * @category models
 */
export interface Compare {
  readonly _tag: "Compare";
  readonly field: string;
  readonly op: CompareOp;
  readonly value: unknown;
}

/**
 * Matches when one field equals any of the values (SQL's `IN`).
 *
 * @since 0.5.0
 * @category models
 */
export interface In {
  readonly _tag: "In";
  readonly field: string;
  readonly values: ReadonlyArray<unknown>;
}

/**
 * Tests a string field against a string.
 *
 * @since 0.5.0
 * @category models
 */
export interface Text {
  readonly _tag: "Text";
  readonly field: string;
  readonly op: TextOp;
  readonly value: string;
}

/**
 * Matches when the field holds a value: `Some` for an `Option` field,
 * anything but `undefined` otherwise (SQL's `IS NOT NULL`).
 *
 * @since 0.5.0
 * @category models
 */
export interface Present {
  readonly _tag: "Present";
  readonly field: string;
}

/**
 * Matches when every child matches. An empty `And` matches everything.
 *
 * @since 0.5.0
 * @category models
 */
export interface And {
  readonly _tag: "And";
  readonly filters: ReadonlyArray<Expr>;
}

/**
 * Matches when any child matches. An empty `Or` matches nothing.
 *
 * @since 0.5.0
 * @category models
 */
export interface Or {
  readonly _tag: "Or";
  readonly filters: ReadonlyArray<Expr>;
}

/**
 * Matches when its child does not.
 *
 * @since 0.5.0
 * @category models
 */
export interface Not {
  readonly _tag: "Not";
  readonly filter: Expr;
}

/**
 * The untyped filter tree: what a backend walks to compile a query. Field
 * names are plain strings and values are the decoded (`Type`-side) values; an
 * `Option` field's values are its inner values.
 *
 * @since 0.5.0
 * @category models
 */
export type Expr = All | Compare | In | Text | Present | And | Or | Not;

declare const FilterTarget: unique symbol;

/**
 * A filter over records of type `A`: an {@link Expr} tagged, at the type
 * level only, with the record type it was built or decoded for. A
 * `Filter<Person>` is not a `Filter<Order>`.
 *
 * @since 0.5.0
 * @category models
 */
export type Filter<A> = Expr & { readonly [FilterTarget]?: (record: A) => void };

/**
 * One sort key: a field and a direction.
 *
 * @since 0.5.0
 * @category models
 */
export interface Sort<A> {
  readonly field: string;
  readonly direction: "asc" | "desc";
  readonly [FilterTarget]?: (record: A) => void;
}

/**
 * A complete query: a filter, sort keys applied in order (the first is the
 * primary key, as with LINQ's `OrderBy(...).ThenBy(...)`), and a window.
 *
 * @since 0.5.0
 * @category models
 */
export interface Query<A> {
  readonly filter: Filter<A>;
  readonly sort: ReadonlyArray<Sort<A>>;
  readonly offset: number;
  readonly limit: Option.Option<number>;
}

// ---------------------------------------------------------------------------
// Field typing
// ---------------------------------------------------------------------------

/**
 * The values {@link fields}' ordering comparisons and sort keys accept, bare
 * or inside an `Option`.
 *
 * @since 0.5.0
 * @category models
 */
export type Ordered = number | string | bigint | boolean | DateTime.DateTime;

/**
 * The string keys of `A` whose values are `V`, or an `Option` of `V`.
 *
 * @since 0.5.0
 * @category models
 */
export type KeysOf<A, V> = {
  readonly [K in keyof A]-?: [A[K]] extends [V | Option.Option<V>] ? K : never;
}[keyof A] &
  string;

/**
 * The string keys of `A` whose values are `Option`s.
 *
 * @since 0.5.0
 * @category models
 */
export type OptionKeys<A> = {
  readonly [K in keyof A]-?: [A[K]] extends [Option.Option<unknown>] ? K : never;
}[keyof A] &
  string;

/**
 * Typed constructors for filters and sort keys over `A`.
 *
 * @since 0.5.0
 * @category models
 */
export interface Fields<A> {
  readonly eq: <K extends keyof A & string>(field: K, value: Unwrapped<A[K]>) => Filter<A>;
  readonly ne: <K extends keyof A & string>(field: K, value: Unwrapped<A[K]>) => Filter<A>;
  readonly lt: <K extends KeysOf<A, Ordered>>(field: K, value: Unwrapped<A[K]>) => Filter<A>;
  readonly lte: <K extends KeysOf<A, Ordered>>(field: K, value: Unwrapped<A[K]>) => Filter<A>;
  readonly gt: <K extends KeysOf<A, Ordered>>(field: K, value: Unwrapped<A[K]>) => Filter<A>;
  readonly gte: <K extends KeysOf<A, Ordered>>(field: K, value: Unwrapped<A[K]>) => Filter<A>;
  readonly oneOf: <K extends keyof A & string>(
    field: K,
    values: Iterable<Unwrapped<A[K]>>,
  ) => Filter<A>;
  readonly isSome: (field: OptionKeys<A>) => Filter<A>;
  readonly isNone: (field: OptionKeys<A>) => Filter<A>;
  readonly contains: (field: KeysOf<A, string>, value: string) => Filter<A>;
  readonly startsWith: (field: KeysOf<A, string>, value: string) => Filter<A>;
  readonly endsWith: (field: KeysOf<A, string>, value: string) => Filter<A>;
  readonly asc: (field: KeysOf<A, Ordered>) => Sort<A>;
  readonly desc: (field: KeysOf<A, Ordered>) => Sort<A>;
}

/**
 * The value inside an `Option`, or the value itself.
 *
 * @since 0.5.0
 * @category models
 */
export type Unwrapped<V> = V extends Option.Option<infer X> ? X : V;

const compare =
  (op: CompareOp) =>
  (field: string, value: unknown): Compare => ({ _tag: "Compare", field, op, value });

const text =
  (op: TextOp) =>
  (field: string, value: string): Text => ({ _tag: "Text", field, op, value });

/**
 * Typed filter and sort constructors for records of type `A`. Field names are
 * checked against `A`; ordering comparisons and sort keys take only fields
 * holding an {@link Ordered} value, and the text tests only string fields.
 * An `Option` field compares by its inner value.
 *
 * @example
 * ```ts
 * import { Query } from "@thomasfosterau/effect-ext"
 *
 * interface Person {
 *   readonly name: string
 *   readonly age: number
 * }
 *
 * const p = Query.fields<Person>()
 * const adults = Query.and(p.gte("age", 18), p.startsWith("name", "A"))
 *
 * console.log(adults)
 * // → { _tag: 'And', filters: [ { _tag: 'Compare', field: 'age', op: 'gte', value: 18 }, { _tag: 'Text', field: 'name', op: 'startsWith', value: 'A' } ] }
 * ```
 *
 * @since 0.5.0
 * @category constructors
 */
export const fields = <A>(): Fields<A> => ({
  eq: compare("eq"),
  ne: compare("ne"),
  lt: compare("lt"),
  lte: compare("lte"),
  gt: compare("gt"),
  gte: compare("gte"),
  oneOf: (field, values) => ({ _tag: "In", field, values: Arr.fromIterable(values) }),
  contains: text("contains"),
  startsWith: text("startsWith"),
  endsWith: text("endsWith"),
  isSome: (field) => ({ _tag: "Present", field }),
  isNone: (field) => ({ _tag: "Not", filter: { _tag: "Present", field } }),
  asc: (field) => ({ field, direction: "asc" }),
  desc: (field) => ({ field, direction: "desc" }),
});

/**
 * The filter that matches every record.
 *
 * @example
 * ```ts
 * import { Query } from "@thomasfosterau/effect-ext"
 *
 * console.log(Query.run(Query.where(Query.make<number>(), Query.all), [1, 2]))
 * // → [ 1, 2 ]
 * ```
 *
 * @since 0.5.0
 * @category constructors
 */
export const all: Filter<unknown> = { _tag: "All" };

const isOr = P.isTagged("Or");
const isNot = P.isTagged("Not");

/**
 * Matches when every filter matches. Nested `And`s and `All`s are flattened
 * away, so `and()` is {@link all}.
 *
 * @example
 * ```ts
 * import { Query } from "@thomasfosterau/effect-ext"
 *
 * const n = Query.fields<{ readonly n: number }>()
 * console.log(Query.and(n.gt("n", 1), Query.all, n.lt("n", 5)))
 * // → { _tag: 'And', filters: [ { _tag: 'Compare', field: 'n', op: 'gt', value: 1 }, { _tag: 'Compare', field: 'n', op: 'lt', value: 5 } ] }
 * ```
 *
 * @since 0.5.0
 * @category combinators
 */
export const and = <A>(...filters: ReadonlyArray<Filter<A>>): Filter<A> => {
  const flat = Arr.flatMap(filters, (filter): ReadonlyArray<Expr> =>
    Match.value<Expr>(filter).pipe(
      Match.tag("All", () => []),
      Match.tag("And", (node) => node.filters),
      Match.orElse((node) => [node]),
    ),
  );
  return Arr.match(flat, {
    onEmpty: () => all,
    onNonEmpty: (nonEmpty) =>
      nonEmpty.length === 1 ? Arr.headNonEmpty(nonEmpty) : { _tag: "And", filters: nonEmpty },
  });
};

/**
 * Matches when any filter matches. Nested `Or`s are flattened; `or()` matches
 * nothing.
 *
 * @example
 * ```ts
 * import { Query } from "@thomasfosterau/effect-ext"
 *
 * const n = Query.fields<{ readonly n: number }>()
 * const q = Query.where(Query.make<{ readonly n: number }>(), Query.or(n.eq("n", 1), n.eq("n", 3)))
 * console.log(Query.run(q, [{ n: 1 }, { n: 2 }, { n: 3 }]))
 * // → [ { n: 1 }, { n: 3 } ]
 * ```
 *
 * @since 0.5.0
 * @category combinators
 */
export const or = <A>(...filters: ReadonlyArray<Filter<A>>): Filter<A> => {
  const flat = Arr.flatMap(filters, (filter): ReadonlyArray<Expr> =>
    isOr(filter) ? filter.filters : [filter],
  );
  return Arr.match(flat, {
    onEmpty: () => ({ _tag: "Or", filters: [] }),
    onNonEmpty: (nonEmpty) =>
      nonEmpty.length === 1 ? Arr.headNonEmpty(nonEmpty) : { _tag: "Or", filters: nonEmpty },
  });
};

/**
 * Matches when the filter does not. A double negation is removed.
 *
 * @example
 * ```ts
 * import { Query } from "@thomasfosterau/effect-ext"
 *
 * const n = Query.fields<{ readonly n: number }>()
 * console.log(Query.not(Query.not(n.eq("n", 1))))
 * // → { _tag: 'Compare', field: 'n', op: 'eq', value: 1 }
 * ```
 *
 * @since 0.5.0
 * @category combinators
 */
export const not = <A>(filter: Filter<A>): Filter<A> =>
  isNot(filter) ? filter.filter : { _tag: "Not", filter };

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * The query that returns every record, in input order.
 *
 * @example
 * ```ts
 * import { Query } from "@thomasfosterau/effect-ext"
 *
 * console.log(Query.make<number>())
 * // → { filter: { _tag: 'All' }, sort: [], offset: 0, limit: { _id: 'Option', _tag: 'None' } }
 * ```
 *
 * @since 0.5.0
 * @category constructors
 */
export const make = <A>(): Query<A> => ({
  filter: all,
  sort: [],
  offset: 0,
  limit: Option.none(),
});

/**
 * Narrows a query: the new filter is `and`ed with the one it has.
 *
 * @example
 * ```ts
 * import { pipe } from "effect"
 * import { Query } from "@thomasfosterau/effect-ext"
 *
 * const n = Query.fields<{ readonly n: number }>()
 * const q = pipe(Query.make<{ readonly n: number }>(), Query.where(n.gt("n", 1)), Query.where(n.lt("n", 4)))
 * console.log(Query.run(q, [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }]))
 * // → [ { n: 2 }, { n: 3 } ]
 * ```
 *
 * @since 0.5.0
 * @category combinators
 */
export const where: {
  <A>(filter: Filter<A>): (self: Query<A>) => Query<A>;
  <A>(self: Query<A>, filter: Filter<A>): Query<A>;
} = dual(2, <A>(self: Query<A>, filter: Filter<A>): Query<A> => ({
  ...self,
  filter: and(self.filter, filter),
}));

/**
 * Appends sort keys, after any the query has (LINQ's `ThenBy`).
 *
 * @example
 * ```ts
 * import { pipe } from "effect"
 * import { Query } from "@thomasfosterau/effect-ext"
 *
 * interface Row { readonly team: string; readonly score: number }
 * const r = Query.fields<Row>()
 * const q = pipe(Query.make<Row>(), Query.orderBy(r.asc("team"), r.desc("score")))
 * console.log(Query.run(q, [{ team: "b", score: 1 }, { team: "a", score: 1 }, { team: "a", score: 2 }]))
 * // → [ { team: 'a', score: 2 }, { team: 'a', score: 1 }, { team: 'b', score: 1 } ]
 * ```
 *
 * @since 0.5.0
 * @category combinators
 */
export const orderBy =
  <A>(...sort: ReadonlyArray<Sort<A>>) =>
  (self: Query<A>): Query<A> => ({ ...self, sort: [...self.sort, ...sort] });

/**
 * Skips `n` more records. Negative and fractional counts are truncated to a
 * whole number of at least zero.
 *
 * @example
 * ```ts
 * import { pipe } from "effect"
 * import { Query } from "@thomasfosterau/effect-ext"
 *
 * console.log(Query.run(pipe(Query.make<number>(), Query.skip(1), Query.take(2)), [1, 2, 3, 4]))
 * // → [ 2, 3 ]
 * ```
 *
 * @since 0.5.0
 * @category combinators
 */
export const skip: {
  (n: number): <A>(self: Query<A>) => Query<A>;
  <A>(self: Query<A>, n: number): Query<A>;
} = dual(2, <A>(self: Query<A>, n: number): Query<A> => {
  const count = whole(n);
  return {
    ...self,
    offset: self.offset + count,
    // Skipping inside an existing window shrinks it.
    limit: Option.map(self.limit, (limit) => Math.max(0, limit - count)),
  };
});

/**
 * Keeps at most `n` records; a second `take` can only shrink the window.
 *
 * @example
 * ```ts
 * import { pipe } from "effect"
 * import { Query } from "@thomasfosterau/effect-ext"
 *
 * console.log(Query.run(pipe(Query.make<number>(), Query.take(3), Query.take(5)), [1, 2, 3, 4]))
 * // → [ 1, 2, 3 ]
 * ```
 *
 * @since 0.5.0
 * @category combinators
 */
export const take: {
  (n: number): <A>(self: Query<A>) => Query<A>;
  <A>(self: Query<A>, n: number): Query<A>;
} = dual(2, <A>(self: Query<A>, n: number): Query<A> => ({
  ...self,
  limit: Option.some(
    Option.match(self.limit, {
      onNone: () => whole(n),
      onSome: (limit) => Math.min(limit, whole(n)),
    }),
  ),
}));

const whole = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0);

// ---------------------------------------------------------------------------
// In-memory evaluation
// ---------------------------------------------------------------------------

// A field's value as SQL sees a nullable column: `None` (or a missing field)
// is NULL, which no comparison matches.
const unwrap = (value: unknown): Option.Option<unknown> =>
  Option.isOption(value) ? value : Option.fromUndefinedOr(value);

/**
 * Orders two values of the same {@link Ordered} kind; `None` for different
 * kinds, which no ordering comparison matches.
 */
const compareValues = (a: unknown, b: unknown): Option.Option<-1 | 0 | 1> => {
  if (P.isNumber(a) && P.isNumber(b)) return Option.some(Order.Number(a, b));
  if (P.isString(a) && P.isString(b)) return Option.some(Order.String(a, b));
  if (P.isBigInt(a) && P.isBigInt(b)) return Option.some(Order.BigInt(a, b));
  if (P.isBoolean(a) && P.isBoolean(b)) return Option.some(Order.Boolean(a, b));
  if (DateTime.isDateTime(a) && DateTime.isDateTime(b)) return Option.some(DateTime.Order(a, b));
  return Option.none();
};

// Own properties only, so a field name never reaches the prototype chain.
const read = (record: unknown, field: string): unknown =>
  P.hasProperty(record, field) && Object.hasOwn(record, field) ? record[field] : undefined;

const ordered = (op: Exclude<CompareOp, "eq" | "ne">, ordering: -1 | 0 | 1): boolean =>
  Match.value(op).pipe(
    Match.when("lt", () => ordering < 0),
    Match.when("lte", () => ordering <= 0),
    Match.when("gt", () => ordering > 0),
    Match.when("gte", () => ordering >= 0),
    Match.exhaustive,
  );

const compareMatches = (node: Compare, actual: unknown): boolean =>
  Option.match(unwrap(actual), {
    onNone: () => false,
    onSome: (inner) =>
      Match.value(node.op).pipe(
        Match.when("eq", () => Eq.equals(inner, node.value)),
        Match.when("ne", () => !Eq.equals(inner, node.value)),
        Match.orElse((op) =>
          Option.match(compareValues(inner, node.value), {
            onNone: () => false,
            onSome: (ordering) => ordered(op, ordering),
          }),
        ),
      ),
  });

const textMatches = (node: Text, actual: unknown): boolean =>
  Option.match(Option.filter(unwrap(actual), P.isString), {
    onNone: () => false,
    onSome: (inner) =>
      Match.value(node.op).pipe(
        Match.when("contains", () => inner.includes(node.value)),
        Match.when("startsWith", () => inner.startsWith(node.value)),
        Match.when("endsWith", () => inner.endsWith(node.value)),
        Match.exhaustive,
      ),
  });

const evaluate = (expr: Expr, record: unknown): boolean =>
  Match.valueTags(expr, {
    All: () => true,
    Compare: (node) => compareMatches(node, read(record, node.field)),
    In: (node) =>
      Option.match(unwrap(read(record, node.field)), {
        onNone: () => false,
        onSome: (inner) => Arr.some(node.values, (value) => Eq.equals(inner, value)),
      }),
    Present: (node) => Option.isSome(unwrap(read(record, node.field))),
    Text: (node) => textMatches(node, read(record, node.field)),
    And: (node) => Arr.every(node.filters, (child) => evaluate(child, record)),
    Or: (node) => Arr.some(node.filters, (child) => evaluate(child, record)),
    Not: (node) => !evaluate(node.filter, record),
  });

/**
 * The filter as a `Predicate`, for `Array.filter`, `Stream.filter` and the
 * like. Equality is `Equal.equals` (so `DateTime`s and `Data` values compare
 * structurally); `None` and a missing field match no comparison. An ordering comparison
 * between values of different kinds never matches.
 *
 * @example
 * ```ts
 * import { Array } from "effect"
 * import { Query } from "@thomasfosterau/effect-ext"
 *
 * const n = Query.fields<{ readonly n: number }>()
 * console.log(Array.filter([{ n: 1 }, { n: 2 }], Query.toPredicate(n.ne("n", 1))))
 * // → [ { n: 2 } ]
 * ```
 *
 * @since 0.5.0
 * @category evaluation
 */
export const toPredicate =
  <A>(filter: Filter<A>): P.Predicate<A> =>
  (record) =>
    evaluate(filter, record);

const fieldOrder = (sort: {
  readonly field: string;
  readonly direction: "asc" | "desc";
}): Order.Order<unknown> => {
  // `None` sorts before every `Some`; values of different kinds tie.
  const ascending = Order.make<unknown>((a, b) =>
    Option.match(unwrap(read(a, sort.field)), {
      onNone: () => (Option.isNone(unwrap(read(b, sort.field))) ? 0 : -1),
      onSome: (x) =>
        Option.match(unwrap(read(b, sort.field)), {
          onNone: () => 1,
          onSome: (y) => Option.getOrElse(compareValues(x, y), () => 0),
        }),
    }),
  );
  return sort.direction === "asc" ? ascending : Order.flip(ascending);
};

/**
 * The sort keys as one `Order`: the first key decides, and each later key
 * breaks the ties of the ones before it. `None` sorts first ascending.
 *
 * @example
 * ```ts
 * import { Array } from "effect"
 * import { Query } from "@thomasfosterau/effect-ext"
 *
 * const n = Query.fields<{ readonly n: number }>()
 * console.log(Array.sort([{ n: 2 }, { n: 1 }], Query.toOrder([n.asc("n")])))
 * // → [ { n: 1 }, { n: 2 } ]
 * ```
 *
 * @since 0.5.0
 * @category evaluation
 */
export const toOrder = <A>(sort: ReadonlyArray<Sort<A>>): Order.Order<A> =>
  Order.combineAll(Arr.map(sort, fieldOrder));

/**
 * Runs a query over records in memory: filter, then a stable sort, then the
 * window.
 *
 * @example
 * ```ts
 * import { pipe } from "effect"
 * import { Query } from "@thomasfosterau/effect-ext"
 *
 * interface Person { readonly name: string; readonly age: number }
 * const p = Query.fields<Person>()
 * const oldestAdults = pipe(
 *   Query.make<Person>(),
 *   Query.where(p.gte("age", 18)),
 *   Query.orderBy(p.desc("age")),
 *   Query.take(2),
 * )
 *
 * const people = [{ name: "Ada", age: 36 }, { name: "Bo", age: 12 }, { name: "Cy", age: 70 }, { name: "Di", age: 18 }]
 * console.log(Query.run(oldestAdults, people).map((person) => person.name))
 * // → [ 'Cy', 'Ada' ]
 * ```
 *
 * @since 0.5.0
 * @category evaluation
 */
export const run: {
  <A>(records: Iterable<A>): (self: Query<A>) => Array<A>;
  <A>(self: Query<A>, records: Iterable<A>): Array<A>;
} = dual(2, <A>(self: Query<A>, records: Iterable<A>): Array<A> => {
  const matched = Arr.filter(Arr.fromIterable(records), toPredicate(self.filter));
  const sorted = Arr.isReadonlyArrayNonEmpty(self.sort)
    ? Arr.sort(matched, toOrder(self.sort))
    : matched;
  const windowed = Arr.drop(sorted, self.offset);
  return Option.match(self.limit, {
    onNone: () => windowed,
    onSome: (limit) => Arr.take(windowed, limit),
  });
});

// ---------------------------------------------------------------------------
// Wire codecs
// ---------------------------------------------------------------------------

const CompareOps = Schema.Literals(["eq", "ne", "lt", "lte", "gt", "gte"]);
const TextOps = Schema.Literals(["contains", "startsWith", "endsWith"]);
const Direction = Schema.Literals(["asc", "desc"]);
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/**
 * The schema of the values a filter compares a field with, on the `Type`
 * side: the field's own type, or the inner type of an `Option` field. Every
 * wire format decodes leaf values through it (in its JSON form here, its
 * string form in `QueryParams`).
 *
 * @example
 * ```ts
 * import { Schema } from "effect"
 * import { Query } from "@thomasfosterau/effect-ext"
 *
 * const nickname = Query.valueSchema(Schema.OptionFromNullOr(Schema.String))
 * console.log(Schema.decodeUnknownSync(Schema.toCodecJson(nickname))("Prof"))
 * // → Prof
 * ```
 *
 * @since 0.5.0
 * @category schemas
 */
export const valueSchema = (field: Schema.Constraint): Schema.Codec<unknown> => {
  const type = Schema.toType(field);
  const ast = type.ast;
  // An `Option` schema is the one-parameter declaration that accepts `None`.
  const inner =
    SchemaAST.isDeclaration(ast) && Schema.is(type)(Option.none())
      ? Arr.head(ast.typeParameters)
      : Option.none();
  return Schema.make<Schema.Codec<unknown>>(Option.getOrElse(inner, () => ast));
};

/**
 * A filter codec for the records `schema` describes. The wire form is the
 * {@link Expr} tree itself, with each value in its field's JSON encoding
 * (`Schema.toCodecJson` of its {@link valueSchema}), so a `DateTime` field
 * travels as a string and an `Option` field as its inner value. An
 * unknown field, or a value its field's schema rejects, fails the decode at
 * that node's path.
 *
 * @example
 * ```ts
 * import { Schema } from "effect"
 * import { Query } from "@thomasfosterau/effect-ext"
 *
 * const Person = Schema.Struct({ name: Schema.String, age: Schema.Finite })
 * const decode = Schema.decodeSync(Query.FilterFor(Person))
 *
 * const filter = decode({ _tag: "Compare", field: "age", op: "gte", value: 18 })
 * console.log(Query.toPredicate(filter)({ name: "Ada", age: 36 }))
 * // → true
 * console.log(Schema.decodeExit(Query.FilterFor(Person))({ _tag: "Compare", field: "email", op: "eq", value: "x" })._tag)
 * // → Failure
 * ```
 *
 * @since 0.5.0
 * @category schemas
 */
export const FilterFor = <F extends Schema.Struct.Fields>(
  schema: Schema.Struct<F>,
): Schema.Codec<Filter<Schema.Struct.Type<F>>, Expr> => {
  const leaves = Arr.flatMap(R.toEntries(schema.fields), ([name, field]) => {
    const value = Schema.toCodecJson(valueSchema(field));
    const fieldName = Schema.Literal(name);
    return [
      Schema.TaggedStruct("Compare", { field: fieldName, op: CompareOps, value }),
      Schema.TaggedStruct("In", { field: fieldName, values: Schema.Array(value) }),
      Schema.TaggedStruct("Text", { field: fieldName, op: TextOps, value: Schema.String }),
      Schema.TaggedStruct("Present", { field: fieldName }),
    ];
  });
  const self: Schema.Codec<Expr> = Schema.Union([
    Schema.TaggedStruct("All", {}),
    ...leaves,
    Schema.TaggedStruct("And", { filters: Schema.Array(Schema.suspend(() => self)) }),
    Schema.TaggedStruct("Or", { filters: Schema.Array(Schema.suspend(() => self)) }),
    Schema.TaggedStruct("Not", { filter: Schema.suspend(() => self) }),
  ]);
  return self;
};

/**
 * A codec for a list of sort keys over the records `schema` describes: each
 * `{ field, direction }`, with `field` one of the struct's keys.
 *
 * @example
 * ```ts
 * import { Schema } from "effect"
 * import { Query } from "@thomasfosterau/effect-ext"
 *
 * const Person = Schema.Struct({ name: Schema.String, age: Schema.Finite })
 * const sort = Schema.decodeSync(Query.SortFor(Person))([{ field: "age", direction: "desc" }])
 * console.log(Query.run({ ...Query.make(), sort }, [{ name: "Bo", age: 12 }, { name: "Ada", age: 36 }]))
 * // → [ { name: 'Ada', age: 36 }, { name: 'Bo', age: 12 } ]
 * ```
 *
 * @since 0.5.0
 * @category schemas
 */
export const SortFor = <F extends Schema.Struct.Fields>(
  schema: Schema.Struct<F>,
): Schema.Codec<
  ReadonlyArray<Sort<Schema.Struct.Type<F>>>,
  ReadonlyArray<Pick<Sort<unknown>, "field" | "direction">>
> =>
  Schema.Array(
    Schema.Struct({ field: Schema.Literals(R.keys(schema.fields)), direction: Direction }),
  );

/**
 * A codec for a whole {@link Query} over the records `schema` describes: the
 * portable form a query is stored or sent in, for a backend to run.
 * `limit` is an absent key when the query has none.
 *
 * @example
 * ```ts
 * import { pipe, Schema } from "effect"
 * import { Query } from "@thomasfosterau/effect-ext"
 *
 * const Person = Schema.Struct({ name: Schema.String, age: Schema.Finite })
 * const p = Query.fields<typeof Person.Type>()
 * const query = pipe(Query.make<typeof Person.Type>(), Query.where(p.gte("age", 18)), Query.take(10))
 *
 * console.log(Schema.encodeSync(Schema.fromJsonString(Query.QueryFor(Person)))(query))
 * // → {"filter":{"_tag":"Compare","field":"age","op":"gte","value":18},"sort":[],"offset":0,"limit":10}
 * ```
 *
 * @since 0.5.0
 * @category schemas
 */
export const QueryFor = <F extends Schema.Struct.Fields>(
  schema: Schema.Struct<F>,
): Schema.Codec<Query<Schema.Struct.Type<F>>, QueryEncoded> =>
  Schema.Struct({
    filter: FilterFor(schema),
    sort: SortFor(schema),
    offset: Count,
    limit: Schema.OptionFromOptionalKey(Count),
  });

/**
 * The encoded form of a {@link Query}: see {@link QueryFor}.
 *
 * @since 0.5.0
 * @category models
 */
export interface QueryEncoded {
  readonly filter: Expr;
  readonly sort: ReadonlyArray<Pick<Sort<unknown>, "field" | "direction">>;
  readonly offset: number;
  readonly limit?: number;
}
