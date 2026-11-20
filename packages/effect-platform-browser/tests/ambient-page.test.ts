/**
 * The live layers over a page's ambient globals, in a file of its own: it
 * installs a fake window (navigator, `Notification`, `screen`, `matchMedia`
 * and the window's own event target) before any layer reads one.
 */
import { describe, expect, it } from "@effect/vitest";
import { installGlobals } from "../../effect-platform-worker-shared/tests/globals.ts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import {
  Battery,
  Browser,
  DomObservers,
  MediaQuery,
  Navigation,
  Navigator,
  Notifications,
  ScreenOrientation,
  WakeLock,
} from "@thomasfosterau/effect-platform-browser";
import { observe } from "@thomasfosterau/effect-platform-browser/BrowserTesting";

const windowEvents = new EventTarget();

/** The navigator's methods read `this`, as the platform's do. */
class FakeNavigator {
  readonly userAgent = "Ambient/1.0";
  readonly languages = ["en-AU"];
  onLine = true;
  readonly userActivation = { isActive: true, hasBeenActive: true };
  readonly wakeLock = { request: () => new Promise<never>(() => {}) };
  readonly battery = Object.assign(new EventTarget(), {
    charging: true,
    level: 0.5,
    chargingTime: 0,
    dischargingTime: Infinity,
  });
  getBattery(this: FakeNavigator) {
    return Promise.resolve(this.battery);
  }
}
const navigator = new FakeNavigator();

/** Stands in for each observer constructor: the layer only reads that it exists. */
class FakeObserver {
  observe() {}
  disconnect() {}
}

const queries: Array<{ readonly self: unknown; readonly query: string }> = [];
function matchMedia(this: unknown, query: string) {
  queries.push({ self: this, query });
  return Object.assign(new EventTarget(), { matches: true });
}

installGlobals({
  navigator,
  Notification: Object.assign(function Notification() {}, {
    permission: "granted",
    requestPermission: () => Promise.resolve("granted"),
  }),
  screen: {
    orientation: Object.assign(new EventTarget(), {
      type: "portrait-primary",
      angle: 0,
      unlock: () => {},
    }),
  },
  matchMedia,
  navigation: {
    currentEntry: { url: "https://example.com/page", getState: () => undefined },
    addEventListener: () => {},
    removeEventListener: () => {},
  },
  history: { state: null },
  location: { href: "https://example.com/page", assign: () => {} },
  IntersectionObserver: FakeObserver,
  ResizeObserver: FakeObserver,
  MutationObserver: FakeObserver,
  addEventListener: windowEvents.addEventListener.bind(windowEvents),
  removeEventListener: windowEvents.removeEventListener.bind(windowEvents),
});

describe("Browser.layer over a page's globals", () => {
  it.effect("wires each service to its ambient object", () =>
    Effect.gen(function* () {
      const battery = yield* Battery.status;
      const dark = yield* MediaQuery.matches("(prefers-color-scheme: dark)");
      const orientation = yield* ScreenOrientation.current;
      const notifications = yield* Notifications.Notifications;
      const wakeLock = yield* WakeLock.WakeLock;
      const observers = yield* DomObservers.DomObservers;
      const navigation = yield* Navigation.Navigation;
      expect({
        battery: Option.map(battery, (state) => state.level),
        dark,
        boundTo: queries.map((entry) => entry.self === globalThis),
        orientation: Option.map(orientation, (now) => now.type),
        notifications: notifications.supported,
        permission: yield* Notifications.permission,
        wakeLock: wakeLock.supported,
        observers: observers.supported,
        navigation: navigation.supported,
        url: Option.map(yield* Navigation.current, (url) => url.pathname),
      }).toStrictEqual({
        battery: Option.some(0.5),
        dark: true,
        boundTo: [true],
        orientation: Option.some("portrait-primary"),
        notifications: true,
        permission: Option.some("granted"),
        wakeLock: true,
        observers: { intersection: true, resize: true, mutation: true },
        navigation: { navigation: true, history: true },
        url: Option.some("/page"),
      });
    }).pipe(Effect.provide(Browser.layer)),
  );

  it.effect("follows connectivity through the window's own events", () =>
    Effect.gen(function* () {
      const seen = yield* observe(Navigator.onLineChanges, 2);
      navigator.onLine = false;
      windowEvents.dispatchEvent(new Event("offline"));
      expect(yield* Fiber.join(seen)).toStrictEqual([true, false]);
      expect(yield* Navigator.onLine).toBe(false);
    }).pipe(Effect.provide(Navigator.layer)),
  );
});
