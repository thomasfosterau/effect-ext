/**
 * The ambient defaults, in a file of their own: a reference caches its
 * default on first read, so this file installs fake worker scopes first.
 */
import { describe, expect, it } from "@effect/vitest";
import {
  fakeScopeConstructor,
  installGlobals,
} from "../../effect-platform-worker-shared/tests/globals.ts";
import * as Effect from "effect/Effect";
import { DedicatedWorker, SharedWorker } from "@thomasfosterau/effect-platform-worker";

installGlobals({
  DedicatedWorkerGlobalScope: fakeScopeConstructor(),
  SharedWorkerGlobalScope: fakeScopeConstructor(),
  name: "ambient",
});

describe("the ambient defaults", () => {
  it.effect("are globalThis inside each kind of worker", () =>
    Effect.gen(function* () {
      expect(yield* DedicatedWorker.name).toBe("ambient");
      expect(yield* SharedWorker.name).toBe("ambient");
    }),
  );
});
