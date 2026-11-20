/**
 * Installs fake platform globals for a test file, restored after it: a
 * reference caches its ambient default on first read, so a suite that
 * tests the default installs these before anything reads it.
 */
import { afterAll } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as R from "effect/Record";

/** A constructor every `instanceof` against which is true for `globalThis` alone. */
export const fakeScopeConstructor = (): new () => object =>
  class {
    static [Symbol.hasInstance](value: unknown): boolean {
      return value === globalThis;
    }
    readonly fake = true;
  };

export const installGlobals = (globals: Readonly<Record<string, unknown>>): void => {
  const entries = R.toEntries(globals);
  const previous = Arr.map(entries, ([key]) => Object.getOwnPropertyDescriptor(globalThis, key));
  Arr.forEach(entries, ([key, value]) => {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  });
  afterAll(() => {
    Arr.forEach(entries, ([key], index) => {
      const descriptor = previous[index];
      if (descriptor === undefined) Reflect.deleteProperty(globalThis, key);
      else Object.defineProperty(globalThis, key, descriptor);
    });
  });
};
