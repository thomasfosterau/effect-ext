/**
 * The OData `$filter` subset `QueryParams.odata` reads and writes: a
 * recursive-descent parser over a token array, and a printer. Values stay the
 * strings they were written as; the schema decodes them afterwards. OData's
 * `/` path separator is `Query`'s `.`, and `rel/any(x: …)` is an `Exists`.
 */

import * as Arr from "effect/Array";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as R from "effect/Record";
import * as Result from "effect/Result";
import type * as Query from "../../Query.ts";

interface Token {
  readonly kind: "string" | "punct" | "word";
  readonly text: string;
  readonly offset: number;
}

type Step<A> = Result.Result<readonly [A, number], string>;

/** The tokens, and the innermost lambda variable the paths here must start with. */
interface Ctx {
  readonly tokens: ReadonlyArray<Token>;
  readonly variable: Option.Option<string>;
}

type Parser<A> = (ctx: Ctx, i: number) => Step<A>;

const LAMBDA = /^(.+)\/(any|all)$/;
const VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*$/;

const COMPARE = {
  eq: "eq",
  ne: "ne",
  lt: "lt",
  le: "lte",
  gt: "gt",
  ge: "gte",
} satisfies Readonly<Record<string, Query.CompareOp>>;

const COMPARE_WIRE: Readonly<Record<Query.CompareOp, string>> = {
  eq: "eq",
  ne: "ne",
  lt: "lt",
  lte: "le",
  gt: "gt",
  gte: "ge",
};

const TEXT = {
  contains: "contains",
  startswith: "startsWith",
  endswith: "endsWith",
} satisfies Readonly<Record<string, Query.TextOp>>;

const TEXT_WIRE: Readonly<Record<Query.TextOp, string>> = {
  contains: "contains",
  startsWith: "startswith",
  endsWith: "endswith",
};

/** Splits `$filter` text into tokens, or names the offset of the first bad character. */
const tokenize = (input: string): Result.Result<ReadonlyArray<Token>, string> => {
  const matches = Arr.fromIterable(
    input.matchAll(/\s+|('(?:[^']|'')*')|([(),])|([^\s(),']+)|([\s\S])/g),
  );
  return Arr.reduce(
    matches,
    Result.succeed<Array<Token>>([]),
    (acc, match): Result.Result<Array<Token>, string> =>
      Result.flatMap(acc, (tokens) => {
        const offset = match.index;
        if (match[4] !== undefined) {
          return Result.fail(`unexpected ${quote(match[4])} at ${offset}`);
        }
        if (match[1] !== undefined) {
          return Result.succeed([...tokens, { kind: "string", text: match[1], offset }]);
        }
        if (match[2] !== undefined) {
          return Result.succeed([...tokens, { kind: "punct", text: match[2], offset }]);
        }
        if (match[3] !== undefined) {
          return Result.succeed([...tokens, { kind: "word", text: match[3], offset }]);
        }
        return Result.succeed(tokens);
      }),
  );
};

const quote = (text: string): string => `"${text}"`;

const at = (tokens: ReadonlyArray<Token>, i: number): Option.Option<Token> => Arr.get(tokens, i);

const is = (tokens: ReadonlyArray<Token>, i: number, text: string): boolean =>
  Option.exists(at(tokens, i), (token) => token.kind !== "string" && token.text === text);

const describe = (tokens: ReadonlyArray<Token>, i: number): string =>
  Option.match(at(tokens, i), {
    onNone: () => "end of input",
    onSome: (token) => `${quote(token.text)} at ${token.offset}`,
  });

const expectToken = (tokens: ReadonlyArray<Token>, i: number, text: string): Step<undefined> =>
  is(tokens, i, text)
    ? Result.succeed([undefined, i + 1])
    : Result.fail(`expected ${quote(text)}, found ${describe(tokens, i)}`);

const unquote = (text: string): string => text.slice(1, -1).replaceAll("''", "'");

