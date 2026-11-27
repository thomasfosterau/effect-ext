/**
 * `Query`s from and to URL query strings, in a pluggable **dialect**.
 *
 * APIs spell a query differently: JSON:API-style brackets
 * (`filter[age][gte]=18&sort=-age&page[limit]=10`), OData
 * (`$filter=age ge 18&$orderby=age desc&$top=10`), or an application's own
 * scheme. A {@link Dialect} only turns `URLSearchParams` into a
 * {@link Parsed} query (the filter tree with each value still the string from
 * the URL) and back. {@link decode} then does what every dialect shares:
 * maps wire field names to the struct's (`aliases`), rejects unknown fields,
 * decodes each value with its field's string codec, and bounds the window by
 * the caller's `maxLimit`. {@link encode} runs the same steps in reverse.
 *
 * Fields are dotted paths (`address.city`). A path whose first segment names
 * one of the caller's `relationships` crosses it: `decode` reads
 * `notes.about` as `Exists("notes", about …)`, which is how the brackets
 * dialect spells a relationship filter; OData also spells it
 * `notes/any(x: x/about eq …)`.
 *
 * Two dialects ship: {@link brackets} and {@link odata}. A new one is any
 * value with `parse` and `print`.
 *
 * @copyright Thomas Foster
 * @since 0.5.0
 */

import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as R from "effect/Record";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as OData from "./internal/query/odata.ts";
import * as Paths from "./internal/query/paths.ts";
import * as Query from "./Query.ts";

// ---------------------------------------------------------------------------
// Dialects
// ---------------------------------------------------------------------------

/**
 * A query as a dialect reads it from a URL, before any schema sees it: field
 * names as sent, and every value in the filter tree a `string`.
 *
 * @since 0.5.0
 * @category models
 */
export interface Parsed {
  readonly filter: Query.Expr;
  readonly sort: ReadonlyArray<Pick<Query.Sort<unknown>, "field" | "direction">>;
  readonly offset: Option.Option<string>;
  readonly limit: Option.Option<string>;
}

/**
 * A query string that does not spell a query this schema and dialect
 * accept: a malformed parameter, an unknown field, a value its field's schema
 * rejects, or a window past the caller's bound.
 *
 * @example
 * ```ts
 * import { QueryParams } from "@thomasfosterau/effect-ext"
 *
 * const error = new QueryParams.QueryParamsError({ parameter: "sort", message: "unknown field email" })
 * console.log(error.message)
 * // → unknown field email
 * ```
 *
 * @since 0.5.0
 * @category errors
 */
export class QueryParamsError extends Schema.TaggedError<
  QueryParamsError,
  { readonly brand: unique symbol }
>()("QueryParamsError", {
  /**
   * The query parameter at fault as sent, when a dialect reads it; the part
   * of the query (`filter`, `sort`, `offset`, `limit`) when a schema check
   * fails after the dialect.
   */
  parameter: Schema.String,
  /** What is wrong with it. */
  message: Schema.String,
}) {}

/**
 * One URL spelling of a query: reads a {@link Parsed} query from
 * `URLSearchParams`, and prints one back. `print` fails for a filter the
 * dialect cannot spell (an `or` in {@link brackets}, say).
 *
 * @since 0.5.0
 * @category models
 */
export interface Dialect {
  readonly parse: (params: URLSearchParams) => Result.Result<Parsed, QueryParamsError>;
  readonly print: (parsed: Parsed) => Result.Result<URLSearchParams, QueryParamsError>;
}

const quote = (text: string): string => `"${text}"`;

const fail = (parameter: string, message: string): Result.Result<never, QueryParamsError> =>
  Result.fail(new QueryParamsError({ parameter, message }));

const window = (
  params: URLSearchParams,
  offset: string,
  limit: string,
): Pick<Parsed, "offset" | "limit"> => ({
  offset: Option.fromNullOr(params.get(offset)),
  limit: Option.fromNullOr(params.get(limit)),
});

