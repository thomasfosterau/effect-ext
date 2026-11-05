/**
 * @copyright Thomas Foster
 *
 * Type-level tests for `Bounded.pagination` / `requiredPagination`:
 * `maxLimit` is required (there is no default page cap), the option members
 * take an `Option`, and `requiredPagination` returns the required-keys
 * fields. Checked by the package's `check` task
 * (tsconfig.test.json); the expect-error directives are the assertions.
 * Never executed.
 *
 * @module tests/Bounded.types
 */

import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Bounded } from "@thomasfosterau/effect-utilities";

type Assert<T extends true> = T;
type Equals<A, B> =
  (<X>() => X extends A ? 1 : 2) extends <X>() => X extends B ? 1 : 2 ? true : false;

// @ts-expect-error -- the page cap is the caller's: no argument, no cap
export const noOptions = Bounded.pagination();
// @ts-expect-error -- `maxLimit` is required
export const noCap = Bounded.pagination({ defaultLimit: Option.some(20) });

// @ts-expect-error -- `defaultLimit` takes an `Option`, not a bare number
export const bareDefault = Bounded.pagination({ maxLimit: 100, defaultLimit: 20 });
// @ts-expect-error -- the `false` sentinel is gone: use `requiredPagination`
export const sentinel = Bounded.pagination({ maxLimit: 100, defaultLimit: false });
// @ts-expect-error -- an optional member takes no forwarded `undefined`
export const forwarded = Bounded.idList({ maxLength: undefined });

export const defaulted = Bounded.pagination({ maxLimit: 100 });
export const required = Bounded.requiredPagination({ maxLimit: 100 });

const DefaultedInput = Schema.Struct(defaulted);
const RequiredInput = Schema.Struct(required);

export type Checks = [
  Assert<Equals<typeof defaulted, Bounded.DefaultedPagination>>,
  Assert<Equals<typeof required, Bounded.RequiredPagination>>,
  // Defaulted: optional on the wire, concrete once decoded.
  Assert<Equals<typeof DefaultedInput.Type, { readonly offset: number; readonly limit: number }>>,
  Assert<
    Equals<typeof DefaultedInput.Encoded, { readonly offset?: number; readonly limit?: number }>
  >,
  // Required: both keys on both sides.
  Assert<Equals<typeof RequiredInput.Encoded, { readonly offset: number; readonly limit: number }>>,
];
