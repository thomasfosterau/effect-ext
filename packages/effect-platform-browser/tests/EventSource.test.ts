import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { EventSource } from "@thomasfosterau/effect-platform-worker-shared";
import { TestEventSource } from "@thomasfosterau/effect-platform-browser/BrowserTesting";

const control = Effect.service(TestEventSource.Control);

describe("TestEventSource", () => {
  it.effect("delivers named events with their ids, resolving relative URLs", () =>
    Effect.gen(function* () {
      const c = yield* control;
      const fiber = yield* Effect.forkChild(
        Stream.runCollect(
          Stream.take(
            EventSource.connect("/feed", { events: ["message", "tick"], withCredentials: true }),
            3,
          ),
        ),
      );
      yield* c.connected("https://example.com/feed");
      expect((yield* c.connections)[0]?.state).toBe("connecting");
      yield* c.send("/feed", [
        { data: "hello" },
        { event: "tick", data: "1", id: "1" },
        { event: "other", data: "unheard" },
        { data: "bye" },
      ]);
      expect(yield* Fiber.join(fiber)).toEqual([
        { _tag: "Event", event: "message", id: undefined, data: "hello" },
        { _tag: "Event", event: "tick", id: "1", data: "1" },
        { _tag: "Event", event: "message", id: "1", data: "bye" },
      ]);
      expect(yield* c.connections).toEqual([
        {
          url: "https://example.com/feed",
          withCredentials: true,
          state: "closed",
          lastEventId: "1",
          reconnected: 0,
        },
      ]);
    }).pipe(Effect.provide(TestEventSource.layer())),
  );

  it.effect("carries on through a dropped connection, and fails once refused", () =>
    Effect.gen(function* () {
      const c = yield* control;
      const fiber = yield* Effect.forkChild(
        Effect.flip(Stream.runCollect(EventSource.events("/prices", Schema.Finite))),
      );
      yield* c.connected("/prices");
      yield* c.send("/prices", [{ data: "1", id: "a" }]);
      yield* c.drop("/prices");
      yield* c.connected("/prices");
      const [dropped] = yield* c.connections;
      expect([dropped?.state, dropped?.reconnected, dropped?.lastEventId]).toEqual([
        "connecting",
        1,
        "a",
      ]);
      yield* c.send("/prices", [{ data: "2" }]);
      expect((yield* c.connections)[0]?.state).toBe("open");
      yield* c.refuse("/prices");
      const error = yield* Fiber.join(fiber);
      expect([error.reason, error.url]).toEqual(["Closed", "/prices"]);
      yield* c.send("/prices", [{ data: "3" }]);
      expect((yield* c.connections)[0]?.state).toBe("closed");
    }).pipe(Effect.provide(TestEventSource.layer())),
  );

  it.effect("waits for a connection opened before or after asking", () =>
    Effect.gen(function* () {
      const c = yield* control;
      const waiting = yield* Effect.forkChild(c.connected("/late"));
      yield* Effect.forkChild(Stream.runDrain(EventSource.connect("/early")));
      yield* c.connected("/early");
      yield* Effect.forkChild(Stream.runDrain(EventSource.connect("/late")));
      yield* Fiber.join(waiting);
      expect((yield* c.connections).map((connection) => connection.url)).toEqual([
        "https://example.com/early",
        "https://example.com/late",
      ]);
    }).pipe(Effect.provide(TestEventSource.layer())),
  );

  it.effect("refuses a URL it cannot parse, and is unsupported when switched off", () =>
    Effect.gen(function* () {
      const invalid = yield* Effect.flip(
        Stream.runDrain(TestEventSource.make({ baseUrl: "not a url" }).client.connect("feed")),
      );
      expect(invalid.reason).toBe("InvalidUrl");
      const off = TestEventSource.make({ supported: false }).client;
      expect(off.supported).toBe(false);
      expect((yield* Effect.flip(Stream.runDrain(off.connect("/feed")))).reason).toBe(
        "Unsupported",
      );
    }),
  );
});
