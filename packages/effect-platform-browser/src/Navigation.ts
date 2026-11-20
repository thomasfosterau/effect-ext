/**
 * Same-document navigation as Effect values: the current URL and its
 * changes, `navigate` / `back` / `forward`, history state typed by a
 * `Schema`, and `intercept`, which runs an Effect for each navigation a
 * router takes over. Over the Navigation API where the browser has it, else
 * over `history` and `popstate`.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Eq from "effect/Equal";
import { constVoid } from "effect/Function";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { reasonOf, watch } from "./internal/dom.ts";
import {
  ambientEventTarget,
  ambientHistory,
  ambientLocation,
  ambientNavigation,
} from "./internal/globals.ts";

/**
 * How a navigation moves through the session history.
 *
 * @since 0.1.0
 * @category models
 */
export type NavigationType = "push" | "replace" | "reload" | "traverse";

/**
 * The slice of a `NavigationHistoryEntry` this module reads. `url` is
 * `null` for an entry the page may not see (an opaque origin).
 *
 * @since 0.1.0
 * @category models
 */
export interface HistoryEntryLike {
  readonly url: string | null;
  getState(): unknown;
}

/**
 * What the Navigation API's `navigate`, `back` and `forward` return: a
 * promise for when the URL changed and one for when every handler finished
 * (optional in the DOM lib's typing; every agent returns both).
 *
 * @since 0.1.0
 * @category models
 */
export interface NavigationResultLike {
  readonly committed?: Promise<unknown>;
  readonly finished?: Promise<unknown>;
}

/**
 * The slice of a `NavigateEvent` this module reads.
 *
 * @since 0.1.0
 * @category models
 */
export interface NavigateEventLike {
  readonly navigationType: NavigationType;
  readonly destination: { readonly url: string; getState(): unknown };
  readonly canIntercept: boolean;
  readonly hashChange: boolean;
  readonly downloadRequest: string | null;
  readonly signal: AbortSignal;
  intercept(options: { readonly handler: () => Promise<void> }): void;
}

/**
 * The slice of `window.navigation` this module calls: an event target for
 * `navigate` and `currententrychange`.
 *
 * @since 0.1.0
 * @category models
 */
export interface NavigationLike extends Stream.EventListener<NavigateEventLike> {
  readonly currentEntry: HistoryEntryLike | null;
  navigate(
    url: string,
    options: { readonly state: unknown; readonly history: "push" | "replace" },
  ): NavigationResultLike;
  back(): NavigationResultLike;
  forward(): NavigationResultLike;
  updateCurrentEntry(options: { readonly state: unknown }): void;
}

/**
 * The slice of `window.history` the fallback calls.
 *
 * @since 0.1.0
 * @category models
 */
export interface HistoryLike {
  readonly state: unknown;
  pushState(data: unknown, unused: string, url: string): void;
  replaceState(data: unknown, unused: string, url: string): void;
  back(): void;
  forward(): void;
}

/**
 * The slice of `window.location` the fallback calls.
 *
 * @since 0.1.0
 * @category models
 */
export interface LocationLike {
  readonly href: string;
  assign(url: string): void;
  replace(url: string): void;
}

/**
 * The platform objects {@link make} builds over: `navigation` (the
 * Navigation API), else `history`, `location` and `window` (the target
 * `popstate` and `hashchange` fire on) together. Nothing, or an incomplete
 * fallback, is the unsupported service.
 *
 * @since 0.1.0
 * @category models
 */
export interface NavigationEnvironment {
  readonly navigation?: NavigationLike;
  readonly history?: HistoryLike;
  readonly location?: LocationLike;
  readonly window?: Stream.EventListener;
}

/**
 * Where a navigation is going, as an `intercept` handler sees it. `state`
 * is the destination entry's raw state (`undefined` for a new entry
 * without one).
 *
 * @since 0.1.0
 * @category models
 */
export interface Destination {
  readonly url: URL;
  readonly navigationType: NavigationType;
  readonly hashChange: boolean;
  readonly state: unknown;
}

/**
 * What {@link navigate} takes: `replace` the current entry rather than
 * push a new one, and the new entry's raw `state` (structured-cloned).
 *
 * @since 0.1.0
 * @category models
 */
