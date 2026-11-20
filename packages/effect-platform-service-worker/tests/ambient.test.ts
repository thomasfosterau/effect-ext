/**
 * The ambient defaults, in a file of their own: a reference caches its
 * default on first read, so this file installs a fake service worker scope
 * first.
 */
import { describe, expect, it } from "@effect/vitest";
import {
  fakeScopeConstructor,
  installGlobals,
} from "../../effect-platform-worker-shared/tests/globals.ts";
import * as Effect from "effect/Effect";
import { Clients } from "@thomasfosterau/effect-platform-service-worker";
import { clientsStub } from "./helpers.ts";

installGlobals({
  ServiceWorkerGlobalScope: fakeScopeConstructor(),
  clients: clientsStub([]),
});

describe("the ambient default", () => {
  it.effect("is self.clients", () =>
    Effect.gen(function* () {
      expect(yield* Clients.matchAll()).toEqual([]);
    }),
  );
});