const setWindow = (params: URLSearchParams, parsed: Parsed, offset: string, limit: string) => {
  Option.map(parsed.offset, (value) => params.set(offset, value));
  Option.map(parsed.limit, (value) => params.set(limit, value));
};

// ---------------------------------------------------------------------------
// Brackets (JSON:API style)
// ---------------------------------------------------------------------------

/**
 * The operators {@link brackets} spells in its second bracket.
 *
 * @since 0.5.0
 * @category models
 */
export type BracketOperator = Query.CompareOp | Query.TextOp | "in" | "present";

/**
 * Options for {@link brackets}; every member has the default shown.
 *
 * @since 0.5.0
 * @category models
 */
export interface BracketsOptions {
  /** The filter family's name: `filter` reads `filter[field]` / `filter[field][op]`. */
  readonly filter?: string;
  /** The sort parameter: `sort=-age,name` (a leading `-` is descending). */
  readonly sort?: string;
  /** The offset parameter: `page[offset]`. */
  readonly offset?: string;
  /** The limit parameter: `page[limit]`. */
  readonly limit?: string;
  /** What separates `in` values and sort keys: `,`. */
  readonly separator?: string;
  /** Wire names for operators, where they differ from the operator's own name. */
  readonly operators?: Partial<Readonly<Record<BracketOperator, string>>>;
}

const BRACKET_OPERATORS: ReadonlyArray<BracketOperator> = [
  "eq",
  "ne",
  "lt",
  "lte",
  "gt",
  "gte",
  "contains",
  "startsWith",
  "endsWith",
  "in",
  "present",
];

const escapeRegExp = (text: string): string => text.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");

const bracketLeaf = (
  key: string,
  field: string,
  operator: BracketOperator,
  value: string,
  separator: string,
): Result.Result<Query.Expr, QueryParamsError> =>
  Match.value(operator).pipe(
    Match.when("in", (): Result.Result<Query.Expr, QueryParamsError> =>
      Result.succeed({ _tag: "In", field, values: value.split(separator) }),
    ),
    Match.when("present", (): Result.Result<Query.Expr, QueryParamsError> =>
      value === "true"
        ? Result.succeed({ _tag: "Present", field })
        : value === "false"
          ? Result.succeed({ _tag: "Not", filter: { _tag: "Present", field } })
          : fail(key, `expected true or false, found ${quote(value)}`),
    ),
    Match.when(
      (op): op is Query.TextOp => op === "contains" || op === "startsWith" || op === "endsWith",
      (op): Result.Result<Query.Expr, QueryParamsError> =>
        Result.succeed({ _tag: "Text", field, op, value }),
    ),
    Match.orElse((op): Result.Result<Query.Expr, QueryParamsError> =>
      Result.succeed({ _tag: "Compare", field, op, value }),
    ),
  );

const LEAVES = ["Compare", "In", "Text", "Present"] as const;

type Leaf = Query.Compare | Query.In | Query.Text | Query.Present;

const isLeaf = (expr: Query.Expr): expr is Leaf => Arr.contains(LEAVES, expr._tag);

/** An `Exists` chain ending in one leaf, as the leaf with the relationships prefixed to its path. */
const flattenExists = (expr: Query.Expr): Option.Option<Leaf> =>
  Match.value(expr).pipe(
    Match.tag("Exists", (node) =>
      Option.map(flattenExists(node.filter), (leaf): Leaf => ({
        ...leaf,
        field: `${node.relationship}.${leaf.field}`,
      })),
    ),
    Match.orElse((node) => (isLeaf(node) ? Option.some(node) : Option.none())),
  );

const sortKeys = (
  key: string,
  text: string,
  separator: string,
  read: (segment: string) => Option.Option<Pick<Query.Sort<unknown>, "field" | "direction">>,
): Result.Result<Parsed["sort"], QueryParamsError> =>
  Result.all(
    Arr.map(text.split(separator), (segment) =>
      Option.match(read(segment.trim()), {
        onNone: () => fail(key, `malformed sort key ${quote(segment)}`),
        onSome: Result.succeed,
      }),
    ),
  );

