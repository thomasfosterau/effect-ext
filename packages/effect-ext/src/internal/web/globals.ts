/**
 * The only place the `Browser` module reads ambient globals. Every live
 * `layer` reads through here, inside its build (never at import), so the
 * modules stay importable — and their layers buildable — in a server render,
 * a worker or a test runner, where a global may be missing.
 *
 * The DOM lib types these globals as always present; at runtime they are
 * not (reading a missing one off `globalThis` is `undefined`, never a
 * throw), so each read is an `Option`, `None` where the global is missing.
 */
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import type { BatteryManagerLike } from "../../browser/battery.ts";
import type { IdleDetectorLike } from "../../browser/idle-detection.ts";

/** `globalThis.navigator`, where the context has one. */
export const ambientNavigator = (): Option.Option<Navigator> =>
  Option.fromUndefinedOr(globalThis.navigator);

/** `globalThis.document`, where the context has one (a window, not a worker). */
export const ambientDocument = (): Option.Option<Document> =>
  Option.fromUndefinedOr(globalThis.document);

/** `globalThis.matchMedia`, bound to `globalThis`, where the context has one. */
export const ambientMatchMedia = (): Option.Option<(query: string) => MediaQueryList> =>
  Option.map(
    Option.fromUndefinedOr<typeof globalThis.matchMedia>(globalThis.matchMedia),
    (matchMedia) => (query: string) => matchMedia.call(globalThis, query),
  );

/** `globalThis.BroadcastChannel`, where the context has one. */
export const ambientBroadcastChannel = (): Option.Option<typeof globalThis.BroadcastChannel> =>
  Option.fromUndefinedOr(globalThis.BroadcastChannel);

/**
 * `globalThis` as the event target `online` / `offline` / `languagechange`
 * fire on (the window, or a worker's global scope); `None` where it is
 * not one.
 */
export const ambientEventTarget = (): Option.Option<EventTarget> =>
  P.isFunction(globalThis.addEventListener) ? Option.some(globalThis) : Option.none();

/** `globalThis.IdleDetector`, where the agent has one (Chromium, in a window or a dedicated worker). */
export const ambientIdleDetector = (): Option.Option<IdleDetectorLike> => {
  // The DOM lib has no `IdleDetector`; the `navigator` member only stops the
  // annotation reading as a weak type (one with no member in common).
  const scope: { readonly IdleDetector?: IdleDetectorLike } & Pick<typeof globalThis, "navigator"> =
    globalThis;
  return Option.fromUndefinedOr(scope.IdleDetector);
};

/** `navigator.getBattery`, bound to `navigator`, where the agent has it (Chromium). */
export const ambientGetBattery = (): Option.Option<() => Promise<BatteryManagerLike>> =>
  Option.flatMap(ambientNavigator(), (navigator) => {
    // The DOM lib has no `getBattery`; `userAgent` as for `ambientIdleDetector`.
    const withBattery: { getBattery?: () => Promise<BatteryManagerLike> } & Pick<
      Navigator,
      "userAgent"
    > = navigator;
    const getBattery = withBattery.getBattery;
    return Option.map(Option.fromUndefinedOr(getBattery), (fn) => () => fn.call(navigator));
  });

/** `globalThis.screen.orientation`, where the context has one (a window, in an agent that ships it). */
export const ambientScreenOrientation = (): Option.Option<ScreenOrientation> =>
  Option.flatMap(Option.fromUndefinedOr(globalThis.screen), (screen) =>
    Option.fromUndefinedOr(screen.orientation),
  );

/** `globalThis.Notification`, where the context has one (a window, or a dedicated worker). */
export const ambientNotification = (): Option.Option<typeof globalThis.Notification> =>
  Option.fromUndefinedOr(globalThis.Notification);
