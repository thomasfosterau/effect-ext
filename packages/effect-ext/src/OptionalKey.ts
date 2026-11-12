/**
 * Optional keys for object construction under `exactOptionalPropertyTypes`.
 *
 * With `exactOptionalPropertyTypes` on, an optional property that is absent
 * must be omitted, not set to `undefined`. The usual workaround,
 * `...(value !== undefined ? { key: value } : {})`, is what
 * `effect/no-conditional-empty-object-spread` rejects. {@link optionalKey}
 * names the intent instead: spread `optionalKey("key", value)` and the key is
 * present exactly when the value is.
 *
 * Only `undefined` means absent: `null`, `""`, `0` and `false` are values and
 * keep their key. Pass `x ?? undefined` to drop a `null`, or use
 * {@link fromOption} for an `Option`. An absent key costs no allocation: every
 * absent result is one shared, frozen empty object.
 *
 * Effect has no equivalent: `effect/Struct` picks, omits and evolves existing
 * structs but does not build optional keys.
 *
 * @copyright Thomas Foster
 * @since 0.3.0
 */

import * as Option from "effect/Option";

/**
 * The object {@link optionalKey} returns: `key` is optional and, when present,
 * holds an `A`.
 *
 * @since 0.3.0
 * @category models
 */
export type OptionalKey<K extends string, A> = { readonly [P in K]?: Exclude<A, undefined> };

const EMPTY = /* @__PURE__ */ Object.freeze({});

/**
 * An object holding `key: value` when `value` is not `undefined`, and no keys
 * otherwise. Spread it into an object literal whose type has an optional
 * `key`.
 *
 * @example
 * ```ts
 * import { optionalKey } from "@thomasfosterau/effect-ext/OptionalKey"
 *
 * const describe = (name: string, nickname?: string) => ({ name, ...optionalKey("nickname", nickname) })
 *
 * console.log(describe("Ada"))
 * // → { name: 'Ada' }
 * console.log(describe("Ada", "Countess"))
 * // → { name: 'Ada', nickname: 'Countess' }
 * console.log(optionalKey("note", null))
 * // → { note: null }
 * ```
 *
 * @since 0.3.0
 * @category constructors
 */
export function optionalKey<const K extends string, A>(key: K, value?: A): OptionalKey<K, A>;
export function optionalKey<A>(key: string, value?: A): Readonly<Record<string, A>> {
  return value === undefined ? EMPTY : { [key]: value };
}

/**
 * {@link optionalKey} over an `Option`: `key: a` for `Some(a)`, no keys for
 * `None`.
 *
 * @example
 * ```ts
 * import * as Option from "effect/Option"
 * import { fromOption } from "@thomasfosterau/effect-ext/OptionalKey"
 *
 * console.log({ id: 1, ...fromOption("parent", Option.some(7)) })
 * // → { id: 1, parent: 7 }
 * console.log({ id: 1, ...fromOption("parent", Option.none<number>()) })
 * // → { id: 1 }
 * ```
 *
 * @since 0.3.0
 * @category constructors
 */
export const fromOption = <const K extends string, A>(
  key: K,
  option: Option.Option<A>,
): OptionalKey<K, A> => optionalKey(key, Option.getOrUndefined(option));
