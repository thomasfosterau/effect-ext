/**
 * Effect Schema issue trees → RFC 6901 JSON Pointers.
 *
 * A failed decode reports a tree of `SchemaIssue`s: `Pointer` nodes carry the
 * path segments, `Composite` / `AnyOf` group siblings, `Filter` / `Encoding`
 * wrap one inner issue, and the leaves (`InvalidType`, `InvalidValue`,
 * `MissingKey`, `UnexpectedKey`, `Forbidden`, `OneOf`) say what went wrong.
 * {@link leaves} flattens the tree to its leaves with the path that reaches
 * each; {@link pointers} renders each as a JSON Pointer with its tag and
 * formatted message — the schema-only half of a field-level error response.
 * The response envelope (a JSON:API error object, a form error map) is the
 * caller's.
 *
 * @copyright Thomas Foster
 * @since 0.1.0
 */

import * as Arr from "effect/Array";
import * as JsonPointer from "effect/JsonPointer";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as SchemaIssue from "effect/SchemaIssue";

/** One path segment as an escaped RFC 6901 reference token (Effect's own escaping). */
const escapeToken = (segment: PropertyKey): string => JsonPointer.escapeToken(String(segment));

/**
 * An RFC 6901 JSON Pointer from a path of property keys:
 * `["data", "attributes", "name"]` → `/data/attributes/name`. The empty path
 * is `""` (the whole document). Each segment is escaped (`~` → `~0`, `/` →
 * `~1`); a numeric segment is an array index.
 *
 * @example
 * ```ts
 * import { Issues } from "@thomasfosterau/effect-ext"
 *
 * console.log(Issues.pathToJsonPointer(["authors", 0, "a/b"]))
 * // → /authors/0/a~1b
 * console.log(JSON.stringify(Issues.pathToJsonPointer([])))
 * // → ""
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const pathToJsonPointer = (path: ReadonlyArray<PropertyKey>): string =>
  Arr.isReadonlyArrayEmpty(path) ? "" : `/${Arr.map(path, escapeToken).join("/")}`;

/**
 * One terminal issue of a schema failure, with the path that reaches it.
 *
 * @since 0.1.0
 * @category models
 */
export interface Leaf {
  readonly path: ReadonlyArray<PropertyKey>;
  readonly issue: SchemaIssue.Issue;
  /**
   * The check that describes a message-less `InvalidValue` leaf: the nearest
   * enclosing `Filter`, when it wraps the leaf directly (a built-in check such
   * as `isMinLength`) or states a `message` of its own (a struct-level check
   * that points its failure at a field). {@link message} formats from it.
   * `Option.none()` for every other leaf.
   *
   * @since 0.2.0
   */
  readonly describedBy: Option.Option<SchemaIssue.Filter>;
}

/**
 * Flatten a schema issue tree to its leaves, accumulating every `Pointer`'s
 * path on the way down.
 *
 * `Pointer` extends the path and recurses; `Composite` and a non-empty
 * `AnyOf` recurse into each child at the same path (one leaf per rejected
 * union member); `Filter` and `Encoding` recurse into their inner issue; an
 * empty `AnyOf` (a literal-union no-match) and every other node is a leaf.
 *
 * @example
 * ```ts
 * import { Effect, Option, Schema } from "effect"
 * import { Issues } from "@thomasfosterau/effect-ext"
 *
 * const Input = Schema.Struct({ authors: Schema.Array(Schema.Struct({ name: Schema.String })) })
 * const failure = Schema.decodeUnknownEffect(Input)({ authors: [{ name: 1 }] }).pipe(Effect.flip, Effect.runSync)
 *
 * const [leaf] = Issues.leaves(failure.issue)
 * console.log(leaf?.path, leaf?.issue._tag)
 * // → [ 'authors', 0, 'name' ] InvalidType
 * ```
 *
 * @since 0.1.0
 * @category destructors
 */
export const leaves = (issue: SchemaIssue.Issue): ReadonlyArray<Leaf> => {
  const found: Array<Leaf> = [];
  const walk = (
    current: SchemaIssue.Issue,
    path: ReadonlyArray<PropertyKey>,
    filter: Option.Option<SchemaIssue.Filter>,
  ): void => {
    Match.value(current).pipe(
      // `Pointer` extends the path and recurses into its one inner issue.
      Match.tag("Pointer", (node) => walk(node.issue, [...path, ...node.path], filter)),
      // `Composite` groups sibling issues under the same path.
      Match.tag("Composite", (node) => node.issues.forEach((child) => walk(child, path, filter))),
      // A union no-match: one leaf per rejected member, so a caller can see
      // which branch failed — or the `AnyOf` itself when it carries none.
      Match.tag("AnyOf", (node) => {
        if (Arr.isReadonlyArrayEmpty(node.issues)) found.push(leafOf(path, node, filter));
        else node.issues.forEach((child) => walk(child, path, filter));
      }),
      // A `Filter` unwraps, and becomes the nearest check for what is below it.
      Match.tag("Filter", (node) => walk(node.issue, path, Option.some(node))),
      Match.tag("Encoding", (node) => walk(node.issue, path, filter)),
      // A terminal leaf: `InvalidType`, `InvalidValue`, `MissingKey`,
      // `UnexpectedKey`, `Forbidden`, `OneOf`.
      Match.orElse((leaf) => {
        found.push(leafOf(path, leaf, filter));
      }),
    );
  };
  walk(issue, [], Option.none());
  return found;
};

