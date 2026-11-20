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
import * as Option from "effect/Option";
import { Caches, Clients, Notifications } from "@thomasfosterau/effect-platform-service-worker";
import { clientsStub } from "./helpers.ts";

const shown: Array<string> = [];

installGlobals({
  ServiceWorkerGlobalScope: fakeScopeConstructor(),
  clients: clientsStub([]),
  caches: Caches.memoryCacheStorage(),
  registration: {
    showNotification: async (title: string) => {
      shown.push(title);
    },
    getNotifications: async () => [],
  },
});

describe("the ambient defaults", () => {
  it.effect("is self.clients", () =>
    Effect.gen(function* () {
      expect(yield* Clients.matchAll()).toEqual([]);
    }),
  );

  it.effect("is self.registration", () =>
    Effect.gen(function* () {
      expect(Option.isSome(yield* Notifications.Registration)).toBe(true);
      yield* Notifications.showNotification("hello");
      expect(shown).toEqual(["hello"]);
    }),
  );

  it.effect("is globalThis.caches", () =>
    Effect.gen(function* () {
      yield* Caches.openCache("v1");
      expect(yield* Caches.cacheNames).toEqual(["v1"]);
    }),
  );
});
