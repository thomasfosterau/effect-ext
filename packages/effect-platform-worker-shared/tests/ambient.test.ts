/**
 * The ambient defaults, in a file of their own: a reference caches its
 * default on first read, so this file installs a fake worker scope before
 * anything reads it.
 */
import { describe, expect, it } from "@effect/vitest";
import { fakeScopeConstructor, installGlobals } from "./globals.ts";
import * as Effect from "effect/Effect";
import * as WorkerScope from "@thomasfosterau/effect-platform-worker-shared/WorkerScope";

installGlobals({
  WorkerGlobalScope: fakeScopeConstructor(),
  location: { href: "https://example.com/ambient.js" },
  isSecureContext: true,
  crossOriginIsolated: false,
});

describe("WorkerScope's ambient default", () => {
  it.effect("is globalThis inside a worker", () =>
    Effect.gen(function* () {
      expect(WorkerScope.isInstanceOfGlobal(globalThis, "WorkerGlobalScope")).toBe(true);
      expect((yield* WorkerScope.location).pathname).toBe("/ambient.js");
    }),
  );
});
