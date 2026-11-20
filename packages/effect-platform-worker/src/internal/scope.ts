/**
 * The accessors a named, closable worker global shares: the dedicated and
 * shared worker scopes differ only in their reference and their error.
 */
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type * as Option from "effect/Option";

interface NamedScope {
  readonly name: string;
  close(): void;
}

export const namedScopeAccessors = <S extends NamedScope, E>(
  reference: Context.Reference<Option.Option<S>>,
  unavailable: () => E,
) => {
  const scope: Effect.Effect<S, E> = reference.use((self) =>
    Effect.mapError(Effect.fromOption(self), unavailable),
  );
  return {
    scope,
    name: Effect.map(scope, (self) => self.name),
    close: Effect.flatMap(scope, (self) => Effect.sync(() => self.close())),
  };
};
