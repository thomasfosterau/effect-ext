/**
 * A controllable session history for tests of code that uses `Navigation`:
 * {@link layer} provides the real adapter over an in-memory Navigation API
 * (or, with `api: "history"`, an in-memory `history`, `location` and
 * window), plus {@link Control} to act as the user would: follow a link,
 * press back or forward.
 *
 * Every navigation commits, cross-document ones included: the double
 * stands in for the page that would load.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import type * as Stream from "effect/Stream";
import {
  type HistoryEntryLike,
  type HistoryLike,
  type LocationLike,
  type NavigateEventLike,
  Navigation,
  type NavigationEnvironment,
  type NavigationLike,
  type NavigationResultLike,
  type NavigationService,
  type NavigationType,
  make as makeNavigation,
} from "../Navigation.ts";
import { pendingPromise } from "../internal/dom.ts";

/**
 * The in-memory history's starting state: `api` (default `"navigation"`)
 * picks the Navigation API, the `"history"` fallback, or `"none"` (the
 * unsupported service); `url` (default `"https://example.com/"`) is the
 * first entry.
 *
 * @since 0.1.0
 * @category models
 */
export interface Options {
  readonly api?: "navigation" | "history" | "none";
  readonly url?: string;
}

/**
 * Drives the in-memory history as the user would: `navigate` follows a
 * link (`download` makes it a download link, which no page may intercept);
 * `back` and `forward` press the browser's buttons. `entries` and `index`
 * read the session history.
 *
 * @since 0.1.0
 * @category services
 */
export class Control extends Context.Service<
  Control,
  {
    readonly navigate: (
      url: string,
      options?: { readonly download?: string },
    ) => Effect.Effect<void>;
    readonly back: Effect.Effect<void>;
    readonly forward: Effect.Effect<void>;
    readonly entries: Effect.Effect<ReadonlyArray<string>>;
    readonly index: Effect.Effect<number>;
  }
>()("@thomasfosterau/effect-platform-browser/BrowserTesting/NavigationControl") {}

/**
 * What {@link make} builds: the `Navigation` service over the in-memory
 * history, and the {@link Control} that drives it.
 *
 * @since 0.1.0
 * @category models
 */
export interface Fixture {
  readonly navigation: NavigationService;
  readonly control: Control["Service"];
}

interface Entry {
  readonly url: string;
  state: unknown;
}

/** One session history, shared by both platform stand-ins. */
class Session {
  readonly entries: Array<Entry>;
  index = 0;
  constructor(url: string) {
    this.entries = [{ url, state: undefined }];
  }
  get current(): Entry {
    // The index always points into `entries`.
    return Arr.getUnsafe(this.entries, this.index);
  }
  push(url: string, state: unknown): void {
    this.entries.splice(this.index + 1);
    this.entries.push({ url, state });
    this.index = this.entries.length - 1;
  }
  replace(url: string, state: unknown): void {
    this.entries[this.index] = { url, state };
  }
}

