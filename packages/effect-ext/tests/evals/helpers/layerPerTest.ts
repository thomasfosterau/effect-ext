/**
 * `layer(...)` with a fresh build for every test. `@effect/vitest`'s own
 * `buildPerTest` option arrived after Effect 4.0.0, the peer floor, so the
 * suites that need per-test state (the in-memory result cache) use these.
 *
 * @module tests/helpers/layerPerTest
 */

import { describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";

/** The test methods a per-test layer block hands its body. */
export interface PerTestMethods<R> {
  readonly effect: <A, E>(
    name: string,
    self: () => Effect.Effect<A, E, R | Scope.Scope>,
    timeout?: number,
  ) => void;
}

/** Options for {@link layerPerTest} and {@link describeLayerPerTest}. */
export interface PerTestOptions {
  /** Run the tests under `it.live` (real clock and services). */
  readonly live?: boolean;
}

const methodsFor = <R, LE>(
  layer: Layer.Layer<R, LE>,
  options?: PerTestOptions,
): PerTestMethods<R> => {
  const tester = options?.live === true ? it.live : it.effect;
  return {
    effect: (name, self, timeout) =>
      tester(name, () => Effect.provide(Effect.suspend(self), layer), timeout),
  };
};

/** Provide `layer`, built anew for every test, to the tests `body` declares. */
export const layerPerTest =
  <R, LE>(layer: Layer.Layer<R, LE>, options?: PerTestOptions) =>
  (body: (t: PerTestMethods<R>) => void): void =>
    body(methodsFor(layer, options));

/** {@link layerPerTest} inside a `describe` block named `name`. */
export const describeLayerPerTest =
  <R, LE>(layer: Layer.Layer<R, LE>, options?: PerTestOptions) =>
  (name: string, body: (t: PerTestMethods<R>) => void): void => {
    describe(name, () => {
      body(methodsFor(layer, options));
    });
  };
