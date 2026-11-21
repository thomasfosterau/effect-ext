/**
 * The ambient defaults, in a file of their own: a reference caches its
 * default on first read, so this file installs a fake worker scope before
 * anything reads it.
 */
import { describe, expect, it } from "@effect/vitest";
import { fakeScopeConstructor, installGlobals } from "./globals.ts";
import * as Effect from "effect/Effect";
import * as Serial from "@thomasfosterau/effect-platform-worker-shared/Serial";
import * as Hid from "@thomasfosterau/effect-platform-worker-shared/Hid";
import * as Usb from "@thomasfosterau/effect-platform-worker-shared/Usb";
import * as AppBadge from "@thomasfosterau/effect-platform-worker-shared/AppBadge";
import * as WorkerScope from "@thomasfosterau/effect-platform-worker-shared/WorkerScope";

/** Records each badge call; its methods read `this`, as the platform's do. */
class FakeNavigator {
  readonly badge: Array<number | "dot" | "clear"> = [];
  setAppBadge(contents?: number) {
    this.badge.push(contents ?? "dot");
    return Promise.resolve();
  }
  clearAppBadge() {
    this.badge.push("clear");
    return Promise.resolve();
  }
  readonly serial = Object.assign(new EventTarget(), { getPorts: () => Promise.resolve([]) });
  readonly usb = Object.assign(new EventTarget(), { getDevices: () => Promise.resolve([]) });
  readonly hid = Object.assign(new EventTarget(), { getDevices: () => Promise.resolve([]) });
}
const navigator = new FakeNavigator();

installGlobals({
  WorkerGlobalScope: fakeScopeConstructor(),
  location: { href: "https://example.com/ambient.js" },
  isSecureContext: true,
  crossOriginIsolated: false,
  navigator,
});

describe("WorkerScope's ambient default", () => {
  it.effect("is globalThis inside a worker", () =>
    Effect.gen(function* () {
      expect(WorkerScope.isInstanceOfGlobal(globalThis, "WorkerGlobalScope")).toBe(true);
      expect((yield* WorkerScope.location).pathname).toBe("/ambient.js");
    }),
  );
});

describe("AppBadge's ambient default", () => {
  it.effect("is the navigator's Badging API, called as a method", () =>
    Effect.gen(function* () {
      yield* AppBadge.set(2);
      yield* AppBadge.clear;
      expect(navigator.badge).toEqual([2, "clear"]);
      expect(yield* Serial.ports).toEqual([]);
      expect(yield* Usb.devices).toEqual([]);
      expect(yield* Hid.devices).toEqual([]);
    }),
  );
});
