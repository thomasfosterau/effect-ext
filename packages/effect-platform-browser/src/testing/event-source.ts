/**
 * A controllable server for tests of code that uses `EventSource` (from
 * `@thomasfosterau/effect-platform-worker-shared`): {@link layer} provides
 * the real adapter over an in-memory `EventSource`, plus {@link Control},
 * which sends events down each connection, drops it (the browser
 * reconnects) or refuses it (the browser gives up), as a server would.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  type EventSourceConstructorLike,
  EventSourceClient,
  type EventSourceService,
  make as makeEventSource,
} from "@thomasfosterau/effect-platform-worker-shared/EventSource";

/**
 * The in-memory server's setup: `supported` (default `true`) builds the
 * unsupported service when `false`; `baseUrl` (default
 * `"https://example.com/"`) is what a relative URL resolves against, as the
 * document's URL is in a browser.
 *
 * @since 0.1.0
 * @category models
 */
export interface Options {
  readonly supported?: boolean;
  readonly baseUrl?: string;
}

/**
 * One `EventSource` the code under test opened: its resolved `url`,
 * `withCredentials`, its `state`, the `lastEventId` the browser would send
 * on reconnecting (`""` before any event carried an id), and how many
 * times it has `reconnected`.
 *
 * @since 0.1.0
 * @category models
 */
export interface Connection {
  readonly url: string;
  readonly withCredentials: boolean;
  readonly state: "connecting" | "open" | "closed";
  readonly lastEventId: string;
  readonly reconnected: number;
}

/**
 * An event the server sends: `event` (default `"message"`) is its type, as
 * an `event:` line names it; `id`, when given, becomes the connection's
 * last event id.
 *
 * @since 0.1.0
 * @category models
 */
export interface ServerEvent {
  readonly data: string;
  readonly event?: string;
  readonly id?: string;
}

/**
 * Drives the in-memory server. Each call acts on every live connection to
 * `url` (resolved against the base URL): `connected` waits until there is
 * one; `send` delivers events, opening the connection first if it was
 * connecting; `drop` loses it, and the browser starts reconnecting; `refuse`
 * answers it with an error status, and the browser closes it for good.
 * `connections` lists every connection opened, closed ones included.
 *
 * @since 0.1.0
 * @category services
 */
export class Control extends Context.Service<
  Control,
  {
    readonly connected: (url: string) => Effect.Effect<void>;
    readonly send: (url: string, events: ReadonlyArray<ServerEvent>) => Effect.Effect<void>;
    readonly drop: (url: string) => Effect.Effect<void>;
    readonly refuse: (url: string) => Effect.Effect<void>;
    readonly connections: Effect.Effect<ReadonlyArray<Connection>>;
  }
>()("@thomasfosterau/effect-platform-browser/BrowserTesting/EventSourceControl") {}

/**
 * What {@link make} builds: the `EventSourceClient` service over the
 * in-memory server, and the {@link Control} that drives it.
 *
 * @since 0.1.0
 * @category models
 */
export interface Fixture {
  readonly client: EventSourceService;
  readonly control: Control["Service"];
}

const STATES = ["connecting", "open", "closed"] as const;

/** The platform's refusal of a URL it cannot parse, built outside any `Effect.gen`. */
const syntaxError = (url: string): DOMException =>
  new DOMException(`cannot parse ${url}`, "SyntaxError");