/**
 * The JSON:API-style bracket dialect: `filter[name]=Ada` (equality),
 * `filter[age][gte]=18`, `filter[name][in]=Ada,Bo`,
 * `filter[nickname][present]=false`, `filter[address.city]=Hobart`,
 * `sort=-age,name`, `page[offset]` and `page[limit]`. Repeated filter
 * parameters are `and`ed; parameters outside the query's are ignored. A
 * relationship is a path segment (`filter[pets.kind]=cat`), so an `Exists`
 * prints only when it holds a single test (or another such `Exists`). It
 * cannot spell `or`, a general `not` or an `Exists` over several tests, so
 * printing one fails. JSON:API leaves filtering to the server; this is its
 * most common convention, and every name in it is an option.
 *
 * @example
 * ```ts
 * import { Effect, Schema } from "effect"
 * import { Query, QueryParams } from "@thomasfosterau/effect-ext"
 *
 * const Person = Schema.Struct({ name: Schema.String, age: Schema.Finite })
 * const decode = QueryParams.decode(Person, QueryParams.brackets(), { maxLimit: 100 })
 *
 * const query = Effect.runSync(decode(new URLSearchParams("filter[age][gte]=18&sort=-age&page[limit]=10")))
 * console.log(Query.run(query, [{ name: "Bo", age: 12 }, { name: "Ada", age: 36 }]))
 * // → [ { name: 'Ada', age: 36 } ]
 * ```
 *
 * @since 0.5.0
 * @category dialects
 */
