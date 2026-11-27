/**
 * Dotted field paths over a `Schema.Struct`: the schema at a path, and every
 * path a struct offers, descending through nested structs (and `Option`s of
 * them) but not through arrays, records or suspended schemas.
 */

import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as R from "effect/Record";
import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";

/** What separates the segments of a field path. */
export const SEPARATOR = ".";

/** The `Type`-side AST of a field, inside its `Option` when it is one. */
export const valueAst = (field: Schema.Constraint): SchemaAST.AST => {
  const type = Schema.toType(field);
  const ast = type.ast;
  // An `Option` schema is the one-parameter declaration that accepts `None`.
  const inner =
    SchemaAST.isDeclaration(ast) && Schema.is(type)(Option.none())
      ? Arr.head(ast.typeParameters)
      : Option.none();
  return Option.getOrElse(inner, () => ast);
};

const nested = (field: Schema.Constraint): Option.Option<Schema.Struct.Fields> => {
  const ast = valueAst(field);
  return SchemaAST.isObjects(ast)
    ? Option.some(
        R.fromEntries(
          Arr.flatMap(ast.propertySignatures, (property) =>
            P.isString(property.name)
              ? [[property.name, Schema.make<Schema.Top>(property.type)] as const]
              : [],
          ),
        ),
      )
    : Option.none();
};

/** The field schema at a dotted path, if the struct has one there. */
export const fieldAt = (
  fields: Schema.Struct.Fields,
  path: string,
): Option.Option<Schema.Constraint> => {
  const step = (
    current: Schema.Struct.Fields,
    segments: ReadonlyArray<string>,
  ): Option.Option<Schema.Constraint> =>
    Arr.match(segments, {
      onEmpty: () => Option.none(),
      onNonEmpty: (nonEmpty) => {
        const head = Arr.headNonEmpty(nonEmpty);
        const tail = Arr.tailNonEmpty(nonEmpty);
        return Option.flatMap(
          Object.hasOwn(current, head) ? R.get(current, head) : Option.none(),
          (field) =>
            Arr.isReadonlyArrayNonEmpty(tail)
              ? Option.flatMap(nested(field), (inner) => step(inner, tail))
              : Option.some(field),
        );
      },
    });
  return step(fields, path.split(SEPARATOR));
};

/** Every path into the struct, each with its field schema: a nested struct's own path first, then its fields'. */
export const leafPaths = (
  fields: Schema.Struct.Fields,
): ReadonlyArray<readonly [string, Schema.Constraint]> =>
  Arr.flatMap(R.toEntries(fields), ([name, field]) => [
    [name, field] as const,
    ...Option.match(nested(field), {
      onNone: () => [],
      onSome: (inner) =>
        Arr.map(leafPaths(inner), ([path, leaf]) => [`${name}${SEPARATOR}${path}`, leaf] as const),
    }),
  ]);