export interface NavigateOptions {
  readonly replace?: boolean;
  readonly state?: unknown;
}

/**
 * Why a navigation failed: `Unsupported` (no Navigation API for
 * `intercept`, or no history at all), `InvalidUrl` (unparseable, or
 * cross-origin where only same-origin is allowed), `NotSerializable` (state
 * the structured-clone algorithm rejects), `Aborted` (a newer navigation
 * superseded it), `InvalidState` (no entry to go back or forward to, or a
 * document being unloaded), `Failed` (an `intercept` handler failed, or
 * anything else).
 *
 * @since 0.1.0
 * @category models
 */
export type NavigationErrorReason =
  | "Unsupported"
  | "InvalidUrl"
  | "NotSerializable"
  | "Aborted"
  | "InvalidState"
  | "Failed";

/**
 * A navigation call failed.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Navigation } from "@thomasfosterau/effect-platform-browser"
 *
 * Effect.runPromise(Effect.flip(Navigation.make({}).navigate("/next"))).then((error) =>
 *   console.log(error.reason), // "Unsupported"
 * )
 * ```
 *
 * @since 0.1.0
 * @category errors
 */
export class NavigationError extends Schema.TaggedError<NavigationError>()("NavigationError", {
  operation: Schema.Literals(["navigate", "back", "forward", "setState", "intercept"]),
  reason: Schema.Literals([
    "Unsupported",
    "InvalidUrl",
    "NotSerializable",
    "Aborted",
    "InvalidState",
    "Failed",
  ]),
  message: Schema.String,
  cause: Schema.Unknown,
}) {}

type Operation = NavigationError["operation"];

const REJECTION_REASONS = {
  AbortError: "Aborted",
  SyntaxError: "InvalidUrl",
  TypeError: "InvalidUrl",
  SecurityError: "InvalidUrl",
  DataCloneError: "NotSerializable",
  InvalidStateError: "InvalidState",
} satisfies Readonly<Record<string, NavigationErrorReason>>;

const navigationError = (operation: Operation, reason: NavigationErrorReason, cause: unknown) =>
  new NavigationError({ operation, reason, cause, message: `navigation ${operation}: ${reason}` });

const failure = (operation: Operation) => (cause: unknown) =>
  navigationError(operation, reasonOf(cause, REJECTION_REASONS, "Failed"), cause);

/**
 * The operations a {@link Navigation} offers.
 *
 * @since 0.1.0
 * @category models
 */
export interface NavigationService {
  /** `navigation`: the Navigation API; `history`: either it or the `history` fallback. */
  readonly supported: { readonly navigation: boolean; readonly history: boolean };
  /** The current URL; `None` without history (a server render, a worker). */
  readonly current: Effect.Effect<Option.Option<URL>>;
  /** The current URL first, then each change, deduplicated. Empty without history. */
  readonly changes: Stream.Stream<URL>;
  /** Navigates to `url`, resolved against the current one. */
  readonly navigate: (
    url: string | URL,
    options?: NavigateOptions,
  ) => Effect.Effect<void, NavigationError>;
  /** Goes back one entry. */
  readonly back: Effect.Effect<void, NavigationError>;
  /** Goes forward one entry. */
  readonly forward: Effect.Effect<void, NavigationError>;
  /** The current entry's raw state; `None` without one. */
  readonly state: Effect.Effect<Option.Option<unknown>>;
  /** Replaces the current entry's state, keeping its URL. */
  readonly setState: (state: unknown) => Effect.Effect<void, NavigationError>;
  /**
   * Takes over each interceptable navigation `handler` returns an effect
   * for, until the scope closes: the URL changes at once, and the
   * navigation finishes when the effect does. A newer navigation interrupts
   * it. Navigation API only.
   */
  readonly intercept: <E, R>(
    handler: (destination: Destination) => Option.Option<Effect.Effect<void, E, R>>,
  ) => Effect.Effect<void, NavigationError, R | Scope.Scope>;
}

/**
 * The browser's session history.
 *
 * @since 0.1.0
 * @category services
 */
export class Navigation extends Context.Service<Navigation, NavigationService>()(
  "@thomasfosterau/effect-platform-browser/Navigation",
) {}

