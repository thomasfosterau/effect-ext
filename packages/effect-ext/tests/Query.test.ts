/**
 * @copyright Thomas Foster
 *
 * `Query`: the filter combinators' simplifications, the in-memory evaluator
 * (every operator, `Option` and date fields, mismatched kinds), sorting and
 * windowing, the wire codecs, and a toy SQL compiler that shows a backend can
 * walk the same tree.
 *
 * @module tests/Query
 */

import { describe, expect, it } from "vite-plus/test";
import { pipe } from "effect/Function";
import * as Arr from "effect/Array";
import * as Chunk from "effect/Chunk";
import * as DateTime from "effect/DateTime";
import * as Exit from "effect/Exit";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Query } from "@thomasfosterau/effect-ext";

const Person = Schema.Struct({
  name: Schema.String,
  age: Schema.Finite,
  nickname: Schema.Option(Schema.String),
  joined: Schema.DateTimeUtc,
});
type Person = typeof Person.Type;

const at = (iso: string): DateTime.Utc => DateTime.makeUnsafe(iso);

const ada: Person = {
  name: "Ada",
  age: 36,
  nickname: Option.some("Countess"),
  joined: at("2020-01-01T00:00:00Z"),
};
const bo: Person = {
  name: "Bo",
  age: 12,
  nickname: Option.none(),
  joined: at("2023-06-01T00:00:00Z"),
};
const cy: Person = {
  name: "Cy",
  age: 70,
  nickname: Option.some("Prof"),
  joined: at("2021-03-15T00:00:00Z"),
};
const di: Person = {
  name: "Di",
  age: 36,
  nickname: Option.none(),
  joined: at("2022-01-01T00:00:00Z"),
};
const people = [ada, bo, cy, di];

const p = Query.fields<Person>();
const names = (rows: ReadonlyArray<Person>) => Arr.map(rows, (row) => row.name);
const filtered = (filter: Query.Filter<Person>) =>
  names(Query.run(Query.where(Query.make<Person>(), filter), people));

describe("combinators", () => {
  it("and drops All, flattens nested Ands and unwraps a single child", () => {
    const a = p.gt("age", 1);
    const b = p.lt("age", 50);
    expect(Query.and()).toStrictEqual(Query.all);
    expect(Query.and(Query.all, a)).toStrictEqual(a);
    expect(Query.and(Query.and(a, b), a)).toStrictEqual({ _tag: "And", filters: [a, b, a] });
  });

  it("or flattens nested Ors; or() matches nothing", () => {
    const a = p.eq("name", "Ada");
    const b = p.eq("name", "Bo");
    expect(Query.or(a)).toStrictEqual(a);
    expect(Query.or(Query.or(a, b), a)).toStrictEqual({ _tag: "Or", filters: [a, b, a] });
    expect(filtered(Query.or())).toStrictEqual([]);
  });

  it("not removes a double negation", () => {
    const a = p.eq("name", "Ada");
    expect(Query.not(Query.not(a))).toStrictEqual(a);
    expect(filtered(Query.not(a))).toStrictEqual(["Bo", "Cy", "Di"]);
  });

  it("where ands onto the existing filter", () => {
    const q = pipe(
      Query.make<Person>(),
      Query.where(p.gte("age", 18)),
      Query.where(p.lt("age", 50)),
    );
    expect(names(Query.run(q, people))).toStrictEqual(["Ada", "Di"]);
  });
});