/** An OData path as a `Query` path: the lambda variable stripped, `/` as `.`. */
const toPath = (ctx: Ctx, token: Token): Result.Result<string, string> => {
  const segments = token.text.split("/");
  const relative = Option.match(ctx.variable, {
    onNone: () => Result.succeed(segments),
    onSome: (variable) =>
      segments[0] === variable && segments.length > 1
        ? Result.succeed(Arr.drop(segments, 1))
        : Result.fail(
            `inside a lambda a path starts with ${quote(`${variable}/`)}, found ${quote(token.text)} at ${token.offset}`,
          ),
  });
  return Result.flatMap(relative, (rest) =>
    Arr.some(rest, (segment) => segment === "")
      ? Result.fail(`malformed path ${quote(token.text)} at ${token.offset}`)
      : Result.succeed(rest.join(".")),
  );
};

const identifier: Parser<string> = (ctx, i) =>
  Option.match(
    Option.filter(at(ctx.tokens, i), (token) => token.kind === "word"),
    {
      onNone: () => Result.fail(`expected a field name, found ${describe(ctx.tokens, i)}`),
      onSome: (token) => Result.map(toPath(ctx, token), (path) => [path, i + 1] as const),
    },
  );

/** A literal: a quoted string, or a bare word (`null` is `None`). */
const literal = (tokens: ReadonlyArray<Token>, i: number): Step<Option.Option<string>> =>
  Option.match(
    Option.filter(at(tokens, i), (token) => token.kind !== "punct"),
    {
      onNone: () => Result.fail(`expected a value, found ${describe(tokens, i)}`),
      onSome: (token) =>
        Result.succeed([
          token.kind === "string"
            ? Option.some(unquote(token.text))
            : token.text === "null"
              ? Option.none()
              : Option.some(token.text),
          i + 1,
        ]),
    },
  );

const listRest = (
  tokens: ReadonlyArray<Token>,
  acc: ReadonlyArray<string>,
  i: number,
): Step<ReadonlyArray<string>> =>
  Result.flatMap(literal(tokens, i), ([value, j]) =>
    Option.match(value, {
      onNone: () => Result.fail(`null is not allowed in a list, at ${describe(tokens, i)}`),
      onSome: (text) =>
        is(tokens, j, ",")
          ? listRest(tokens, [...acc, text], j + 1)
          : Result.map(expectToken(tokens, j, ")"), ([, k]) => [[...acc, text], k] as const),
    }),
  );

const textCall = (ctx: Ctx, i: number, op: Query.TextOp): Step<Query.Expr> =>
  Result.gen(function* () {
    const { tokens } = ctx;
    const [, a] = yield* expectToken(tokens, i, "(");
    const [field, b] = yield* identifier(ctx, a);
    const [, c] = yield* expectToken(tokens, b, ",");
    const [value, d] = yield* literal(tokens, c);
    const [, e] = yield* expectToken(tokens, d, ")");
    const text = yield* Option.match(value, {
      onNone: () => Result.fail(`${TEXT_WIRE[op]} needs a string, not null`),
      onSome: (string) => Result.succeed(string),
    });
    return [{ _tag: "Text", field, op, value: text }, e] as const;
  });

const comparison: Parser<Query.Expr> = (ctx, i) =>
  Result.gen(function* () {
    const { tokens } = ctx;
    const [field, a] = yield* identifier(ctx, i);
    if (is(tokens, a, "in")) {
      const [, b] = yield* expectToken(tokens, a + 1, "(");
      const [values, c] = yield* listRest(tokens, [], b);
      return [{ _tag: "In", field, values }, c] as const;
    }
    const opWord = Option.getOrElse(
      Option.map(at(tokens, a), (token) => token.text),
      () => "",
    );
    const op = yield* Option.match(R.get<string, Query.CompareOp>(COMPARE, opWord), {
      onNone: () => Result.fail(`expected an operator, found ${describe(tokens, a)}`),
      onSome: (compareOp) => Result.succeed(compareOp),
    });
    const [value, b] = yield* literal(tokens, a + 1);
    const node = yield* Option.match(value, {
      onSome: (text): Result.Result<Query.Expr, string> =>
        Result.succeed({ _tag: "Compare", field, op, value: text }),
      onNone: () =>
        Match.value(op).pipe(
          Match.when("eq", (): Result.Result<Query.Expr, string> =>
            Result.succeed({ _tag: "Not", filter: { _tag: "Present", field } }),
          ),
          Match.when("ne", (): Result.Result<Query.Expr, string> =>
            Result.succeed({ _tag: "Present", field }),
          ),
          Match.orElse(() => Result.fail(`${opWord} cannot compare with null`)),
        ),
    });
    return [node, b] as const;
  });

