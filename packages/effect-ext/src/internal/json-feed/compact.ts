import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as R from "effect/Record";
import * as Result from "effect/Result";

/** The slot for member `K` of `A`: an optional member takes an `Option` or a present value, a required one its value. */
type Slot<A, K extends keyof A> = undefined extends A[K]
  ? Option.Option<Exclude<A[K], undefined>> | Exclude<A[K], undefined>
  : A[K];

/**
 * An `A` built from every one of its members, absent optional ones as
 * `Option.none()`, with those keys dropped: the caller lists each member once
 * (the mapped parameter type makes a forgotten one a compile error), and the
 * result carries only the present ones.
 */
export const compact = <A>(record: { readonly [K in Extract<keyof A, string>]-?: Slot<A, K> }): A =>
  // SAFETY: the entries kept are the present members, unwrapped; every member that can be absent is optional in `A`, so what remains is an `A`. The assertion restores the key set `fromEntries` widens to `string`.
  R.fromEntries(
    Arr.filterMap(R.toEntries<string, unknown>(record), ([key, value]) => {
      const slot = Option.isOption(value) ? value : Option.some(value);
      return Option.isSome(slot) ? Result.succeed([key, slot.value] as const) : Result.failVoid;
    }),
  ) as A;