/** An `InvalidValue` that states no message of its own. */
const isBareInvalidValue = (issue: SchemaIssue.Issue): boolean =>
  P.isTagged(issue, "InvalidValue") && issue.annotations?.message === undefined;

/**
 * A leaf, described by the nearest enclosing `Filter` when that filter knows
 * more than the leaf does: the leaf is a message-less `InvalidValue`, and the
 * filter either wraps it directly (a built-in check: "Expected a value with a
 * length of at least 3" rather than "Expected a valid value") or carries a
 * `message` of its own (a struct-level check returning `{ path, issue }`).
 * This is effect-jsonapi's `describedBy` rule (effect-ext#69).
 */
const leafOf = (
  path: ReadonlyArray<PropertyKey>,
  issue: SchemaIssue.Issue,
  filter: Option.Option<SchemaIssue.Filter>,
): Leaf => ({
  path,
  issue,
  describedBy: Option.filter(
    filter,
    (enclosing) =>
      isBareInvalidValue(issue) &&
      (enclosing.issue === issue || SchemaIssue.defaultCheckHook(enclosing) !== undefined),
  ),
});

/**
 * A leaf's message, from Effect's default issue formatter: formatted from its
 * {@link Leaf.describedBy} check when it has one, so the check's expectation
 * or `message` survives, else from the leaf itself. The path is not part of
 * the message.
 *
 * @example
 * ```ts
 * import { Effect, Schema, SchemaIssue } from "effect"
 * import { Issues } from "@thomasfosterau/effect-ext"
 *
 * const Pair = Schema.Struct({ a: Schema.String, b: Schema.String }).check(
 *   Schema.makeFilter(
 *     (v) => v.a === v.b || { path: ["b"], issue: new SchemaIssue.InvalidValue() },
 *     { message: "b must equal a" },
 *   ),
 * )
 * const failure = Schema.decodeUnknownEffect(Pair)({ a: "x", b: "y" }).pipe(Effect.flip, Effect.runSync)
 *
 * const [leaf] = Issues.leaves(failure.issue)
 * if (leaf !== undefined) console.log(leaf.path, Issues.message(leaf))
 * // → [ 'b' ] b must equal a
 * ```
 *
 * @since 0.2.0
 * @category destructors
 */
export const message = (leaf: Leaf): string =>
  // Effect's default formatter: `String(issue)` is not a message for a leaf
  // node (a `MissingKey` stringifies as `[object Object]`). The describing
  // check is re-wrapped around the leaf alone, so the formatter neither walks
  // the check's own subtree nor appends its `at <path>` suffix.
  defaultFormat(
    Option.match(leaf.describedBy, {
      onNone: () => leaf.issue,
      onSome: (filter) => new SchemaIssue.Filter(filter.filter, leaf.issue),
    }),
  );

const defaultFormat = SchemaIssue.makeFormatterDefault();

/**
 * Options of {@link pointers}.
 *
 * @since 0.1.0
 * @category models
 */
export interface PointerOptions {
  /**
   * Segments every pointer is placed under — `["data", "attributes"]` for a
   * flat attribute-keyed input rendered into a JSON:API document. Defaults to
   * none: the pointer addresses the decoded input itself.
   */
  readonly prefix?: Option.Option<ReadonlyArray<PropertyKey>>;
}

/**
 * One leaf of a schema failure, rendered.
 *
 * @since 0.1.0
 * @category models
 */
export interface PointedIssue {
  /** The RFC 6901 pointer to the failing location; `""` for the whole input. */
  readonly pointer: string;
  /** The leaf's `_tag` (`InvalidType`, `MissingKey`, …): a stable code. */
  readonly tag: SchemaIssue.Issue["_tag"];
  /**
   * The leaf's message, as {@link message} formats it: from the check that
   * describes a message-less `InvalidValue` when there is one, so its
   * expectation or `message` survives.
   */
  readonly message: string;
  /** The leaf itself. */
  readonly issue: SchemaIssue.Issue;
}

/**
 * One {@link PointedIssue} per leaf of a schema failure: the pointer from the
 * accumulated path (under `prefix`), the leaf's tag and its message as
 * Effect's default formatter renders it.
 *
 * @example
 * ```ts
 * import { Effect, Option, Schema } from "effect"
 * import { Issues } from "@thomasfosterau/effect-ext"
 *
 * const Input = Schema.Struct({ name: Schema.String })
 * const failure = Schema.decodeUnknownEffect(Input)({}).pipe(Effect.flip, Effect.runSync)
 *
 * const [first] = Issues.pointers(failure.issue, { prefix: Option.some(["data", "attributes"]) })
 * console.log(first?.pointer, first?.tag, first?.message)
 * // → /data/attributes/name MissingKey Missing key
 *
 * const Short = Schema.Struct({ code: Schema.String.check(Schema.isMinLength(3)) })
 * const tooShort = Schema.decodeUnknownEffect(Short)({ code: "ab" }).pipe(Effect.flip, Effect.runSync)
 * console.log(Issues.pointers(tooShort.issue)[0]?.message)
 * // → Expected a value with a length of at least 3
 * ```
 *
 * @since 0.1.0
 * @category destructors
 */
export const pointers = (
  issue: SchemaIssue.Issue,
  { prefix = Option.none() }: PointerOptions = {},
): ReadonlyArray<PointedIssue> => {
  const segments = Option.getOrElse(prefix, (): ReadonlyArray<PropertyKey> => []);
  return Arr.map(leaves(issue), (leaf) => ({
    pointer: pathToJsonPointer([...segments, ...leaf.path]),
    tag: leaf.issue._tag,
    message: message(leaf),
    issue: leaf.issue,
  }));
};