describe("evaluation", () => {
  it("compares numbers with every ordering operator", () => {
    expect(filtered(p.eq("age", 36))).toStrictEqual(["Ada", "Di"]);
    expect(filtered(p.ne("age", 36))).toStrictEqual(["Bo", "Cy"]);
    expect(filtered(p.lt("age", 36))).toStrictEqual(["Bo"]);
    expect(filtered(p.lte("age", 36))).toStrictEqual(["Ada", "Bo", "Di"]);
    expect(filtered(p.gt("age", 36))).toStrictEqual(["Cy"]);
    expect(filtered(p.gte("age", 36))).toStrictEqual(["Ada", "Cy", "Di"]);
  });

  it("matches membership with oneOf, by Equal.equals", () => {
    expect(filtered(p.oneOf("name", ["Bo", "Cy", "Zed"]))).toStrictEqual(["Bo", "Cy"]);
    expect(filtered(p.oneOf("name", []))).toStrictEqual([]);
    expect(filtered(p.oneOf("nickname", ["Prof", "Zed"]))).toStrictEqual(["Cy"]);
  });

  it("tests text, looking inside an Option and skipping None", () => {
    expect(filtered(p.contains("name", "y"))).toStrictEqual(["Cy"]);
    expect(filtered(p.startsWith("nickname", "Co"))).toStrictEqual(["Ada"]);
    expect(filtered(p.endsWith("nickname", "f"))).toStrictEqual(["Cy"]);
  });

  it("compares an Option field by its inner value, as SQL compares a nullable column", () => {
    expect(filtered(p.gte("nickname", "P"))).toStrictEqual(["Cy"]);
    expect(filtered(p.lt("nickname", "zzz"))).toStrictEqual(["Ada", "Cy"]);
    expect(filtered(p.eq("nickname", "Prof"))).toStrictEqual(["Cy"]);
    // None is NULL: not even `ne` matches it.
    expect(filtered(p.ne("nickname", "Prof"))).toStrictEqual(["Ada"]);
  });

  it("tests presence with isSome / isNone", () => {
    expect(filtered(p.isSome("nickname"))).toStrictEqual(["Ada", "Cy"]);
    expect(filtered(p.isNone("nickname"))).toStrictEqual(["Bo", "Di"]);
  });

  it("orders and equates DateTimes", () => {
    expect(filtered(p.gte("joined", at("2022-01-01T00:00:00Z")))).toStrictEqual(["Bo", "Di"]);
    expect(filtered(p.eq("joined", at("2020-01-01T00:00:00Z")))).toStrictEqual(["Ada"]);
  });

  it("orders and equates bigints and booleans", () => {
    interface Row {
      readonly big: bigint;
      readonly flag: boolean;
    }
    const r = Query.fields<Row>();
    const rows: ReadonlyArray<Row> = [
      { big: 1n, flag: false },
      { big: 5n, flag: true },
    ];
    const count = (filter: Query.Filter<Row>) =>
      Query.run(Query.where(Query.make<Row>(), filter), rows).length;
    expect(count(r.eq("big", 5n))).toBe(1);
    expect(count(r.gte("big", 1n))).toBe(2);
    expect(count(r.gt("flag", false))).toBe(1);
  });

  it("never matches an ordering between different kinds, or a missing field", () => {
    // A decoded filter is untyped data; a mismatch is a miss, not a throw.
    const mismatched: Query.Filter<Person> = {
      _tag: "Compare",
      field: "age",
      op: "gt",
      value: "1",
    };
    const missing: Query.Filter<Person> = { _tag: "Compare", field: "height", op: "gt", value: 1 };
    const onNumber: Query.Filter<Person> = {
      _tag: "Text",
      field: "age",
      op: "contains",
      value: "3",
    };
    expect(filtered(mismatched)).toStrictEqual([]);
    expect(filtered(missing)).toStrictEqual([]);
    expect(filtered(onNumber)).toStrictEqual([]);
  });

  it("reads own properties only, never the prototype chain", () => {
    const viaPrototype: Query.Filter<Person> = {
      _tag: "Compare",
      field: "constructor",
      op: "eq",
      value: Object,
    };
    expect(filtered(viaPrototype)).toStrictEqual([]);
    expect(Query.toPredicate(p.eq("age", 1))(Object.create({ age: 1 }))).toBe(false);
  });
});

