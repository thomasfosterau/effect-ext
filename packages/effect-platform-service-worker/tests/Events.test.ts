import { describe, expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Logger from "effect/Logger";
import * as Schema from "effect/Schema";
import {
  periodicSyncListener,
  pushListener,
  syncListener,
} from "@thomasfosterau/effect-platform-service-worker/Events";

/** A `waitUntil` that records what it was handed, and a way to settle them all. */
const extendable = () => {
  const pending: Array<Promise<unknown>> = [];
  return {
    pending,
    waitUntil: (promise: Promise<unknown>) => {
      pending.push(promise);
    },
    settled: Effect.tryPromise({ try: () => Promise.allSettled(pending), catch: String }),
  };
};

/** Collects every message logged while `effect` runs. */
const logged = <A, E>(effect: Effect.Effect<A, E>) => {
  const messages: Array<unknown> = [];
  const logger = Logger.make(({ message }) => {
    messages.push(message);
  });
  return Effect.as(Effect.provide(effect, Logger.layer([logger])), messages);
};

/** `PushMessageData.json` on a payload that is not JSON. */
const notJson = (): never => {
  throw new SyntaxError("Unexpected token");
};

describe("pushListener", () => {
  const Payload = Schema.Struct({ from: Schema.String });

  it.effect("decodes a JSON payload, and decodes `undefined` for a push without one", () =>
    Effect.gen(function* () {
      const seen: Array<unknown> = [];
      const onPush = yield* pushListener(Schema.UndefinedOr(Payload), (payload) =>
        Effect.sync(() => seen.push(payload)),
      );
      const events = extendable();
      onPush({ data: { json: () => ({ from: "ada" }) }, waitUntil: events.waitUntil });
      onPush({ data: null, waitUntil: events.waitUntil });
      yield* events.settled;
      expect(seen).toEqual([{ from: "ada" }, undefined]);
    }),
  );

  it.effect("drops, with a warning, a payload that is not JSON or does not decode", () =>
    Effect.gen(function* () {
      const seen: Array<unknown> = [];
      const events = extendable();
      const messages = yield* logged(
        Effect.gen(function* () {
          const onPush = yield* pushListener(Payload, (payload) =>
            Effect.sync(() => seen.push(payload)),
          );
          onPush({ data: { json: notJson }, waitUntil: events.waitUntil });
          onPush({ data: { json: () => ({ from: 7 }) }, waitUntil: events.waitUntil });
          yield* events.settled;
        }),
      );
      expect(seen).toEqual([]);
      expect(messages.filter((message) => String(message).includes("push dropped"))).toHaveLength(
        2,
      );
    }),
  );
});

class Outbox extends Context.Service<Outbox, { readonly flush: Effect.Effect<void> }>()(
  "tests/Outbox",
) {}

describe("syncListener", () => {
  it.effect("runs the handler for the tag, with the services every handler needs", () =>
    Effect.gen(function* () {
      const flushed: Array<boolean> = [];
      const onSync = yield* syncListener({
        outbox: (event) => Outbox.use((outbox) => Effect.as(outbox.flush, event.lastChance)),
        other: () => Effect.void,
      }).pipe(
        Effect.provideService(Outbox, {
          flush: Effect.sync(() => flushed.push(true)),
        }),
      );
      const events = extendable();
      onSync({ tag: "outbox", lastChance: true, waitUntil: events.waitUntil });
      yield* events.settled;
      expect(flushed).toEqual([true]);
    }),
  );

  it.effect("rejects waitUntil when the handler fails, so the browser retries", () =>
    Effect.gen(function* () {
      const onSync = yield* syncListener({ outbox: () => Effect.fail("offline") });
      const events = extendable();
      onSync({ tag: "outbox", lastChance: false, waitUntil: events.waitUntil });
      const [outcome] = yield* events.settled;
      expect(outcome?.status).toBe("rejected");
    }),
  );

  it.effect("logs and settles a tag with no handler, or one only inherited", () =>
    Effect.gen(function* () {
      const events = extendable();
      const messages = yield* logged(
        Effect.gen(function* () {
          const onSync = yield* syncListener({ outbox: () => Effect.void });
          onSync({ tag: "unknown", lastChance: false, waitUntil: events.waitUntil });
          onSync({ tag: "toString", lastChance: false, waitUntil: events.waitUntil });
          yield* events.settled;
        }),
      );
      expect(events.pending).toHaveLength(2);
      expect(
        messages.filter((message) => String(message).includes("sync with no handler")),
      ).toHaveLength(2);
    }),
  );
});

describe("periodicSyncListener", () => {
  it.effect("runs the handler for the tag", () =>
    Effect.gen(function* () {
      const refreshed: Array<string> = [];
      const onPeriodicSync = yield* periodicSyncListener({
        "refresh-feed": (event) => Effect.sync(() => refreshed.push(event.tag)),
      });
      const events = extendable();
      onPeriodicSync({ tag: "refresh-feed", waitUntil: events.waitUntil });
      yield* events.settled;
      expect(refreshed).toEqual(["refresh-feed"]);
    }),
  );
});