export const brackets = (options: BracketsOptions = {}): Dialect => {
  const filterName = options.filter ?? "filter";
  const sortName = options.sort ?? "sort";
  const offsetName = options.offset ?? "page[offset]";
  const limitName = options.limit ?? "page[limit]";
  const separator = options.separator ?? ",";
  const wireOf = (op: BracketOperator): string => options.operators?.[op] ?? op;
  const operatorOf = R.fromEntries(Arr.map(BRACKET_OPERATORS, (op) => [wireOf(op), op] as const));

  const parse = (params: URLSearchParams): Result.Result<Parsed, QueryParamsError> => {
    const pattern = new RegExp(`^${escapeRegExp(filterName)}\\[([^\\]]+)\\](?:\\[([^\\]]+)\\])?$`);
    const leaves = Arr.getSomes(
      Arr.map(Arr.fromIterable(params), ([key, value]) =>
        Option.map(Option.fromNullOr(pattern.exec(key)), (match) => {
          const field = match[1] ?? "";
          return Option.match(Option.fromUndefinedOr(match[2]), {
            onNone: () => bracketLeaf(key, field, "eq", value, separator),
            onSome: (wire) =>
              Option.match(R.get(operatorOf, wire), {
                onNone: () => fail(key, `unknown operator ${quote(wire)}`),
                onSome: (op) => bracketLeaf(key, field, op, value, separator),
              }),
          });
        }),
      ),
    );
    return Result.gen(function* () {
      const filters = yield* Result.all(leaves);
      const sort = yield* Option.match(Option.fromNullOr(params.get(sortName)), {
        onNone: () => Result.succeed<Parsed["sort"]>([]),
        onSome: (text) =>
          sortKeys(sortName, text, separator, (segment) => {
            const descending = segment.startsWith("-");
            const field = descending ? segment.slice(1) : segment;
            return field === ""
              ? Option.none()
              : Option.some({
                  field,
                  direction: descending ? ("desc" as const) : ("asc" as const),
                });
          }),
      });
      return {
        filter: Query.and(...filters),
        sort,
        ...window(params, offsetName, limitName),
      };
    });
  };

  const leafKey = (field: string, op: BracketOperator) =>
    op === "eq" ? `${filterName}[${field}]` : `${filterName}[${field}][${wireOf(op)}]`;
  const cannot = (what: string) => fail(filterName, `the bracket dialect cannot spell ${what}`);

  const printLeaf = (
    expr: Query.Expr,
  ): Result.Result<readonly [string, string], QueryParamsError> =>
    Match.value(expr).pipe(
      Match.tag("Compare", (node) =>
        Result.succeed([leafKey(node.field, node.op), String(node.value)] as const),
      ),
      Match.tag("Text", (node) =>
        Result.succeed([leafKey(node.field, node.op), node.value] as const),
      ),
      Match.tag("Present", (node) =>
        Result.succeed([leafKey(node.field, "present"), "true"] as const),
      ),
      Match.tag("In", (node) => {
        const values = Arr.map(node.values, String);
        return Arr.some(values, (value) => value.includes(separator))
          ? cannot(`an in-list value containing ${quote(separator)}`)
          : Result.succeed([leafKey(node.field, "in"), values.join(separator)] as const);
      }),
      Match.tag("Exists", (node) =>
        Option.match(flattenExists(node), {
          onNone: () => cannot("an exists over anything but one test"),
          onSome: printLeaf,
        }),
      ),
      Match.tag("Not", (node) =>
        Option.match(
          Option.filter(flattenExists(node.filter), (leaf) => P.isTagged(leaf, "Present")),
          {
            onNone: () => cannot("not"),
            onSome: (leaf) => Result.succeed([leafKey(leaf.field, "present"), "false"] as const),
          },
        ),
      ),
      Match.tag("Or", () => cannot("or")),
      Match.orElse(() => cannot("a nested and")),
    );

  const print = (parsed: Parsed): Result.Result<URLSearchParams, QueryParamsError> => {
    const leaves = Match.value(parsed.filter).pipe(
      Match.tag("All", (): ReadonlyArray<Query.Expr> => []),
      Match.tag("And", (node) => node.filters),
      Match.orElse((node) => [node]),
    );
    return Result.map(Result.all(Arr.map(leaves, printLeaf)), (entries) => {
      const params = new URLSearchParams(entries.map(([key, value]) => [key, value]));
      if (Arr.isReadonlyArrayNonEmpty(parsed.sort)) {
        params.set(
          sortName,
          Arr.map(parsed.sort, (key) =>
            key.direction === "desc" ? `-${key.field}` : key.field,
          ).join(separator),
        );
      }
      setWindow(params, parsed, offsetName, limitName);
      return params;
    });
  };

  return { parse, print };
};

// ---------------------------------------------------------------------------
// OData
// ---------------------------------------------------------------------------

/**
 * Options for {@link odata}; every member has the default shown.
 *
 * @since 0.5.0
 * @category models
 */
export interface ODataOptions {
  /** `$filter`. */
  readonly filter?: string;
  /** `$orderby`. */
  readonly orderby?: string;
  /** `$skip`. */
  readonly skip?: string;
  /** `$top`. */
  readonly top?: string;
}

/**
 * The OData dialect, over a subset of OData 4.01's system query options:
 * `$filter` with `eq` `ne` `lt` `le` `gt` `ge`, `in (…)`, `and` `or` `not`,
 * parentheses, `contains` / `startswith` / `endswith`, `eq null` /
 * `ne null` for absence, paths (`address/city`), and the lambdas
 * `rel/any()`, `rel/any(x: x/kind eq 'cat')` and `rel/all(x: …)` over a
 * relationship (`all` reads as no related record failing); `$orderby=age
 * desc,name`; `$skip` and `$top`. A value may be quoted (`'Ada'`, with `''`
 * for a quote) or bare (`18`, `2024-01-01T00:00:00Z`); either way the
 * field's schema decodes it. Inside a lambda every path starts with its
 * variable. Arithmetic and other functions are not read.
 *
 * @example
 * ```ts
 * import { Effect, Schema } from "effect"
 * import { Query, QueryParams } from "@thomasfosterau/effect-ext"
 *
 * const Person = Schema.Struct({ name: Schema.String, age: Schema.Finite })
 * const decode = QueryParams.decode(Person, QueryParams.odata(), { maxLimit: 100 })
 *
 * const params = new URLSearchParams({ $filter: "age ge 18 and not startswith(name, 'C')", $top: "5" })
 * const query = Effect.runSync(decode(params))
 * console.log(Query.run(query, [{ name: "Ada", age: 36 }, { name: "Cy", age: 70 }]))
 * // → [ { name: 'Ada', age: 36 } ]
 * ```
 *
 * @since 0.5.0
 * @category dialects
 */