describe("sorting and windowing", () => {
  it("sorts by keys in order, each breaking the ties of the ones before", () => {
    const q = pipe(
      Query.make<Person>(),
      Query.orderBy(p.desc("age")),
      Query.orderBy(p.asc("name")),
    );
    expect(names(Query.run(q, people))).toStrictEqual(["Cy", "Ada", "Di", "Bo"]);
  });

  it("keeps input order when no key is given, and is stable on ties", () => {
    expect(names(Query.run(Query.make<Person>(), people))).toStrictEqual(["Ada", "Bo", "Cy", "Di"]);
    const q = pipe(Query.make<Person>(), Query.orderBy(p.asc("age")));
    expect(names(Query.run(q, people))).toStrictEqual(["Bo", "Ada", "Di", "Cy"]);
  });

  it("sorts None before Some ascending and after it descending", () => {
    const asc = pipe(Query.make<Person>(), Query.orderBy(p.asc("nickname")));
    const desc = pipe(Query.make<Person>(), Query.orderBy(p.desc("nickname")));
    expect(names(Query.run(asc, people))).toStrictEqual(["Bo", "Di", "Ada", "Cy"]);
    expect(names(Query.run(desc, people))).toStrictEqual(["Cy", "Ada", "Bo", "Di"]);
  });

  it("ties values of different kinds, keeping their input order", () => {
    type Row = { readonly v: number | string };
    const rows: ReadonlyArray<Row> = [{ v: "a" }, { v: 1 }];
    const v = Query.fields<Row>();
    expect(Query.run(Query.orderBy(v.asc("v"))(Query.make<Row>()), rows)).toStrictEqual(rows);
    expect(Query.run(Query.orderBy(v.desc("v"))(Query.make<Row>()), rows)).toStrictEqual(rows);
  });

  it("sorts DateTimes", () => {
    const q = pipe(Query.make<Person>(), Query.orderBy(p.asc("joined")));
    expect(names(Query.run(q, people))).toStrictEqual(["Ada", "Cy", "Di", "Bo"]);
  });

  it("composes skip and take the way chained LINQ Skip / Take do", () => {
    const xs = [1, 2, 3, 4, 5, 6];
    const run = (...steps: ReadonlyArray<(q: Query.Query<number>) => Query.Query<number>>) =>
      Query.run(
        Arr.reduce(steps, Query.make<number>(), (q, step) => step(q)),
        xs,
      );
    expect(run(Query.skip(2))).toStrictEqual([3, 4, 5, 6]);
    expect(run(Query.take(2))).toStrictEqual([1, 2]);
    expect(run(Query.skip(1), Query.skip(1), Query.take(2))).toStrictEqual([3, 4]);
    // Skipping inside a window shrinks it: Take(4).Skip(1) is [2, 3, 4].
    expect(run(Query.take(4), Query.skip(1))).toStrictEqual([2, 3, 4]);
    expect(run(Query.take(2), Query.skip(5))).toStrictEqual([]);
    expect(run(Query.take(5), Query.take(2), Query.take(4))).toStrictEqual([1, 2]);
  });

  it("truncates negative, fractional and non-finite counts", () => {
    expect(Query.skip(Query.make<number>(), -3).offset).toBe(0);
    expect(Query.skip(Query.make<number>(), 2.9).offset).toBe(2);
    expect(Query.take(Query.make<number>(), Number.NaN).limit).toStrictEqual(Option.some(0));
  });

  it("runs over any iterable, data-first or data-last", () => {
    const q = Query.where(Query.make<Person>(), p.gt("age", 30));
    expect(names(pipe(q, Query.run(Chunk.fromIterable(people))))).toStrictEqual([
      "Ada",
      "Cy",
      "Di",
    ]);
  });
});

describe("FilterFor", () => {
  const PersonFilter = Query.FilterFor(Person);
  const decode = Schema.decodeUnknownExit(PersonFilter);
  const Json = Schema.fromJsonString(PersonFilter);

  it("decodes a nested tree, each value through its field's JSON codec", () => {
    const filter = Schema.decodeSync(PersonFilter)({
      _tag: "And",
      filters: [
        { _tag: "Compare", field: "joined", op: "lt", value: "2022-06-01T00:00:00Z" },
        { _tag: "Not", filter: { _tag: "In", field: "name", values: ["Cy"] } },
        {
          _tag: "Compare",
          field: "nickname",
          op: "eq",
          value: "Countess",
        },
      ],
    });
    expect(filtered(filter)).toStrictEqual(["Ada"]);
  });

  it("rejects an unknown field, a value of the wrong type and an unknown operator", () => {
    expect(Exit.isFailure(decode({ _tag: "Compare", field: "email", op: "eq", value: "x" }))).toBe(
      true,
    );
    expect(Exit.isFailure(decode({ _tag: "Compare", field: "age", op: "eq", value: "36" }))).toBe(
      true,
    );
    expect(Exit.isFailure(decode({ _tag: "Compare", field: "age", op: "like", value: 36 }))).toBe(
      true,
    );
    expect(Exit.isFailure(decode({ _tag: "Or", filters: [{ _tag: "Nope" }] }))).toBe(true);
  });

  it("round-trips a built filter through its wire form", () => {
    const filter = Query.and(
      p.gte("joined", at("2021-01-01T00:00:00Z")),
      Query.or(p.contains("name", "a"), p.isSome("nickname")),
      Query.all,
    );
    const text = Schema.encodeSync(Json)(filter);
    expect(text).toContain('"value":"2021-01-01T00:00:00.000Z"');
    expect(filtered(Schema.decodeSync(Json)(text))).toStrictEqual(filtered(filter));
  });
});