const toUrl = (href: string): Option.Option<URL> =>
  Result.getSuccess(Result.try(() => new URL(href)));

const awaitFinished = (operation: Operation, result: () => NavigationResultLike) =>
  Effect.flatMap(Effect.try({ try: result, catch: failure(operation) }), (started) =>
    Effect.tryPromise({
      try: async () => {
        // The platform marks `committed` handled; a stand-in may not.
        started.committed?.catch(() => undefined);
        await started.finished;
      },
      catch: failure(operation),
    }),
  ).pipe(Effect.asVoid);

const destinationOf = (event: NavigateEventLike): Option.Option<Destination> =>
  Option.map(toUrl(event.destination.url), (url) => ({
    url,
    navigationType: event.navigationType,
    hashChange: event.hashChange,
    state: event.destination.getState(),
  }));

const overNavigation = (navigation: NavigationLike): NavigationService => {
  const href = (): Option.Option<string> => Option.fromNullishOr(navigation.currentEntry?.url);
  return {
    supported: { navigation: true, history: true },
    current: Effect.sync(() => Option.flatMap(href(), toUrl)),
    changes: watch(navigation, ["currententrychange"], href, Eq.equals).pipe(
      Stream.filterMap((entry) => Result.fromOption(Option.flatMap(entry, toUrl), constVoid)),
    ),
    navigate: (url, options) =>
      awaitFinished("navigate", () =>
        navigation.navigate(String(url), {
          state: options?.state,
          history: options?.replace === true ? "replace" : "push",
        }),
      ),
    back: awaitFinished("back", () => navigation.back()),
    forward: awaitFinished("forward", () => navigation.forward()),
    state: Effect.sync(() => Option.fromNullishOr(navigation.currentEntry?.getState())),
    setState: (state) =>
      Effect.try({
        try: () => navigation.updateCurrentEntry({ state }),
        catch: failure("setState"),
      }),
    intercept: <E, R>(
      handler: (destination: Destination) => Option.Option<Effect.Effect<void, E, R>>,
    ) =>
      Effect.flatMap(Effect.context<R>(), (context) => {
        const run = Effect.runPromiseWith(context);
        const onNavigate = (event: NavigateEventLike): void => {
          if (!event.canIntercept || event.downloadRequest !== null) return;
          const effect = Option.flatMap(destinationOf(event), handler);
          if (Option.isSome(effect)) {
            event.intercept({ handler: () => run(effect.value, { signal: event.signal }) });
          }
        };
        return Effect.acquireRelease(
          Effect.sync(() => navigation.addEventListener("navigate", onNavigate)),
          () => Effect.sync(() => navigation.removeEventListener("navigate", onNavigate)),
        );
      }),
  };
};

const unsupported = (operation: Operation) =>
  Effect.fail(navigationError(operation, "Unsupported", undefined));

/** Pushes made through this service: `pushState` fires no event of its own. */
const PUSHED = "effect-platform-browser:pushed";

const overHistory = (
  history: HistoryLike,
  location: LocationLike,
  window: Stream.EventListener,
): NavigationService => {
  const pushed: Array<(event: unknown) => void> = [];
  const events: Stream.EventListener = {
    addEventListener: (type, listener) => {
      if (type === PUSHED) pushed.push(listener);
      else window.addEventListener(type, listener);
    },
    removeEventListener: (type, listener) => {
      if (type === PUSHED) pushed.splice(pushed.indexOf(listener), 1);
      else window.removeEventListener(type, listener);
    },
  };
  return {
    supported: { navigation: false, history: true },
    current: Effect.sync(() => toUrl(location.href)),
    changes: watch(events, ["popstate", "hashchange", PUSHED], () => location.href).pipe(
      Stream.filterMap((href) => Result.fromOption(toUrl(href), constVoid)),
    ),
    navigate: (url, options) =>
      Effect.try({
        try: () => {
          const target = new URL(url, location.href);
          const replace = options?.replace === true;
          if (target.origin !== new URL(location.href).origin) {
            if (replace) location.replace(target.href);
            else location.assign(target.href);
            return;
          }
          if (replace) history.replaceState(options?.state, "", target.href);
          else history.pushState(options?.state, "", target.href);
          Arr.forEach([...pushed], (listener) => listener(undefined));
        },
        catch: failure("navigate"),
      }),
    back: Effect.sync(() => history.back()),
    forward: Effect.sync(() => history.forward()),
    state: Effect.sync(() => Option.fromNullishOr(history.state)),
    setState: (state) =>
      Effect.try({
        try: () => history.replaceState(state, "", location.href),
        catch: failure("setState"),
      }),
    intercept: () => unsupported("intercept"),
  };
};