export const odata = (options: ODataOptions = {}): Dialect => {
  const filterName = options.filter ?? "$filter";
  const orderbyName = options.orderby ?? "$orderby";
  const skipName = options.skip ?? "$skip";
  const topName = options.top ?? "$top";

  const parse = (params: URLSearchParams): Result.Result<Parsed, QueryParamsError> =>
    Result.gen(function* () {
      const filter = yield* Option.match(Option.fromNullOr(params.get(filterName)), {
        onNone: () => Result.succeed<Query.Expr>(Query.all),
        onSome: (text) =>
          Result.mapError(
            OData.parseFilter(text),
            (message) => new QueryParamsError({ parameter: filterName, message }),
          ),
      });
      const sort = yield* Option.match(Option.fromNullOr(params.get(orderbyName)), {
        onNone: () => Result.succeed<Parsed["sort"]>([]),
        onSome: (text) =>
          sortKeys(orderbyName, text, ",", (segment) =>
            Option.flatMap(Option.fromNullOr(/^(\S+)(?:\s+(asc|desc))?$/.exec(segment)), (match) =>
              Option.map(Option.fromUndefinedOr(match[1]), (field) => ({
                field,
                direction: match[2] === "desc" ? ("desc" as const) : ("asc" as const),
              })),
            ),
          ),
      });
      return { filter, sort, ...window(params, skipName, topName) };
    });

  const print = (parsed: Parsed): Result.Result<URLSearchParams, QueryParamsError> => {
    const params = new URLSearchParams();
    const filter = OData.printFilter(parsed.filter);
    if (filter !== "") params.set(filterName, filter);
    if (Arr.isReadonlyArrayNonEmpty(parsed.sort)) {
      params.set(
        orderbyName,
        Arr.map(parsed.sort, (key) => `${key.field} ${key.direction}`).join(","),
      );
    }
    setWindow(params, parsed, skipName, topName);
    return Result.succeed(params);
  };

  return { parse, print };
};

// ---------------------------------------------------------------------------
// Decoding and encoding
// ---------------------------------------------------------------------------

/**
 * Options for {@link decode} and {@link encode}.
 *
 * @since 0.5.0
 * @category models
 */
export interface Options<F extends Schema.Struct.Fields> {
  /** The largest `limit` a request may ask for. A larger one fails. */
  readonly maxLimit: number;
  /** The `limit` when the request names none; `maxLimit` if omitted. */
  readonly defaultLimit?: number;
  /**
   * Wire field names for struct fields whose names differ on the wire. An
   * alias renames a path's first segment, at the top level only.
   */
  readonly aliases?: Partial<Readonly<Record<keyof F & string, string>>>;
  /** The relationships a filter may cross, by wire name; none by default. */
  readonly relationships?: Query.Relationships;
}

const Count = Schema.toCodecStringTree(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)));

const failWith = (parameter: string, message: string): Effect.Effect<never, QueryParamsError> =>
  Effect.fail(new QueryParamsError({ parameter, message }));

type StringCodec = Schema.toCodecStringTree<Schema.Codec<unknown>>;

/** Where a filter's fields are resolved: the root struct, or a related one. */
interface Scope {
  readonly fields: Schema.Struct.Fields;
  readonly relationships: Query.Relationships;
  readonly fromWire: (wire: string) => string;
  readonly toWire: (name: string) => string;
}

