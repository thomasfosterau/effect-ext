/**
 * The ambient defaults, in a file of their own: a reference caches its
 * default on first read, so this file installs a fake service worker scope
 * and container first.
 */
import { describe, expect, it } from "@effect/vitest";
import {
  fakeScopeConstructor,
  installGlobals,
} from "../../effect-platform-worker-shared/tests/globals.ts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Clients, ServiceWorkerContainer } from "@thomasfosterau/effect-platform-service-worker";
import { clientsStub } from "./helpers.ts";

const container = Object.assign(new EventTarget(), {
  controller: null,
  ready: new Promise<never>(() => {}),
  register: () => Promise.reject(new TypeError("unused")),
  getRegistration: async () => undefined,
});

installGlobals({
  ServiceWorkerGlobalScope: fakeScopeConstructor(),
  clients: clientsStub([]),
  navigator: { serviceWorker: container },
});

describe("the ambient defaults", () => {
  it.effect("are self.clients and navigator.serviceWorker", () =>
    Effect.gen(function* () {
      expect(yield* Clients.matchAll()).toEqual([]);
      expect(yield* ServiceWorkerContainer.controller).toEqual(Option.none());
    }),
  );
});