const unsupportedService = (): NavigationService => {
  return {
    supported: { navigation: false, history: false },
    current: Effect.succeedNone,
    changes: Stream.empty,
    navigate: () => unsupported("navigate"),
    back: unsupported("back"),
    forward: unsupported("forward"),
    state: Effect.succeedNone,
    setState: () => unsupported("setState"),
    intercept: () => unsupported("intercept"),
  };
};

/**
 * Builds the {@link Navigation} service over the given platform objects:
 * the Navigation API where given, else the `history` fallback. {@link layer}
 * passes the ambient ones.
 *
 * @example
 * ```ts
 * import { Navigation } from "@thomasfosterau/effect-platform-browser"
 *
 * console.log(Navigation.make({}).supported) // { navigation: false, history: false }
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = (environment: NavigationEnvironment): NavigationService => {
  if (environment.navigation !== undefined) return overNavigation(environment.navigation);
  const { history, location, window } = environment;
  return history !== undefined && location !== undefined && window !== undefined
    ? overHistory(history, location, window)
    : unsupportedService();
};

/**
 * {@link Navigation} over the ambient `navigation`, else `history`,
 * `location` and the window.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Navigation } from "@thomasfosterau/effect-platform-browser"
 *
 * // Under Node there is no history: the URL is None.
 * Effect.runPromise(Effect.provide(Navigation.current, Navigation.layer)).then(console.log)
 * ```
 *
 * @since 0.1.0
 * @category layers
 */
export const layer: Layer.Layer<Navigation> = Layer.sync(Navigation, () =>
  make({
    ...Option.match(ambientNavigation(), {
      onNone: () => ({}),
      onSome: (navigation) => ({ navigation }),
    }),
    ...Option.match(ambientHistory(), { onNone: () => ({}), onSome: (history) => ({ history }) }),
    ...Option.match(ambientLocation(), {
      onNone: () => ({}),
      onSome: (location) => ({ location }),
    }),
    ...Option.match(ambientEventTarget(), {
      onNone: () => ({}),
      onSome: (window) => ({ window }),
    }),
  }),
);

/**
 * The current URL.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Navigation } from "@thomasfosterau/effect-platform-browser"
 * import { TestNavigation } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Navigation.current.pipe(Effect.provide(TestNavigation.layer({ url: "https://example.com/a" })))
 * Effect.runPromise(program).then((url) => console.log(url)) // Some(URL "https://example.com/a")
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const current: Effect.Effect<Option.Option<URL>, never, Navigation> = Navigation.use(
  (self) => self.current,
);

/**
 * The current URL first, then each change: a link the router took over,
 * the back button, a hash change.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Fiber from "effect/Fiber"
 * import { Navigation } from "@thomasfosterau/effect-platform-browser"
 * import { TestNavigation, observe } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.gen(function* () {
 *   const seen = yield* observe(Navigation.changes, 2)
 *   yield* Navigation.navigate("/next")
 *   return (yield* Fiber.join(seen)).map((url) => url.pathname)
 * })
 * Effect.runPromise(Effect.provide(program, TestNavigation.layer())).then(console.log) // ["/", "/next"]
 * ```
 *
 * @since 0.1.0
 * @category streams
 */
export const changes: Stream.Stream<URL, never, Navigation> = Stream.unwrap(
  Navigation.use((self) => Effect.succeed(self.changes)),
);