const rootScope = <F extends Schema.Struct.Fields>(
  schema: Schema.Struct<F>,
  options: Options<F>,
): Scope => {
  const names = R.keys(schema.fields);
  const toWire: Readonly<Record<string, string>> = R.fromEntries(
    Arr.map(names, (name) => [name, options.aliases?.[name] ?? name] as const),
  );
  const fromWire: Readonly<Record<string, string>> = R.fromEntries(
    Arr.map(names, (name) => [options.aliases?.[name] ?? name, name] as const),
  );
  return {
    fields: schema.fields,
    relationships: options.relationships ?? {},
    // An unaliased name maps to nothing, so it fails as an unknown field.
    fromWire: (wire) => Option.getOrElse(R.get(fromWire, wire), () => ""),
    toWire: (name) => Option.getOrElse(R.get(toWire, name), () => ""),
  };
};

const relatedScope = (
  scope: Scope,
  name: string,
  parameter: string,
): Effect.Effect<Scope, QueryParamsError> =>
  Option.match(
    Object.hasOwn(scope.relationships, name) ? R.get(scope.relationships, name) : Option.none(),
    {
      onNone: () => failWith(parameter, `unknown relationship ${quote(name)}`),
      onSome: (relationship) =>
        Effect.succeed({
          fields: relationship.schema.fields,
          relationships: relationship.relationships?.() ?? {},
          fromWire: (wire: string) => wire,
          toWire: (field: string) => field,
        }),
    },
  );

const splitPath = (path: string): readonly [string, string] => {
  const dot = path.indexOf(".");
  return dot === -1 ? [path, ""] : [path.slice(0, dot), path.slice(dot + 1)];
};

const joinPath = (head: string, rest: string): string => (rest === "" ? head : `${head}.${rest}`);

/** A path's field and string codec, its first segment renamed to the other side's name. */
const fieldOf = (
  scope: Scope,
  path: string,
  parameter: string,
  direction: "decode" | "encode",
): Effect.Effect<readonly [string, StringCodec], QueryParamsError> => {
  const [head, rest] = splitPath(path);
  const structPath = direction === "decode" ? joinPath(scope.fromWire(head), rest) : path;
  const output = direction === "decode" ? structPath : joinPath(scope.toWire(head), rest);
  return Option.match(Paths.fieldAt(scope.fields, structPath), {
    onNone: () => failWith(parameter, `unknown field ${quote(path)}`),
    onSome: (field) =>
      Effect.succeed([output, Schema.toCodecStringTree(Query.valueSchema(field))] as const),
  });
};

const decodeValue = (codec: StringCodec, field: string, value: unknown) =>
  P.isString(value)
    ? Schema.decodeEffect(codec)(value).pipe(
        Effect.mapError(
          (error) =>
            new QueryParamsError({ parameter: "filter", message: `${field}: ${error.message}` }),
        ),
      )
    : failWith("filter", `${field}: a dialect must hand over string values`);

const encodeValue = (codec: StringCodec, field: string, value: unknown) =>
  Schema.encodeUnknownEffect(codec)(value).pipe(
    Effect.mapError(
      (error) =>
        new QueryParamsError({ parameter: "filter", message: `${field}: ${error.message}` }),
    ),
    Effect.filterOrElse(P.isString, () =>
      failWith("filter", `${field}: the value has no single-string form`),
    ),
  );

type Convert = (
  codec: StringCodec,
  field: string,
  value: unknown,
) => Effect.Effect<unknown, QueryParamsError>;

/** Renames a leaf's field and converts its values. */
const mapLeaf = (
  node: Leaf,
  name: string,
  codec: StringCodec,
  value: Convert,
): Effect.Effect<Query.Expr, QueryParamsError> =>
  Match.value(node).pipe(
    Match.tag("Compare", (leaf) =>
      Effect.map(value(codec, leaf.field, leaf.value), (converted): Query.Expr => ({
        ...leaf,
        field: name,
        value: converted,
      })),
    ),
    Match.tag("In", (leaf) =>
      Effect.map(
        Effect.forEach(leaf.values, (each) => value(codec, leaf.field, each), { concurrency: 1 }),
        (values): Query.Expr => ({ ...leaf, field: name, values }),
      ),
    ),
    Match.orElse((leaf) => Effect.succeed<Query.Expr>({ ...leaf, field: name })),
  );