describe("QueryFor", () => {
  it("round-trips a whole query through JSON, with no limit as an absent key", () => {
    const Json = Schema.fromJsonString(Query.QueryFor(Person));
    const query = pipe(
      Query.make<Person>(),
      Query.where(p.isNone("nickname")),
      Query.orderBy(p.desc("joined")),
      Query.skip(1),
    );
    const text = Schema.encodeSync(Json)(query);
    expect(text).not.toContain("limit");
    expect(Schema.decodeSync(Json)(text)).toStrictEqual(query);
    const limited = Query.take(query, 3);
    expect(Schema.decodeSync(Json)(Schema.encodeSync(Json)(limited))).toStrictEqual(limited);
    expect(
      Exit.isFailure(Schema.decodeExit(Json)('{"filter":{"_tag":"All"},"sort":[],"offset":-1}')),
    ).toBe(true);
  });
});

describe("valueSchema", () => {
  it("is a field's own type, or an Option field's inner type", () => {
    expect(Schema.is(Query.valueSchema(Schema.Finite))(1)).toBe(true);
    expect(Schema.is(Query.valueSchema(Schema.Option(Schema.String)))("x")).toBe(true);
    expect(
      Schema.is(Query.valueSchema(Schema.OptionFromNullOr(Schema.String)))(Option.none()),
    ).toBe(false);
  });
});

describe("SortFor", () => {
  const decode = Schema.decodeUnknownExit(Query.SortFor(Person));

  it("decodes sort keys and rejects an unknown field or direction", () => {
    expect(decode([{ field: "age", direction: "desc" }])).toStrictEqual(
      Exit.succeed([{ field: "age", direction: "desc" }]),
    );
    expect(Exit.isFailure(decode([{ field: "email", direction: "asc" }]))).toBe(true);
    expect(Exit.isFailure(decode([{ field: "age", direction: "up" }]))).toBe(true);
  });
});

describe("a backend walks the same tree", () => {
  // A toy compiler to SQL text with positional parameters: what a real
  // backend (effect's `SqlClient`, an index) would do with the `Expr`.
  const toSql = (expr: Query.Expr, params: Array<unknown>): string =>
    Match.valueTags(expr, {
      All: () => "TRUE",
      Compare: (node) => {
        params.push(node.value);
        const op = { eq: "=", ne: "<>", lt: "<", lte: "<=", gt: ">", gte: ">=" }[node.op];
        return `${node.field} ${op} ?`;
      },
      In: (node) => {
        params.push(...node.values);
        return `${node.field} IN (${Arr.map(node.values, () => "?").join(", ")})`;
      },
      Text: (node) => {
        params.push(node.value);
        return `${node.field} LIKE ?`;
      },
      Present: (node) => `${node.field} IS NOT NULL`,
      And: (node) => `(${Arr.map(node.filters, (child) => toSql(child, params)).join(" AND ")})`,
      Or: (node) => `(${Arr.map(node.filters, (child) => toSql(child, params)).join(" OR ")})`,
      Not: (node) => `NOT ${toSql(node.filter, params)}`,
    });

  it("compiles a filter to SQL", () => {
    const params: Array<unknown> = [];
    const sql = toSql(
      Query.and(p.gte("age", 18), Query.not(p.oneOf("name", ["Bo", "Cy"]))),
      params,
    );
    expect(sql).toBe("(age >= ? AND NOT name IN (?, ?))");
    expect(params).toStrictEqual([18, "Bo", "Cy"]);
  });
});
