import { describe, expect, it } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Logger from "effect/Logger";
import * as Order from "effect/Order";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as EventSource from "@thomasfosterau/effect-platform-worker-shared/EventSource";

/** An `EventSource` the test drives, recording each connection. */
const stubSource = (refuse?: () => never) => {
  const sources: Array<Source> = [];
  class Source extends EventTarget {
    readyState = 0;
    readonly url: string;
    readonly withCredentials: boolean;
    constructor(url: string | URL, init?: { readonly withCredentials?: boolean }) {
      super();
      if (refuse !== undefined) refuse();
      this.url = String(url);
      this.withCredentials = init?.withCredentials ?? false;
      sources.push(this);
    }
    close(): void {
      this.readyState = 2;
    }
    send(type: string, data: string, lastEventId = ""): void {
      this.readyState = 1;
      this.dispatchEvent(new MessageEvent(type, { data, lastEventId }));
    }
    error(readyState: number): void {
      this.readyState = readyState;
      this.dispatchEvent(new Event("error"));
    }
  }
  const Constructor: EventSource.EventSourceConstructorLike = Source;
  return { service: EventSource.make(Constructor), sources };
};

/** A constructor body that throws `refusal`, as the platform's does. */
const thrower = (refusal: DOMException) => (): never => {
  throw refusal;
};

/** Yields until `check` holds: a forked stream attaches its listeners on a later tick. */
const eventually = (check: () => boolean, tries = 100): Effect.Effect<void> =>
  check() || tries === 0
    ? Effect.void
    : Effect.andThen(
        Effect.yieldNow,
        Effect.suspend(() => eventually(check, tries - 1)),
      );

/** Collects every message logged while `effect` runs. */
const logged = <A, E>(effect: Effect.Effect<A, E>) => {
  const messages: Array<string> = [];
  const logger = Logger.make(({ message }) => {
    messages.push(...Arr.map(Arr.ensure(message), String));
  });
  return Effect.map(Effect.provide(effect, Logger.layer([logger])), (value) => ({
    value,
    messages,
  }));
};

describe("EventSource.make", () => {
  it.effect("fails Unsupported without the API, as the ambient default does under Node", () =>
    Effect.gen(function* () {
      expect(EventSource.make().supported).toBe(false);
      const error = yield* Effect.flip(Stream.runDrain(EventSource.connect("/events")));
      expect([error.reason, error.url]).toEqual(["Unsupported", "/events"]);
    }),
  );

  it.effect("maps a constructor's refusal onto a reason", () =>
    Effect.gen(function* () {
      const reasons = yield* Effect.forEach(
        [new DOMException("bad URL", "SyntaxError"), new DOMException("CSP", "SecurityError")],
        (refusal) =>
          Effect.map(
            Effect.flip(Stream.runDrain(stubSource(thrower(refusal)).service.connect("http://["))),
            (error) => error.reason,
          ),
        { concurrency: 1 },
      );
      expect(reasons).toEqual(["InvalidUrl", "Failed"]);
    }),
  );

  it.effect("emits the listed event types in the Sse shape, then closes with the scope", () =>
    Effect.gen(function* () {
      const { service, sources } = stubSource();
      expect(service.supported).toBe(true);
      const fiber = yield* Effect.forkChild(
        Stream.runCollect(
          Stream.take(
            service.connect(new URL("https://example.com/feed"), {
              withCredentials: true,
              events: ["message", "tick"],
            }),
            4,
          ),
        ),
      );
      yield* eventually(() => sources.length === 1);
      const [source] = sources;
      source?.send("message", "hello");
      source?.send("ignored", "not listed", "1");
      source?.send("tick", "1", "7");
      source?.send("message", "again", "7");
      source?.dispatchEvent(new Event("message"));
      expect(yield* Fiber.join(fiber)).toEqual([
        { _tag: "Event", event: "message", id: undefined, data: "hello" },
        { _tag: "Event", event: "tick", id: "7", data: "1" },
        { _tag: "Event", event: "message", id: "7", data: "again" },
        { _tag: "Event", event: "message", id: undefined, data: "" },
      ]);
      expect([source?.url, source?.withCredentials, source?.readyState]).toEqual([
        "https://example.com/feed",
        true,
        2,
      ]);
    }),
  );

  it.effect("logs a dropped connection and carries on, and fails once the browser gives up", () =>
    Effect.gen(function* () {
      const { service, sources } = stubSource();
      const fiber = yield* Effect.forkChild(
        logged(
          Effect.flip(
            Stream.runForEach(service.connect("/events"), (event) =>
              Effect.log(`received ${event.data}`),
            ),
          ),
        ),
      );
      yield* eventually(() => sources.length === 1);
      const [source] = sources;
      source?.send("message", "first");
      source?.error(0);
      source?.send("message", "second");
      source?.error(2);
      const { value: error, messages } = yield* Fiber.join(fiber);
      expect([error.reason, error.url]).toEqual(["Closed", "/events"]);
      expect(Arr.sort(messages, Order.String)).toEqual([
        "EventSource /events: connection lost, reconnecting",
        "received first",
        "received second",
      ]);
      expect(sources[0]?.withCredentials).toBe(false);
    }),
  );
});

describe("EventSource.events", () => {
  const Quote = Schema.Struct({ symbol: Schema.String, price: Schema.Number });

  it.effect("decodes each payload as JSON, dropping one that does not decode", () =>
    Effect.gen(function* () {
      const { service, sources } = stubSource();
      const fiber = yield* Effect.forkChild(
        logged(
          Stream.runCollect(Stream.take(EventSource.events("/prices", Quote), 2)).pipe(
            Effect.provideService(EventSource.EventSourceClient, service),
          ),
        ),
      );
      yield* eventually(() => sources.length === 1);
      const [source] = sources;
      source?.send("message", '{"symbol":"ACME","price":1}');
      source?.send("message", "not json");
      source?.send("message", '{"symbol":"ACME"}');
      source?.send("message", '{"symbol":"ACME","price":2}');
      const { value, messages } = yield* Fiber.join(fiber);
      expect(value).toEqual([
        { symbol: "ACME", price: 1 },
        { symbol: "ACME", price: 2 },
      ]);
      expect(Arr.filter(messages, (message) => message.endsWith("dropped an event"))).toEqual([
        "EventSource /prices: dropped an event",
        "EventSource /prices: dropped an event",
      ]);
    }),
  );
});