/**
 * A wire leaf as a struct leaf. A path whose first segment names a
 * relationship (and has more segments) crosses it, as an `Exists`.
 */
const decodeLeaf = (scope: Scope, node: Leaf): Effect.Effect<Query.Expr, QueryParamsError> => {
  const [head, rest] = splitPath(node.field);
  return rest !== "" && Object.hasOwn(scope.relationships, head)
    ? Effect.flatMap(relatedScope(scope, head, "filter"), (related) =>
        Effect.map(decodeLeaf(related, { ...node, field: rest }), (filter): Query.Expr => ({
          _tag: "Exists",
          relationship: head,
          filter,
        })),
      )
    : Effect.flatMap(fieldOf(scope, node.field, "filter", "decode"), ([name, codec]) =>
        mapLeaf(node, name, codec, decodeValue),
      );
};

const encodeLeaf = (scope: Scope, node: Leaf): Effect.Effect<Query.Expr, QueryParamsError> =>
  Effect.flatMap(fieldOf(scope, node.field, "filter", "encode"), ([name, codec]) =>
    mapLeaf(node, name, codec, encodeValue),
  );

/** Maps every leaf of a filter tree, resolving an `Exists`'s filter in the related scope. */
const mapTree = (
  expr: Query.Expr,
  scope: Scope,
  leaf: (scope: Scope, node: Leaf) => Effect.Effect<Query.Expr, QueryParamsError>,
): Effect.Effect<Query.Expr, QueryParamsError> => {
  const children = (filters: ReadonlyArray<Query.Expr>) =>
    Effect.forEach(filters, (child) => mapTree(child, scope, leaf), { concurrency: 1 });
  return Match.valueTags(expr, {
    All: (node) => Effect.succeed<Query.Expr>(node),
    Compare: (node) => leaf(scope, node),
    In: (node) => leaf(scope, node),
    Text: (node) => leaf(scope, node),
    Present: (node) => leaf(scope, node),
    Exists: (node) =>
      Effect.flatMap(relatedScope(scope, node.relationship, "filter"), (related) =>
        Effect.map(mapTree(node.filter, related, leaf), (filter): Query.Expr => ({
          ...node,
          filter,
        })),
      ),
    And: (node) =>
      Effect.map(children(node.filters), (filters): Query.Expr => ({ _tag: "And", filters })),
    Or: (node) =>
      Effect.map(children(node.filters), (filters): Query.Expr => ({ _tag: "Or", filters })),
    Not: (node) =>
      Effect.map(mapTree(node.filter, scope, leaf), (filter): Query.Expr => ({
        _tag: "Not",
        filter,
      })),
  });
};

const count = (parameter: string, text: string) =>
  Schema.decodeEffect(Count)(text).pipe(
    Effect.mapError(
      () =>
        new QueryParamsError({
          parameter,
          message: `expected a whole number, found ${quote(text)}`,
        }),
    ),
  );

/**
 * Reads a query from `URLSearchParams` in `dialect`, checked against
 * `schema`: wire field names map through `aliases`, a path through one of
 * `relationships` becomes an `Exists` checked against that relationship's
 * schema, an unknown field or relationship fails, each value decodes through
 * its field's string codec (`Schema.toCodecStringTree` of its
 * `Query.valueSchema`), and the window is bounded by `maxLimit` (a missing
 * `limit` is `defaultLimit`).
 *
 * @example
 * ```ts
 * import { Effect, Schema } from "effect"
 * import { QueryParams } from "@thomasfosterau/effect-ext"
 *
 * const Person = Schema.Struct({ name: Schema.String, age: Schema.Finite })
 * const decode = QueryParams.decode(Person, QueryParams.brackets(), { maxLimit: 100, aliases: { age: "years" } })
 *
 * console.log(Effect.runSync(decode(new URLSearchParams("filter[years][gt]=30"))).filter)
 * // → { _tag: 'Compare', field: 'age', op: 'gt', value: 30 }
 * console.log(Effect.runSync(Effect.flip(decode(new URLSearchParams("filter[age]=30")))).message)
 * // → unknown field "age"
 * ```
 *
 * @since 0.5.0
 * @category decoding
 */
