/**
 * @copyright Thomas Foster
 *
 * `QueryParams`: the bracket and OData dialects (grammar, options, errors),
 * the schema step every dialect shares (aliases, value decoding, the window
 * bound), nested paths and relationships (`Exists`), and the round trip
 * `decode(encode(query)) = query`.
 *
 * @module tests/QueryParams
 */

import { assert, describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { Query, QueryParams } from "@thomasfosterau/effect-ext";

const Person = Schema.Struct({
  name: Schema.String,
  age: Schema.Finite,
  nickname: Schema.OptionFromNullOr(Schema.String),
  joined: Schema.DateTimeUtcFromString,
});
type Person = typeof Person.Type;

const p = Query.fields<Person>();
const options = { maxLimit: 50 };
const at = (iso: string) => DateTime.makeUnsafe(iso);

const decodeWith =
  (dialect: QueryParams.Dialect, opts: QueryParams.Options<typeof Person.fields> = options) =>
  (search: string | Record<string, string>) =>
    QueryParams.decode(Person, dialect, opts)(new URLSearchParams(search));

const brackets = decodeWith(QueryParams.brackets());
const odata = decodeWith(QueryParams.odata());

const people: ReadonlyArray<Person> = [
  { name: "Ada", age: 36, nickname: Option.some("Countess"), joined: at("2020-01-01T00:00:00Z") },
  { name: "Bo", age: 12, nickname: Option.none(), joined: at("2023-06-01T00:00:00Z") },
  { name: "Cy", age: 70, nickname: Option.some("Prof"), joined: at("2021-03-15T00:00:00Z") },
  { name: "O'Neil", age: 36, nickname: Option.none(), joined: at("2022-01-01T00:00:00Z") },
];
const names = (query: Query.Query<Person>) => Query.run(query, people).map((row) => row.name);

const printBrackets = (filter: Query.Filter<Person>) =>
  QueryParams.brackets().print({
    filter,
    sort: [],
    offset: Option.none(),
    limit: Option.none(),
  });

describe("brackets", () => {
  it.effect("reads equality, operators, lists, presence, sort and the page", () =>
    Effect.gen(function* () {
      const query = yield* brackets(
        "filter[age][gte]=18&filter[name][in]=Ada,Cy,Zed&filter[nickname][present]=true" +
          "&sort=-age,name&page[offset]=0&page[limit]=10&include=friends",
      );
      expect(query.filter).toStrictEqual(
        Query.and(p.gte("age", 18), p.oneOf("name", ["Ada", "Cy", "Zed"]), p.isSome("nickname")),
      );
      expect(query.sort).toStrictEqual([p.desc("age"), p.asc("name")]);
      expect(query.limit).toStrictEqual(Option.some(10));
      expect(names(query)).toStrictEqual(["Cy", "Ada"]);
      expect((yield* brackets("filter[name]=Bo")).filter).toStrictEqual(p.eq("name", "Bo"));
      expect((yield* brackets("filter[nickname][present]=false")).filter).toStrictEqual(
        p.isNone("nickname"),
      );
    }),
  );

  it.effect("decodes each value with its field's string codec", () =>
    Effect.gen(function* () {
      const query = yield* brackets(
        "filter[joined][lt]=2021-06-01T00:00:00Z&filter[nickname]=Prof",
      );
      expect(query.filter).toStrictEqual(
        Query.and(p.lt("joined", at("2021-06-01T00:00:00Z")), p.eq("nickname", "Prof")),
      );
      expect(names(query)).toStrictEqual(["Cy"]);
    }),
  );

  it.effect("takes its parameter names, separator and operator names as options", () =>
    Effect.gen(function* () {
      const dialect = QueryParams.brackets({
        filter: "where",
        sort: "order",
        offset: "skip",
        limit: "take",
        separator: "|",
        operators: { gte: "min", in: "any" },
      });
      const query = yield* decodeWith(dialect)(
        "where[age][min]=18&where[name][any]=Ada|Cy&order=-age&skip=1&take=1",
      );
      expect(names(query)).toStrictEqual(["Ada"]);
      expect((yield* Effect.flip(decodeWith(dialect)("where[age][gte]=18"))).message).toBe(
        'unknown operator "gte"',
      );
    }),
  );

  it.effect("names the parameter at fault", () =>
    Effect.gen(function* () {
      expect(yield* Effect.flip(brackets("filter[age][near]=1"))).toMatchObject({
        parameter: "filter[age][near]",
        message: 'unknown operator "near"',
      });
      expect((yield* Effect.flip(brackets("filter[nickname][present]=yes"))).parameter).toBe(
        "filter[nickname][present]",
      );
      expect((yield* Effect.flip(brackets("sort=age,,name"))).message).toBe(
        'malformed sort key ""',
      );
    }),
  );

  it.effect("round-trips equality, text tests and presence", () =>
    Effect.gen(function* () {
      const query = yield* brackets(
        "filter[name][contains]=y&filter[nickname]=Prof&filter[nickname][present]=true",
      );
      expect(query.filter).toStrictEqual(
        Query.and(p.contains("name", "y"), p.eq("nickname", "Prof"), p.isSome("nickname")),
      );
      const params = yield* QueryParams.encode(Person, QueryParams.brackets(), options)(query);
      expect(params.toString()).toBe(
        "filter%5Bname%5D%5Bcontains%5D=y&filter%5Bnickname%5D=Prof&filter%5Bnickname%5D%5Bpresent%5D=true&page%5Blimit%5D=50",
      );
    }),
  );

  it("cannot print or, a general not, a nested and, or a list value holding the separator", () => {
    expect(Result.isFailure(printBrackets(Query.or(p.eq("name", "A"), p.eq("name", "B"))))).toBe(
      true,
    );
    expect(Result.isFailure(printBrackets(Query.not(p.eq("name", "A"))))).toBe(true);
    expect(
      Result.isFailure(
        printBrackets({ _tag: "And", filters: [Query.and(p.gt("age", 1), p.lt("age", 9))] }),
      ),
    ).toBe(true);
    expect(Result.isFailure(printBrackets(p.oneOf("name", ["a,b"])))).toBe(true);
    expect(Result.map(printBrackets(Query.all), String)).toStrictEqual(Result.succeed(""));
  });
});

describe("odata", () => {
  it.effect("reads comparisons, functions, lists, null tests and the window", () =>
    Effect.gen(function* () {
      const query = yield* odata({
        $filter:
          "age ge 18 and (startswith(name, 'C') or nickname eq null) and name in ('Cy', 'O''Neil')",
        $orderby: "age desc, name",
        $skip: "0",
        $top: "10",
      });
      expect(names(query)).toStrictEqual(["Cy", "O'Neil"]);
      expect(query.sort).toStrictEqual([p.desc("age"), p.asc("name")]);
    }),
  );

  it.effect("binds and tighter than or, and not tightest", () =>
    Effect.gen(function* () {
      const query = yield* odata({ $filter: "name eq 'Bo' or not age lt 36 and nickname ne null" });
      expect(query.filter).toStrictEqual(
        Query.or(p.eq("name", "Bo"), Query.and(Query.not(p.lt("age", 36)), p.isSome("nickname"))),
      );
      expect(names(query)).toStrictEqual(["Ada", "Bo", "Cy"]);
    }),
  );

  it.effect("accepts bare and quoted literals alike; the schema decides", () =>
    Effect.gen(function* () {
      const bare = yield* odata({ $filter: "joined gt 2021-01-01T00:00:00Z and age eq 70" });
      const quoted = yield* odata({ $filter: "joined gt '2021-01-01T00:00:00Z' and age eq '70'" });
      expect(bare.filter).toStrictEqual(quoted.filter);
      expect(names(bare)).toStrictEqual(["Cy"]);
      expect((yield* odata({ $filter: "  " })).filter).toStrictEqual(Query.all);
    }),
  );

  it.effect("reports the offending token of a malformed $filter", () =>
    Effect.gen(function* () {
      const cases: ReadonlyArray<readonly [string, string]> = [
        ["age ge", "expected a value, found end of input"],
        ["age near 1", 'expected an operator, found "near" at 4'],
        ["name eq 'Ada", `unexpected "'" at 8`],
        ["age gt 1 age", 'unexpected "age" at 9'],
        ["(age gt 1", 'expected ")", found end of input'],
        ["age lt null", "lt cannot compare with null"],
        ["name in ('a', null)", 'null is not allowed in a list, at "null" at 14'],
        ["contains(name, null)", "contains needs a string, not null"],
        ["eq eq", "expected a value, found end of input"],
        ["age", "expected an operator, found end of input"],
        [", eq 1", 'expected a field name, found "," at 0'],
      ];
      const messages = yield* Effect.forEach(
        cases,
        ([filter]) => Effect.map(Effect.flip(odata({ $filter: filter })), (error) => error.message),
        { concurrency: 1 },
      );
      expect(messages).toStrictEqual(cases.map(([, message]) => message));
      expect((yield* Effect.flip(odata({ $orderby: "age sideways" }))).message).toBe(
        'malformed sort key "age sideways"',
      );
    }),
  );

  it.effect("takes its parameter names as options", () =>
    Effect.gen(function* () {
      const dialect = QueryParams.odata({ filter: "f", orderby: "o", skip: "s", top: "t" });
      const query = yield* decodeWith(dialect)({ f: "age gt 20", o: "age", s: "1", t: "1" });
      expect(names(query)).toStrictEqual(["O'Neil"]);
    }),
  );
});

describe("the schema step", () => {
  it.effect("maps wire names through aliases, and refuses the struct name it hides", () =>
    Effect.gen(function* () {
      const aliased = decodeWith(QueryParams.brackets(), { ...options, aliases: { age: "years" } });
      expect((yield* aliased("filter[years][gt]=30&sort=years")).sort).toStrictEqual([
        p.asc("age"),
      ]);
      expect((yield* Effect.flip(aliased("filter[age][gt]=30"))).message).toBe(
        'unknown field "age"',
      );
    }),
  );

  it.effect("rejects an unknown field, an undecodable value and an unknown sort field", () =>
    Effect.gen(function* () {
      expect(yield* Effect.flip(brackets("filter[email]=x"))).toMatchObject({
        parameter: "filter",
        message: 'unknown field "email"',
      });
      expect((yield* Effect.flip(brackets("filter[age]=old"))).message).toMatch(/^age: /);
      expect((yield* Effect.flip(odata({ $filter: "joined lt 'yesterday'" }))).message).toMatch(
        /^joined: /,
      );
      expect((yield* Effect.flip(brackets("sort=email"))).parameter).toBe("sort");
    }),
  );

  it.effect("refuses a dialect that hands over a non-string value", () =>
    Effect.gen(function* () {
      const sloppy: QueryParams.Dialect = {
        ...QueryParams.odata(),
        parse: () =>
          Result.succeed({
            filter: { _tag: "Compare", field: "age", op: "eq", value: 1 },
            sort: [],
            offset: Option.none(),
            limit: Option.none(),
          }),
      };
      expect((yield* Effect.flip(decodeWith(sloppy)(""))).message).toBe(
        "age: a dialect must hand over string values",
      );
    }),
  );

  it.effect("bounds the window: whole numbers only, limit at most maxLimit, defaulted", () =>
    Effect.gen(function* () {
      expect((yield* brackets("")).limit).toStrictEqual(Option.some(50));
      const defaulted = decodeWith(QueryParams.brackets(), { ...options, defaultLimit: 20 });
      expect((yield* defaulted("")).limit).toStrictEqual(Option.some(20));
      expect(yield* Effect.flip(brackets("page[limit]=51"))).toMatchObject({
        parameter: "limit",
        message: "at most 50, found 51",
      });
      expect((yield* Effect.flip(brackets("page[offset]=-1"))).parameter).toBe("offset");
      expect((yield* Effect.flip(odata({ $top: "2.5" }))).message).toBe(
        'expected a whole number, found "2.5"',
      );
    }),
  );
});

describe("encode", () => {
  const query = pipe(
    Query.make<Person>(),
    Query.where(p.gte("joined", at("2021-01-01T00:00:00Z"))),
    Query.where(p.oneOf("name", ["Cy", "O'Neil"])),
    Query.where(p.isNone("nickname")),
    Query.orderBy(p.desc("age"), p.asc("name")),
    Query.skip(2),
    Query.take(5),
  );

  it.effect("round-trips through every dialect", () =>
    Effect.gen(function* () {
      const decoded = yield* Effect.forEach(
        [QueryParams.brackets(), QueryParams.odata()],
        (dialect) =>
          Effect.flatMap(QueryParams.encode(Person, dialect, options)(query), (params) =>
            QueryParams.decode(Person, dialect, options)(params),
          ),
        { concurrency: 1 },
      );
      assert.deepStrictEqual(decoded, [query, query]);
    }),
  );

  it.effect("round-trips or, not and quotes through OData, under aliases", () =>
    Effect.gen(function* () {
      const opts = { ...options, aliases: { name: "fullName" } };
      const filter = Query.or(
        Query.not(p.contains("name", "it's")),
        Query.and(p.ne("age", 1), p.isSome("nickname")),
      );
      const withFilter = Query.take(Query.where(Query.make<Person>(), filter), 50);
      const params = yield* QueryParams.encode(Person, QueryParams.odata(), opts)(withFilter);
      expect(params.get("$filter")).toBe(
        "not (contains(fullName, 'it''s')) or (age ne 1 and nickname ne null)",
      );
      assert.deepStrictEqual(
        yield* QueryParams.decode(Person, QueryParams.odata(), opts)(params),
        withFilter,
      );
    }),
  );

  it.effect("fails for a value its field's schema cannot encode", () =>
    Effect.gen(function* () {
      const nan = Query.where(Query.make<Person>(), p.eq("age", Number.NaN));
      const error = yield* Effect.flip(
        QueryParams.encode(Person, QueryParams.odata(), options)(nan),
      );
      expect(error.message).toMatch(/^age: /);
    }),
  );

  it.effect("fails for a field the schema does not know", () =>
    Effect.gen(function* () {
      const stray: Query.Query<Person> = {
        ...Query.make<Person>(),
        filter: { _tag: "Present", field: "email" },
      };
      expect(
        (yield* Effect.flip(QueryParams.encode(Person, QueryParams.odata(), options)(stray)))
          .message,
      ).toBe('unknown field "email"');
    }),
  );
});

describe("one query, any dialect", () => {
  it.effect("reads the same query from brackets and OData", () =>
    Effect.gen(function* () {
      const fromBrackets = yield* brackets(
        "filter[age][gte]=18&filter[nickname][present]=false&sort=-age&page[limit]=5",
      );
      const fromOData = yield* odata({
        $filter: "age ge 18 and nickname eq null",
        $orderby: "age desc",
        $top: "5",
      });
      expect(fromOData).toStrictEqual(fromBrackets);
      expect(names(fromBrackets)).toStrictEqual(["O'Neil"]);
    }),
  );
});

const message = (effect: Effect.Effect<Query.Expr, QueryParams.QueryParamsError>) =>
  Effect.map(Effect.flip(effect), (error) => error.message);

const printConcept = (filter: Query.Expr) =>
  QueryParams.brackets().print({ filter, sort: [], offset: Option.none(), limit: Option.none() });

describe("paths and relationships", () => {
  const Note = Schema.Struct({ text: Schema.String });
  const Concept = Schema.Struct({
    id: Schema.String,
    label: Schema.Struct({
      en: Schema.String,
      alt: Schema.OptionFromNullOr(Schema.Struct({ en: Schema.String })),
    }),
  });
  type Concept = typeof Concept.Type;
  type Note = typeof Note.Type;
  const relationships: Query.Relationships = {
    notes: { schema: Note },
    narrower: { schema: Concept, relationships: () => relationships },
  };
  const conceptOptions: QueryParams.Options<typeof Concept.fields> = {
    maxLimit: 50,
    relationships,
  };
  const c = Query.fields<Concept>();
  const n = Query.fields<Note>();
  const where = (filter: Query.Filter<Concept>) =>
    Query.take(Query.where(Query.make<Concept>(), filter), 50);
  const decodeIn =
    (dialect: QueryParams.Dialect, opts = conceptOptions) =>
    (search: string | Record<string, string>) =>
      Effect.map(
        QueryParams.decode(Concept, dialect, opts)(new URLSearchParams(search)),
        (query) => query.filter,
      );
  const bracketsIn = decodeIn(QueryParams.brackets());
  const odataIn = decodeIn(QueryParams.odata());
  const aboutCat = Query.exists("notes", n.contains("text", "cat"));

  it.effect("reads a dotted path as a nested field, and through a relationship as Exists", () =>
    Effect.gen(function* () {
      expect(yield* bracketsIn("filter[label.en]=Cat")).toStrictEqual(c.eq("label.en", "Cat"));
      expect(yield* bracketsIn("filter[label.alt.en][startsWith]=Fel")).toStrictEqual(
        c.startsWith("label.alt.en", "Fel"),
      );
      expect(yield* bracketsIn("filter[notes.text][contains]=cat")).toStrictEqual(aboutCat);
      expect(yield* bracketsIn("filter[narrower.notes.text][contains]=cat")).toStrictEqual(
        Query.exists("narrower", aboutCat),
      );
      expect(yield* bracketsIn("filter[notes.text][present]=false")).toStrictEqual(
        Query.not(Query.exists("notes", { _tag: "Present", field: "text" })),
      );
      // Two parameters through one relationship are two Exists: each may match another note.
      expect(
        yield* bracketsIn("filter[notes.text][contains]=cat&filter[notes.text][endsWith]=s"),
      ).toStrictEqual(Query.and(aboutCat, Query.exists("notes", n.endsWith("text", "s"))));
    }),
  );

  it.effect("reads OData paths and the any / all lambdas", () =>
    Effect.gen(function* () {
      expect(yield* odataIn({ $filter: "label/alt/en eq 'Feline'" })).toStrictEqual(
        c.eq("label.alt.en", "Feline"),
      );
      expect(yield* odataIn({ $filter: "notes/any(x: contains(x/text, 'cat'))" })).toStrictEqual(
        aboutCat,
      );
      expect(yield* odataIn({ $filter: "notes/any()" })).toStrictEqual(
        Query.exists("notes", Query.all),
      );
      expect(
        yield* odataIn({
          $filter: "narrower/any(a : a/id eq 'kitten' and a/notes/any(b: contains(b/text, 'cat')))",
        }),
      ).toStrictEqual(Query.exists("narrower", Query.and(c.eq("id", "kitten"), aboutCat)));
      expect(yield* odataIn({ $filter: "notes/all(x: contains(x/text, 'cat'))" })).toStrictEqual(
        Query.not(Query.exists("notes", Query.not(n.contains("text", "cat")))),
      );
      // A path through a relationship outside a lambda is an Exists too.
      expect(yield* odataIn({ $filter: "notes/text eq 'a'" })).toStrictEqual(
        Query.exists("notes", n.eq("text", "a")),
      );
    }),
  );

  it.effect(
    "refuses unknown relationships and fields, and paths outside the lambda's variable",
    () =>
      Effect.gen(function* () {
        expect(yield* message(odataIn({ $filter: "parents/any()" }))).toBe(
          'unknown relationship "parents"',
        );
        expect(yield* message(bracketsIn("filter[notes.title]=x"))).toBe('unknown field "title"');
        expect(yield* message(bracketsIn("filter[label.fr]=Chat"))).toBe(
          'unknown field "label.fr"',
        );
        expect(yield* message(odataIn({ $filter: "notes/any(x: text eq 'a')" }))).toBe(
          'inside a lambda a path starts with "x/", found "text" at 13',
        );
        expect(
          yield* message(odataIn({ $filter: "narrower/any(x: x/notes/any(y: x/id eq 'a'))" })),
        ).toBe('inside a lambda a path starts with "y/", found "x/id" at 31');
        expect(yield* message(odataIn({ $filter: "notes/any(1: true)" }))).toBe(
          'expected a lambda variable, found "1:" at 10',
        );
        expect(yield* message(odataIn({ $filter: "label/alt/any()" }))).toBe(
          'a lambda crosses one relationship, found "label/alt"',
        );
        // Without declared relationships, a relationship path is an unknown field.
        expect(
          yield* message(
            decodeIn(QueryParams.brackets(), { maxLimit: 50 })("filter[notes.text]=x"),
          ),
        ).toBe('unknown field "notes.text"');
      }),
  );

  it.effect("maps an alias on a path's first segment", () =>
    Effect.gen(function* () {
      const aliased = decodeIn(QueryParams.brackets(), {
        ...conceptOptions,
        aliases: { label: "name" },
      });
      expect(yield* aliased("filter[name.en]=Cat")).toStrictEqual(c.eq("label.en", "Cat"));
      const encode = QueryParams.encode(Concept, QueryParams.brackets(), {
        ...conceptOptions,
        aliases: { label: "name" },
      });
      expect(decodeURIComponent(String(yield* encode(where(c.eq("label.en", "Cat")))))).toBe(
        "filter[name.en]=Cat&page[limit]=50",
      );
    }),
  );

  it.effect("prints relationships in each dialect's spelling", () =>
    Effect.gen(function* () {
      const query = where(Query.exists("narrower", aboutCat));
      const inBrackets = yield* QueryParams.encode(
        Concept,
        QueryParams.brackets(),
        conceptOptions,
      )(query);
      const inOData = yield* QueryParams.encode(
        Concept,
        QueryParams.odata(),
        conceptOptions,
      )(query);
      expect(inBrackets.get("filter[narrower.notes.text][contains]")).toBe("cat");
      expect(inOData.get("$filter")).toBe(
        "narrower/any(x: x/notes/any(x1: contains(x1/text, 'cat')))",
      );
    }),
  );

  it("cannot print an Exists over anything but one test in brackets", () => {
    expect(Result.isFailure(printConcept(Query.exists("notes", Query.all)))).toBe(true);
    expect(
      Result.isFailure(
        printConcept(Query.exists("notes", Query.and(n.eq("text", "a"), n.contains("text", "b")))),
      ),
    ).toBe(true);
    expect(
      Result.isFailure(printConcept(Query.not(Query.exists("notes", n.eq("text", "a"))))),
    ).toBe(true);
  });

  it.effect("round-trips paths and relationships through both dialects", () =>
    Effect.gen(function* () {
      const both: ReadonlyArray<Query.Filter<Concept>> = [
        c.eq("label.alt.en", "Feline"),
        Query.and(c.oneOf("label.en", ["Cat", "Kitten"]), aboutCat),
        Query.exists("narrower", Query.exists("notes", n.eq("text", "a"))),
        Query.not(Query.exists("notes", { _tag: "Present", field: "text" })),
      ];
      const odataOnly: ReadonlyArray<Query.Filter<Concept>> = [
        Query.exists("notes", Query.all),
        Query.exists("notes", Query.or(n.eq("text", "a"), n.eq("text", "b"))),
        Query.or(aboutCat, Query.exists("narrower", Query.and(c.eq("id", "kitten"), aboutCat))),
        Query.not(Query.exists("notes", Query.not(n.contains("text", "cat")))),
      ];
      const roundTrip = (dialect: QueryParams.Dialect, filter: Query.Filter<Concept>) =>
        Effect.flatMap(
          QueryParams.encode(Concept, dialect, conceptOptions)(where(filter)),
          QueryParams.decode(Concept, dialect, conceptOptions),
        );
      const filters = (dialect: QueryParams.Dialect, cases: ReadonlyArray<Query.Filter<Concept>>) =>
        Effect.forEach(cases, (filter) => Effect.map(roundTrip(dialect, filter), (q) => q.filter), {
          concurrency: 1,
        });
      expect(yield* filters(QueryParams.brackets(), both)).toStrictEqual(both);
      expect(yield* filters(QueryParams.odata(), [...both, ...odataOnly])).toStrictEqual([
        ...both,
        ...odataOnly,
      ]);
    }),
  );
});