/** A minimal event target whose listeners take whatever the double dispatches. */
class Listeners<A> implements Stream.EventListener<A> {
  readonly #byType: Array<{ readonly type: string; readonly listener: (event: A) => void }> = [];
  addEventListener(type: string, listener: (event: A) => void): void {
    this.#byType.push({ type, listener });
  }
  removeEventListener(type: string, listener: (event: A) => void): void {
    const index = this.#byType.findIndex(
      (entry) => entry.type === type && entry.listener === listener,
    );
    this.#byType.splice(index, 1);
  }
  dispatch(type: string, event: A): void {
    Arr.forEach(
      Arr.filter([...this.#byType], (entry) => entry.type === type),
      (entry) => entry.listener(event),
    );
  }
}

const sameDocumentHash = (from: string, to: string): boolean => {
  const a = new URL(from);
  const b = new URL(to);
  return a.hash !== b.hash && a.href.split("#")[0] === b.href.split("#")[0];
};

const clone = (value: unknown): unknown => structuredClone(value);

/** A `NavigationResult` whose rejections nobody need observe. */
const handled = (committed: Promise<unknown>, finished: Promise<unknown>) => {
  committed.catch(() => undefined);
  finished.catch(() => undefined);
  return { committed, finished };
};

const rejected = (reason: DOMException): NavigationResultLike =>
  handled(Promise.reject(reason), Promise.reject(reason));

/** A navigation in flight: its event's controller and how to fail it. */
interface InFlight {
  readonly controller: AbortController;
  readonly fail: (error: unknown) => void;
}

class TestNavigateEvent implements NavigateEventLike {
  readonly navigationType: NavigationType;
  readonly destination: { readonly url: string; getState(): unknown };
  readonly canIntercept: boolean;
  readonly hashChange: boolean;
  readonly downloadRequest: string | null;
  readonly signal: AbortSignal;
  readonly handlers: Array<() => Promise<void>> = [];
  constructor(fields: Omit<NavigateEventLike, "intercept">) {
    this.navigationType = fields.navigationType;
    this.destination = fields.destination;
    this.canIntercept = fields.canIntercept;
    this.hashChange = fields.hashChange;
    this.downloadRequest = fields.downloadRequest;
    this.signal = fields.signal;
  }
  intercept(options: { readonly handler: () => Promise<void> }): void {
    this.handlers.push(options.handler);
  }
}

/** The Navigation API over a {@link Session}, following the navigate algorithm's broad strokes. */
class TestNavigationApi extends Listeners<NavigateEventLike> implements NavigationLike {
  readonly #session: Session;
  #inFlight: Option.Option<InFlight> = Option.none();
  constructor(session: Session) {
    super();
    this.#session = session;
  }
  get currentEntry(): HistoryEntryLike {
    const entry = this.#session.current;
    return { url: entry.url, getState: () => clone(entry.state) };
  }
  navigate(
    url: string,
    options: { readonly state: unknown; readonly history: "push" | "replace" },
  ): NavigationResultLike {
    return this.start(url, options.history, clone(options.state), Option.none(), null);
  }
  back(): NavigationResultLike {
    return this.#traverse(this.#session.index - 1);
  }
  forward(): NavigationResultLike {
    return this.#traverse(this.#session.index + 1);
  }
  updateCurrentEntry(options: { readonly state: unknown }): void {
    this.#session.current.state = clone(options.state);
  }
  #traverse(index: number): NavigationResultLike {
    const target = this.#session.entries[index];
    if (target === undefined) {
      return rejected(new DOMException("no entry to traverse to", "InvalidStateError"));
    }
    return this.start(target.url, "traverse", target.state, Option.some(index), null);
  }
  /** Starts a navigation: fire `navigate`, commit, then settle once its handlers do. */
  start(
    url: string,
    navigationType: NavigationType,
    state: unknown,
    traverseTo: Option.Option<number>,
    downloadRequest: string | null,
  ): NavigationResultLike {
    const parsed = Result.try(() => new URL(url, this.#session.current.url).href);
    if (Result.isFailure(parsed)) {
      return rejected(new DOMException(`invalid URL ${url}`, "SyntaxError"));
    }
    const href = parsed.success;
    Option.map(this.#inFlight, (previous) => {
      previous.controller.abort();
      previous.fail(new DOMException("superseded by a newer navigation", "AbortError"));
    });
    const controller = new AbortController();
    const committed = pendingPromise();
    const settle = { failure: Option.none<unknown>() };
    const finished = pendingPromise();
    const finishedOrFailed = finished.promise.then(() =>
      Option.match(settle.failure, {
        onNone: () => undefined,
        onSome: (reason) => Promise.reject(reason),
      }),
    );
    const inFlight: InFlight = {
      controller,
      fail: (error) => {
        settle.failure = Option.orElse(settle.failure, () => Option.some(error));
        finished.resolve();
      },
    };
    this.#inFlight = Option.some(inFlight);
    const event = new TestNavigateEvent({
      navigationType,
      destination: { url: href, getState: () => clone(state) },
      canIntercept:
        downloadRequest === null &&
        new URL(href).origin === new URL(this.#session.current.url).origin,
      hashChange:
        navigationType !== "traverse" && sameDocumentHash(this.#session.current.url, href),
      downloadRequest,
      signal: controller.signal,
    });
    this.dispatch("navigate", event);
    if (downloadRequest === null) {
      Option.match(traverseTo, {
        onNone: () =>
          navigationType === "replace"
            ? this.#session.replace(href, state)
            : this.#session.push(href, state),
        onSome: (index) => {
          this.#session.index = index;
        },
      });
      this.dispatch("currententrychange", event);
    }
    committed.resolve();
    Promise.all(Arr.map(event.handlers, (handler) => handler())).then(
      () => finished.resolve(),
      (error: unknown) => inFlight.fail(error),
    );
    finishedOrFailed.then(
      () => this.#clear(inFlight),
      () => this.#clear(inFlight),
    );
    return handled(committed.promise, finishedOrFailed);
  }
  #clear(inFlight: InFlight): void {
    this.#inFlight = Option.filter(this.#inFlight, (current) => current !== inFlight);
  }
}

/** `history` over a {@link Session}: `back` and `forward` fire `popstate` (and `hashchange`). */
class TestHistory implements HistoryLike {
  readonly #session: Session;
  readonly #window: Listeners<unknown>;
  constructor(session: Session, window: Listeners<unknown>) {
    this.#session = session;
    this.#window = window;
  }
  get state(): unknown {
    return this.#session.current.state;
  }
  // The adapter only pushes same-origin URLs, so neither checks the origin.
  pushState(data: unknown, _unused: string, url: string): void {
    this.#session.push(this.#resolve(url), clone(data));
  }
  replaceState(data: unknown, _unused: string, url: string): void {
    this.#session.replace(this.#resolve(url), clone(data));
  }
  back(): void {
    this.go(-1);
  }
  forward(): void {
    this.go(1);
  }
  go(delta: number): void {
    const from = this.#session.current.url;
    const index = this.#session.index + delta;
    if (this.#session.entries[index] === undefined) return;
    this.#session.index = index;
    this.#window.dispatch("popstate", undefined);
    if (sameDocumentHash(from, this.#session.current.url)) {
      this.#window.dispatch("hashchange", undefined);
    }
  }
  #resolve(url: string): string {
    return new URL(url, this.#session.current.url).href;
  }
}

/** `location` over a {@link Session}: assigning loads a new document, firing nothing here. */
class TestLocation implements LocationLike {
  readonly #session: Session;
  constructor(session: Session) {
    this.#session = session;
  }
  get href(): string {
    return this.#session.current.url;
  }
  assign(url: string): void {
    this.#session.push(new URL(url, this.href).href, undefined);
  }
  replace(url: string): void {
    this.#session.replace(new URL(url, this.href).href, undefined);
  }
}

/**
 * Builds an in-memory session history: the `Navigation` service over it,
 * and its {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { TestNavigation } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const { navigation, control } = TestNavigation.make({ url: "https://example.com/start" })
 * Effect.runPromise(Effect.andThen(navigation.navigate("/next"), control.entries)).then(console.log)
 * // ["https://example.com/start", "https://example.com/next"]
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = (options?: Options): Fixture => {
  const session = new Session(new URL(options?.url ?? "https://example.com/").href);
  const window = new Listeners<unknown>();
  const api = new TestNavigationApi(session);
  const history = new TestHistory(session, window);
  const location = new TestLocation(session);
  const mode = options?.api ?? "navigation";
  const environments: Readonly<Record<typeof mode, NavigationEnvironment>> = {
    navigation: { navigation: api },
    history: { history, location, window },
    none: {},
  };
  const followLink = (url: string, download: string | undefined): void => {
    if (mode === "navigation") {
      api.start(url, "push", undefined, Option.none(), download ?? null);
      return;
    }
    const target = new URL(url, location.href).href;
    const hashOnly = sameDocumentHash(location.href, target);
    location.assign(target);
    if (hashOnly) window.dispatch("hashchange", undefined);
  };
  const press = (delta: -1 | 1) =>
    Effect.sync(() => {
      if (mode === "navigation") {
        if (delta === -1) api.back();
        else api.forward();
      } else history.go(delta);
    });
  return {
    navigation: makeNavigation(environments[mode]),
    control: Control.of({
      navigate: (url, linkOptions) => Effect.sync(() => followLink(url, linkOptions?.download)),
      back: press(-1),
      forward: press(1),
      entries: Effect.sync(() => Arr.map(session.entries, (entry) => entry.url)),
      index: Effect.sync(() => session.index),
    }),
  };
};

/**
 * Provides `Navigation` over a fresh in-memory session history, and its
 * {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Navigation } from "@thomasfosterau/effect-platform-browser"
 * import { TestNavigation } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.gen(function* () {
 *   const control = yield* TestNavigation.Control
 *   yield* Navigation.navigate("/a")
 *   yield* control.back
 *   return yield* Navigation.current
 * })
 * Effect.runPromise(Effect.provide(program, TestNavigation.layer({ api: "history" }))).then(console.log)
 * ```
 *
 * @since 0.1.0
 * @category layers
 */
export const layer = (options?: Options): Layer.Layer<Navigation | Control> =>
  Layer.syncContext(() => {
    const { navigation, control } = make(options);
    return Context.make(Navigation, navigation).pipe(Context.add(Control, control));
  });