export const decode =
  <F extends Schema.Struct.Fields>(
    schema: Schema.Struct<F>,
    dialect: Dialect,
    options: Options<F>,
  ) =>
  (
    params: URLSearchParams,
  ): Effect.Effect<Query.Query<Schema.Struct.Type<F>>, QueryParamsError> => {
    const scope = rootScope(schema, options);
    return Effect.gen(function* () {
      const parsed = yield* Effect.fromResult(dialect.parse(params));
      const filter = yield* mapTree(parsed.filter, scope, decodeLeaf);
      const sort = yield* Effect.forEach(
        parsed.sort,
        (key) =>
          Effect.map(fieldOf(scope, key.field, "sort", "decode"), ([field]) => ({
            field,
            direction: key.direction,
          })),
        { concurrency: 1 },
      );
      const offset = yield* Option.match(parsed.offset, {
        onNone: () => Effect.succeed(0),
        onSome: (text) => count("offset", text),
      });
      const limit = yield* Option.match(parsed.limit, {
        onNone: () => Effect.succeed(options.defaultLimit ?? options.maxLimit),
        onSome: (text) => count("limit", text),
      });
      if (limit > options.maxLimit) {
        return yield* failWith("limit", `at most ${options.maxLimit}, found ${limit}`);
      }
      return { filter, sort, offset, limit: Option.some(limit) };
    });
  };

/**
 * Writes a query as `URLSearchParams` in `dialect`: the reverse of
 * {@link decode}, for a client building a request. Fails when a value has no
 * single-string form or the dialect cannot spell the filter.
 *
 * @example
 * ```ts
 * import { Effect, pipe, Schema } from "effect"
 * import { Query, QueryParams } from "@thomasfosterau/effect-ext"
 *
 * const Person = Schema.Struct({ name: Schema.String, age: Schema.Finite })
 * const p = Query.fields<typeof Person.Type>()
 * const query = pipe(Query.make<typeof Person.Type>(), Query.where(p.gte("age", 18)), Query.orderBy(p.desc("age")), Query.take(10))
 *
 * const encode = QueryParams.encode(Person, QueryParams.odata(), { maxLimit: 100 })
 * console.log(Effect.runSync(encode(query)).toString())
 * // → %24filter=age+ge+18&%24orderby=age+desc&%24top=10
 * ```
 *
 * @since 0.5.0
 * @category encoding
 */
export const encode =
  <F extends Schema.Struct.Fields>(
    schema: Schema.Struct<F>,
    dialect: Dialect,
    options: Options<F>,
  ) =>
  (query: Query.Query<Schema.Struct.Type<F>>): Effect.Effect<URLSearchParams, QueryParamsError> => {
    const scope = rootScope(schema, options);
    return Effect.gen(function* () {
      const filter = yield* mapTree(query.filter, scope, encodeLeaf);
      const sort = yield* Effect.forEach(
        query.sort,
        (key) =>
          Effect.map(fieldOf(scope, key.field, "sort", "encode"), ([field]) => ({
            field,
            direction: key.direction,
          })),
        { concurrency: 1 },
      );
      return yield* Effect.fromResult(
        dialect.print({
          filter,
          sort,
          offset: query.offset > 0 ? Option.some(String(query.offset)) : Option.none(),
          limit: Option.map(query.limit, String),
        }),
      );
    });
  };
