/**
 * The ambient default, in a file of its own: a reference caches its
 * default on first read, so this file installs a fake `navigator` first.
 */
import { describe, expect, it } from "@effect/vitest";
import { installGlobals } from "../../effect-platform-worker-shared/tests/globals.ts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { ServiceWorkerContainer as SWC } from "@thomasfosterau/effect-platform-browser";
import { domError } from "./helpers.ts";

const container = Object.assign(new EventTarget(), {
  controller: null,
  ready: new Promise<never>(() => {}),
  register: () => Promise.reject(domError("AbortError")),
  getRegistration: async () => undefined,
});

installGlobals({ navigator: { serviceWorker: container } });

describe("ServiceWorkerContainer.Container", () => {
  it.effect("defaults to navigator.serviceWorker", () =>
    Effect.gen(function* () {
      expect(yield* SWC.Container).toEqual(Option.some(container));
      expect(yield* SWC.controller).toEqual(Option.none());
    }),
  );
});
