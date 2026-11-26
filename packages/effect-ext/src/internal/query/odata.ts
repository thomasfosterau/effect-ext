/**
 * The OData `$filter` subset `QueryParams.odata` reads and writes: a
 * recursive-descent parser over a token array, and a printer. Values stay the
 * strings they were written as; the schema decodes them afterwards.
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

const identifier = (tokens: ReadonlyArray<Token>, i: number): Step<string> =>
  Option.match(
    Option.filter(at(tokens, i), (token) => token.kind === "word"),
    {
      onNone: () => Result.fail(`expected a field name, found ${describe(tokens, i)}`),
      onSome: (token) => Result.succeed([token.text, i + 1]),
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

const textCall = (tokens: ReadonlyArray<Token>, i: number, op: Query.TextOp): Step<Query.Expr> =>
  Result.gen(function* () {
    const [, a] = yield* expectToken(tokens, i, "(");
    const [field, b] = yield* identifier(tokens, a);
    const [, c] = yield* expectToken(tokens, b, ",");
    const [value, d] = yield* literal(tokens, c);
    const [, e] = yield* expectToken(tokens, d, ")");
    const text = yield* Option.match(value, {
      onNone: () => Result.fail(`${TEXT_WIRE[op]} needs a string, not null`),
      onSome: (string) => Result.succeed(string),
    });
    return [{ _tag: "Text", field, op, value: text }, e] as const;
  });

const comparison = (tokens: ReadonlyArray<Token>, i: number): Step<Query.Expr> =>
  Result.gen(function* () {
    const [field, a] = yield* identifier(tokens, i);
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

const primary = (tokens: ReadonlyArray<Token>, i: number): Step<Query.Expr> => {
  if (is(tokens, i, "(")) {
    return Result.flatMap(or(tokens, i + 1), ([node, j]) =>
      Result.map(expectToken(tokens, j, ")"), ([, k]) => [node, k] as const),
    );
  }
  const call = Option.flatMap(at(tokens, i), (token) =>
    token.kind === "word" && is(tokens, i + 1, "(")
      ? R.get<string, Query.TextOp>(TEXT, token.text)
      : Option.none(),
  );
  return Option.match(call, {
    onNone: () => comparison(tokens, i),
    onSome: (op) => textCall(tokens, i + 1, op),
  });
};

const unary = (tokens: ReadonlyArray<Token>, i: number): Step<Query.Expr> =>
  is(tokens, i, "not")
    ? Result.map(unary(tokens, i + 1), ([filter, j]) => [{ _tag: "Not", filter }, j] as const)
    : primary(tokens, i);

const chain =
  (keyword: "and" | "or", operand: (tokens: ReadonlyArray<Token>, i: number) => Step<Query.Expr>) =>
  (tokens: ReadonlyArray<Token>, i: number): Step<Query.Expr> => {
    const rest = (acc: Arr.NonEmptyReadonlyArray<Query.Expr>, j: number): Step<Query.Expr> =>
      is(tokens, j, keyword)
        ? Result.flatMap(operand(tokens, j + 1), ([node, k]) => rest(Arr.append(acc, node), k))
        : Result.succeed([
            acc.length === 1
              ? Arr.headNonEmpty(acc)
              : { _tag: keyword === "and" ? "And" : "Or", filters: acc },
            j,
          ]);
    return Result.flatMap(operand(tokens, i), ([first, j]) => rest([first], j));
  };

const and = chain("and", unary);
const or: (tokens: ReadonlyArray<Token>, i: number) => Step<Query.Expr> = chain("or", and);

/** Parses `$filter` text into a filter tree whose values are still strings. */
export const parseFilter = (input: string): Result.Result<Query.Expr, string> =>
  Result.flatMap(tokenize(input), (tokens) =>
    Arr.isReadonlyArrayNonEmpty(tokens)
      ? Result.flatMap(or(tokens, 0), ([node, i]) =>
          i === tokens.length
            ? Result.succeed(node)
            : Result.fail(`unexpected ${describe(tokens, i)}`),
        )
      : Result.succeed({ _tag: "All" }),
  );

const printLiteral = (value: string): string =>
  /^-?\d+(?:\.\d+)?$|^true$|^false$/.test(value) ? value : `'${value.replaceAll("'", "''")}'`;

const grouped = (expr: Query.Expr): string =>
  Match.value(expr).pipe(
    Match.tag("And", "Or", (node) => `(${printFilter(node)})`),
    Match.orElse(printFilter),
  );

/** Prints a filter tree whose values are strings as `$filter` text; `All` prints as `""`. */
export const printFilter = (expr: Query.Expr): string =>
  Match.valueTags(expr, {
    All: () => "",
    Compare: (node) => `${node.field} ${COMPARE_WIRE[node.op]} ${printLiteral(String(node.value))}`,
    In: (node) =>
      `${node.field} in (${Arr.map(node.values, (value) => printLiteral(String(value))).join(", ")})`,
    Text: (node) => `${TEXT_WIRE[node.op]}(${node.field}, ${printLiteral(node.value)})`,
    Present: (node) => `${node.field} ne null`,
    And: (node) => Arr.map(node.filters, grouped).join(" and "),
    Or: (node) => Arr.map(node.filters, grouped).join(" or "),
    Not: (node) =>
      Match.value(node.filter).pipe(
        Match.tag("Present", (inner) => `${inner.field} eq null`),
        Match.orElse((inner) => `not (${printFilter(inner)})`),
      ),
  });
