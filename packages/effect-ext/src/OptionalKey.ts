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
 * {@link fields} does the same for a whole object of optional values at once.
 *
 * Only `undefined` means absent: `null`, `""`, `0` and `false` are values and
 * keep their key. Pass `x ?? undefined` to drop a `null`, or use
 * {@link fromOption} for an `Option`. An absent key from {@link optionalKey} or
 * {@link fromOption} costs no allocation: every such result is one shared,
 * frozen empty object.
 *
 * Effect has no equivalent: `effect/Struct` picks, omits and evolves existing
 * structs but does not build optional keys.
 *
 * @copyright Thomas Foster
 * @since 0.3.0
 */

import * as Option from "effect/Option";
import * as R from "effect/Record";

/**
 * The object {@link optionalKey} returns: `key` is optional and, when present,
 * holds an `A`.
 *
 * @since 0.3.0
 * @category models
 */
export type OptionalKey<K extends string, A> = { readonly [P in K]?: Exclude<A, undefined> };

/**
 * The object {@link fields} returns: each member whose type admits `undefined`
 * becomes optional with `undefined` excluded; every other member is kept as
 * it is.
 *
 * @since 0.3.0
 * @category models
 */
export type Defined<T> = {
  readonly [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
} & {
  readonly [K in keyof T as undefined extends T[K] ? never : K]: T[K];
};

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

/**
 * Copies the members of `input` whose value is not `undefined`: the
 * whole-object form of {@link optionalKey}, for forwarding several optional
 * values into an options object at once.
 *
 * @example
 * ```ts
 * import { fields } from "@thomasfosterau/effect-ext/OptionalKey"
 *
 * const list = (collection: string, limit?: number, cursor?: string) => ({ collection, ...fields({ limit, cursor }) })
 *
 * console.log(list("posts"))
 * // → { collection: 'posts' }
 * console.log(list("posts", 10))
 * // → { collection: 'posts', limit: 10 }
 * console.log(fields({ a: null, b: 0, c: undefined }))
 * // → { a: null, b: 0 }
 * ```
 *
 * @since 0.3.0
 * @category constructors
 */
export function fields<T extends object>(input: T): Defined<T>;
export function fields<T extends object>(input: T): Readonly<Record<string, T[keyof T]>> {
  return R.filter(input, (value) => value !== undefined);
}
