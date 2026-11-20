/**
 * Reading a `DOMException`'s name off an unknown rejection.
 */
import * as P from "effect/Predicate";

/**
 * Maps a rejection's `DOMException` name (or `TypeError`) onto a reason
 * through `table`; `fallback` for every other name. Read structurally: a
 * `DOMException` from another realm fails `instanceof`.
 */
export const reasonOf = <Reason extends string>(
  cause: unknown,
  table: Readonly<Partial<Record<string, Reason>>>,
  fallback: Reason,
): Reason =>
  P.hasProperty(cause, "name") && P.isString(cause.name)
    ? (table[cause.name] ?? fallback)
    : fallback;