/** The `x:` that opens a lambda's body, written `x:` or `x :`. */
const lambdaVariable: Parser<string> = (ctx, i) => {
  const { tokens } = ctx;
  const word = Option.filter(at(tokens, i), (token) => token.kind === "word");
  const joined = Option.flatMap(word, (token) =>
    Option.fromNullOr(/^(.*):$/.exec(token.text)?.[1] ?? null),
  );
  const [variable, next] = Option.match(joined, {
    onSome: (name) => [Option.some(name), i + 1] as const,
    onNone: () =>
      is(tokens, i + 1, ":")
        ? ([Option.map(word, (token) => token.text), i + 2] as const)
        : ([Option.none<string>(), i] as const),
  });
  return Option.match(
    Option.filter(variable, (name) => VARIABLE.test(name)),
    {
      onNone: () => Result.fail(`expected a lambda variable, found ${describe(tokens, i)}`),
      onSome: (name) => Result.succeed([name, next] as const),
    },
  );
};

/** `rel/any()`, `rel/any(x: body)` or `rel/all(x: body)`, after the path token. */
const lambda = (
  ctx: Ctx,
  i: number,
  relationship: string,
  quantifier: "any" | "all",
): Step<Query.Expr> =>
  Result.gen(function* () {
    const { tokens } = ctx;
    const [, a] = yield* expectToken(tokens, i, "(");
    if (quantifier === "any" && is(tokens, a, ")")) {
      return [{ _tag: "Exists", relationship, filter: { _tag: "All" } }, a + 1] as const;
    }
    const [variable, b] = yield* lambdaVariable(ctx, a);
    const [body, c] = yield* or({ tokens, variable: Option.some(variable) }, b);
    const [, d] = yield* expectToken(tokens, c, ")");
    const node: Query.Expr =
      quantifier === "any"
        ? { _tag: "Exists", relationship, filter: body }
        : // Every related record matches: none fails to.
          {
            _tag: "Not",
            filter: { _tag: "Exists", relationship, filter: { _tag: "Not", filter: body } },
          };
    return [node, d] as const;
  });

const primary: Parser<Query.Expr> = (ctx, i) => {
  const { tokens } = ctx;
  if (is(tokens, i, "(")) {
    return Result.flatMap(or(ctx, i + 1), ([node, j]) =>
      Result.map(expectToken(tokens, j, ")"), ([, k]) => [node, k] as const),
    );
  }
  const word = Option.filter(
    at(tokens, i),
    (token) => token.kind === "word" && is(tokens, i + 1, "("),
  );
  const quantified = Option.flatMap(word, (token) =>
    Option.map(Option.fromNullOr(LAMBDA.exec(token.text)), (match) => ({
      token: { ...token, text: match[1] ?? "" },
      quantifier: match[2] === "all" ? ("all" as const) : ("any" as const),
    })),
  );
  return Option.match(quantified, {
    onSome: ({ token, quantifier }) =>
      Result.flatMap(toPath(ctx, token), (relationship) =>
        relationship.includes(".")
          ? Result.fail(`a lambda crosses one relationship, found ${quote(token.text)}`)
          : lambda(ctx, i + 1, relationship, quantifier),
      ),
    onNone: () =>
      Option.match(
        Option.flatMap(word, (token) => R.get<string, Query.TextOp>(TEXT, token.text)),
        {
          onNone: () => comparison(ctx, i),
          onSome: (op) => textCall(ctx, i + 1, op),
        },
      ),
  });
};