/**
 * Builds an in-memory server: the `EventSourceClient` service over it, and
 * its {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Fiber from "effect/Fiber"
 * import * as Stream from "effect/Stream"
 * import { TestEventSource } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const { client, control } = TestEventSource.make()
 * const program = Effect.gen(function* () {
 *   const first = yield* Effect.forkChild(Stream.runHead(client.connect("/feed")))
 *   yield* control.connected("/feed")
 *   yield* control.send("/feed", [{ data: "hello" }])
 *   return yield* Fiber.join(first)
 * })
 * Effect.runPromise(Effect.scoped(program)).then(console.log)
 * // Some({ _tag: "Event", event: "message", id: undefined, data: "hello" })
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = (options?: Options): Fixture => {
  const baseUrl = options?.baseUrl ?? "https://example.com/";
  const sources: Array<FakeEventSource> = [];
  const waiters: Array<{ readonly url: string; readonly resume: () => void }> = [];

  const resolve = (url: string | URL): string => {
    if (!URL.canParse(url, baseUrl)) throw syntaxError(String(url));
    return new URL(url, baseUrl).href;
  };

  class FakeEventSource extends EventTarget {
    readyState: 0 | 1 | 2 = 0;
    lastEventId = "";
    reconnected = 0;
    readonly url: string;
    readonly withCredentials: boolean;
    constructor(url: string | URL, init?: { readonly withCredentials?: boolean }) {
      super();
      this.url = resolve(url);
      this.withCredentials = Boolean(init?.withCredentials);
      sources.push(this);
    }
    /**
     * A connection counts as made once the adapter listens to it: the
     * waiters resume on a microtask, after the adapter has attached all its
     * listeners in one go.
     */
    override addEventListener(...args: Parameters<EventTarget["addEventListener"]>): void {
      super.addEventListener(...args);
      queueMicrotask(() => this.#notify());
    }
    #notify(): void {
      const ready = Arr.filter(waiters, (waiter) => waiter.url === this.url);
      waiters.splice(
        0,
        waiters.length,
        ...Arr.filter(waiters, (waiter) => waiter.url !== this.url),
      );
      Arr.forEach(ready, (waiter) => waiter.resume());
    }
    close(): void {
      this.readyState = 2;
    }
    deliver(event: ServerEvent): void {
      if (this.readyState === 0) {
        this.readyState = 1;
        this.dispatchEvent(new Event("open"));
      }
      if (event.id !== undefined) this.lastEventId = event.id;
      this.dispatchEvent(
        new MessageEvent(event.event ?? "message", {
          data: event.data,
          lastEventId: this.lastEventId,
        }),
      );
    }
    fail(readyState: 0 | 2): void {
      this.readyState = readyState;
      if (readyState === 0) this.reconnected += 1;
      this.dispatchEvent(new Event("error"));
    }
  }
  const Source: EventSourceConstructorLike = FakeEventSource;

  const live = (url: string): ReadonlyArray<FakeEventSource> => {
    const href = resolve(url);
    return Arr.filter(sources, (source) => source.url === href && source.readyState !== 2);
  };

  return {
    client: makeEventSource(options?.supported === false ? undefined : Source),
    control: Control.of({
      connected: (url) =>
        Effect.callback<void>((resume) => {
          if (Arr.isReadonlyArrayNonEmpty(live(url))) resume(Effect.void);
          else waiters.push({ url: resolve(url), resume: () => resume(Effect.void) });
        }),
      send: (url, events) =>
        Effect.sync(() =>
          Arr.forEach(live(url), (source) => Arr.forEach(events, (event) => source.deliver(event))),
        ),
      drop: (url) => Effect.sync(() => Arr.forEach(live(url), (source) => source.fail(0))),
      refuse: (url) => Effect.sync(() => Arr.forEach(live(url), (source) => source.fail(2))),
      connections: Effect.sync(() =>
        Arr.map(sources, (source) => ({
          url: source.url,
          withCredentials: source.withCredentials,
          state: STATES[source.readyState],
          lastEventId: source.lastEventId,
          reconnected: source.reconnected,
        })),
      ),
    }),
  };
};

/**
 * Provides `EventSourceClient` over a fresh in-memory server, and its
 * {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Fiber from "effect/Fiber"
 * import * as Stream from "effect/Stream"
 * import { EventSource } from "@thomasfosterau/effect-platform-worker-shared"
 * import { TestEventSource } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.gen(function* () {
 *   const control = yield* TestEventSource.Control
 *   const ticks = yield* Effect.forkChild(
 *     Stream.runCollect(Stream.take(EventSource.connect("/ticks", { events: ["tick"] }), 2)),
 *   )
 *   yield* control.connected("/ticks")
 *   yield* control.send("/ticks", [
 *     { event: "tick", data: "1", id: "1" },
 *     { event: "tick", data: "2", id: "2" },
 *   ])
 *   return yield* Fiber.join(ticks)
 * })
 * Effect.runPromise(Effect.provide(program, TestEventSource.layer())).then(console.log)
 * ```
 *
 * @since 0.1.0
 * @category layers
 */
export const layer = (options?: Options): Layer.Layer<Control> =>
  Layer.syncContext(() => {
    const { client, control } = make(options);
    return Context.make(EventSourceClient, client).pipe(Context.add(Control, control));
  });
