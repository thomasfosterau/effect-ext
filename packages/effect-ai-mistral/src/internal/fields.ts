/**
 * Builders for the hand-written request payloads, whose optional members are
 * omitted keys (never `undefined` values): a `None` contributes no key.
 *
 * @module internal/fields
 *
 * @copyright Thomas Foster
 */

import * as Option from "effect/Option";
import * as R from "effect/Record";

/**
 * A one-key object holding `value`, or an empty object for `None`, to spread
 * into a request payload.
 */
export const optionalField = <K extends string, V>(
  key: K,
  value: Option.Option<V>,
): { readonly [P in K]?: V } =>
  Option.match(value, {
    onNone: () => ({}),
    onSome: (present) => R.singleton(key, present),
  });