const unary: Parser<Query.Expr> = (ctx, i) =>
  is(ctx.tokens, i, "not")
    ? Result.map(unary(ctx, i + 1), ([filter, j]) => [{ _tag: "Not", filter }, j] as const)
    : primary(ctx, i);

const chain =
  (keyword: "and" | "or", operand: Parser<Query.Expr>): Parser<Query.Expr> =>
  (ctx, i) => {
    const rest = (acc: Arr.NonEmptyReadonlyArray<Query.Expr>, j: number): Step<Query.Expr> =>
      is(ctx.tokens, j, keyword)
        ? Result.flatMap(operand(ctx, j + 1), ([node, k]) => rest(Arr.append(acc, node), k))
        : Result.succeed([
            acc.length === 1
              ? Arr.headNonEmpty(acc)
              : { _tag: keyword === "and" ? "And" : "Or", filters: acc },
            j,
          ]);
    return Result.flatMap(operand(ctx, i), ([first, j]) => rest([first], j));
  };

const and = chain("and", unary);
const or: Parser<Query.Expr> = chain("or", and);

/** Parses `$filter` text into a filter tree whose values are still strings. */
export const parseFilter = (input: string): Result.Result<Query.Expr, string> =>
  Result.flatMap(tokenize(input), (tokens) =>
    Arr.isReadonlyArrayNonEmpty(tokens)
      ? Result.flatMap(or({ tokens, variable: Option.none() }, 0), ([node, i]) =>
          i === tokens.length
            ? Result.succeed(node)
            : Result.fail(`unexpected ${describe(tokens, i)}`),
        )
      : Result.succeed({ _tag: "All" }),
  );

const printLiteral = (value: string): string =>
  /^-?\d+(?:\.\d+)?$|^true$|^false$/.test(value) ? value : `'${value.replaceAll("'", "''")}'`;

/** How deep in lambdas a printer is: the variable paths there start with. */
interface Scope {
  readonly prefix: string;
  readonly depth: number;
}

const path = (scope: Scope, field: string): string =>
  `${scope.prefix}${field.split(".").join("/")}`;

const grouped = (scope: Scope, expr: Query.Expr): string =>
  Match.value(expr).pipe(
    Match.tag("And", "Or", (node) => `(${print(scope, node)})`),
    Match.orElse((node) => print(scope, node)),
  );

const print = (scope: Scope, expr: Query.Expr): string =>
  Match.valueTags(expr, {
    All: () => "",
    Compare: (node) =>
      `${path(scope, node.field)} ${COMPARE_WIRE[node.op]} ${printLiteral(String(node.value))}`,
    In: (node) =>
      `${path(scope, node.field)} in (${Arr.map(node.values, (value) => printLiteral(String(value))).join(", ")})`,
    Text: (node) =>
      `${TEXT_WIRE[node.op]}(${path(scope, node.field)}, ${printLiteral(node.value)})`,
    Present: (node) => `${path(scope, node.field)} ne null`,
    Exists: (node) => {
      const target = `${scope.prefix}${node.relationship}/any`;
      if (node.filter._tag === "All") return `${target}()`;
      const variable = scope.depth === 0 ? "x" : `x${scope.depth}`;
      const inner = { prefix: `${variable}/`, depth: scope.depth + 1 };
      return `${target}(${variable}: ${print(inner, node.filter)})`;
    },
    And: (node) => Arr.map(node.filters, (child) => grouped(scope, child)).join(" and "),
    Or: (node) => Arr.map(node.filters, (child) => grouped(scope, child)).join(" or "),
    Not: (node) =>
      Match.value(node.filter).pipe(
        Match.tag("Present", (inner) => `${path(scope, inner.field)} eq null`),
        Match.orElse((inner) => `not (${print(scope, inner)})`),
      ),
  });

/** Prints a filter tree whose values are strings as `$filter` text; `All` prints as `""`. */
export const printFilter = (expr: Query.Expr): string => print({ prefix: "", depth: 0 }, expr);