/**
 * Navigates to `url`, resolved against the current URL. With the
 * Navigation API, completes once every `intercept` handler finished.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Navigation } from "@thomasfosterau/effect-platform-browser"
 * import { TestNavigation } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.andThen(Navigation.navigate("/settings", { replace: true }), Navigation.current)
 * Effect.runPromise(Effect.provide(program, TestNavigation.layer())).then(console.log)
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const navigate = (
  url: string | URL,
  options?: NavigateOptions,
): Effect.Effect<void, NavigationError, Navigation> =>
  Navigation.use((self) => self.navigate(url, options));

/**
 * Goes back one entry.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Navigation } from "@thomasfosterau/effect-platform-browser"
 * import { TestNavigation } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.gen(function* () {
 *   yield* Navigation.navigate("/a")
 *   yield* Navigation.back
 *   return yield* Navigation.current
 * })
 * Effect.runPromise(Effect.provide(program, TestNavigation.layer())).then(console.log)
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const back: Effect.Effect<void, NavigationError, Navigation> = Navigation.use(
  (self) => self.back,
);

/**
 * Goes forward one entry.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Navigation } from "@thomasfosterau/effect-platform-browser"
 * import { TestNavigation } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.flip(Navigation.forward)
 * Effect.runPromise(Effect.provide(program, TestNavigation.layer())).then((error) =>
 *   console.log(error.reason), // "InvalidState": there is no entry ahead
 * )
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const forward: Effect.Effect<void, NavigationError, Navigation> = Navigation.use(
  (self) => self.forward,
);

/**
 * The current entry's state, decoded by `schema`: `None` without state, or
 * with state that does not decode (one written by an older deploy).
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Schema from "effect/Schema"
 * import { Navigation } from "@thomasfosterau/effect-platform-browser"
 * import { TestNavigation } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const Scroll = Schema.Struct({ y: Schema.Number })
 * const program = Effect.andThen(Navigation.setState(Scroll, { y: 120 }), Navigation.state(Scroll))
 * Effect.runPromise(Effect.provide(program, TestNavigation.layer())).then(console.log) // Some({ y: 120 })
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const state = <S extends Schema.Top>(
  schema: S,
): Effect.Effect<Option.Option<S["Type"]>, never, Navigation | S["DecodingServices"]> =>
  Navigation.use((self) =>
    Effect.flatMap(self.state, (raw) =>
      Option.match(raw, {
        onNone: () => Effect.succeedNone,
        onSome: (value) => Effect.option(Schema.decodeUnknownEffect(schema)(value)),
      }),
    ),
  );

/**
 * Replaces the current entry's state with `value`, encoded by `schema`.
 * Fails `NotSerializable` where the value does not encode or the encoded
 * form cannot be structured-cloned.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Schema from "effect/Schema"
 * import { Navigation } from "@thomasfosterau/effect-platform-browser"
 * import { TestNavigation } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const Tab = Schema.Struct({ tab: Schema.String })
 * const program = Navigation.setState(Tab, { tab: "billing" })
 * Effect.runPromise(Effect.provide(program, TestNavigation.layer()))
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const setState = <S extends Schema.Top>(
  schema: S,
  value: S["Type"],
): Effect.Effect<void, NavigationError, Navigation | S["EncodingServices"]> =>
  Navigation.use((self) =>
    Schema.encodeUnknownEffect(schema)(value).pipe(
      Effect.mapError((cause) => navigationError("setState", "NotSerializable", cause)),
      Effect.flatMap(self.setState),
    ),
  );

/**
 * Takes over each navigation `handler` returns an effect for, until the
 * scope closes: the URL changes at once, the effect renders the
 * destination, and a newer navigation interrupts it. Navigations the page
 * cannot intercept (cross-origin, downloads) are left to the browser.
 * Fails `Unsupported` without the Navigation API.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import { Navigation } from "@thomasfosterau/effect-platform-browser"
 * import { TestNavigation } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.gen(function* () {
 *   yield* Navigation.intercept((destination) =>
 *     destination.url.pathname.startsWith("/app")
 *       ? Option.some(Effect.log(`render ${destination.url.pathname}`))
 *       : Option.none(),
 *   )
 *   yield* Navigation.navigate("/app/inbox")
 * })
 * Effect.runPromise(program.pipe(Effect.scoped, Effect.provide(TestNavigation.layer())))
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const intercept = <E, R>(
  handler: (destination: Destination) => Option.Option<Effect.Effect<void, E, R>>,
): Effect.Effect<void, NavigationError, Navigation | R | Scope.Scope> =>
  Navigation.use((self) => self.intercept(handler));
