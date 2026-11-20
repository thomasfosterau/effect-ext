import { describe, expect, it } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as CookieStore from "@thomasfosterau/effect-platform-worker-shared/CookieStore";

type Init = Parameters<CookieStore.CookieStoreLike["set"]>[0];
type Target = Parameters<CookieStore.CookieStoreLike["delete"]>[0];

/** A `cookieStore` stub that records each call, answering from `items`. */
const stubStore = (items: ReadonlyArray<CookieStore.CookieListItemLike> = []) => {
  const calls: Array<{ readonly method: string; readonly argument: unknown }> = [];
  const refusal = { next: Option.none<unknown>() };
  const answer = <A>(method: string, argument: unknown, value: A): Promise<A> => {
    calls.push({ method, argument });
    return Option.match(refusal.next, {
      onNone: () => Promise.resolve(value),
      onSome: (cause) => {
        refusal.next = Option.none();
        return Promise.reject(cause);
      },
    });
  };
  const target = new EventTarget();
  const store = Object.assign(target, {
    get: (name: string) =>
      answer(
        "get",
        name,
        Arr.findFirst(items, (item) => item.name === name).pipe(Option.getOrNull),
      ),
    getAll: (options?: CookieStore.GetAllOptions) => answer("getAll", options, items),
    set: (init: Init) => answer("set", init, undefined),
    delete: (options: Target) => answer("delete", options, undefined),
  });
  const fire = (
    changed: ReadonlyArray<CookieStore.CookieListItemLike>,
    deleted?: ReadonlyArray<CookieStore.CookieListItemLike>,
  ) =>
    target.dispatchEvent(
      Object.assign(
        new Event("change"),
        deleted === undefined ? { changed } : { changed, deleted },
      ),
    );
  const fireEmpty = () => target.dispatchEvent(new Event("change"));
  const like: CookieStore.CookieStoreLike = store;
  return {
    service: CookieStore.make({ cookieStore: like }),
    calls,
    refusal,
    fire,
    fireEmpty,
    target,
  };
};

/** A `document` whose `cookie` reads `header` and records each write. */
const stubDocument = (header: string) => {
  const writes: Array<string> = [];
  const document: CookieStore.DocumentCookieLike = {
    get cookie() {
      return header;
    },
    set cookie(value: string) {
      writes.push(value);
    },
  };
  return { service: CookieStore.make({ document }), writes };
};

/** Yields until `check` holds: a forked stream attaches its listener on a later tick. */
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

const listening = (target: EventTarget) => {
  const seen = { count: 0 };
  const add = target.addEventListener.bind(target);
  target.addEventListener = (...args: Parameters<EventTarget["addEventListener"]>) => {
    seen.count += 1;
    add(...args);
  };
  return seen;
};

const LATER = DateTime.makeUnsafe(86_400_000);

describe("CookieStore over cookieStore", () => {
  it.effect("reads cookies, filling in what the platform leaves out", () =>
    Effect.gen(function* () {
      const { service } = stubStore([{ name: "theme", value: "dark" }, {}]);
      expect(service.backend).toBe("cookieStore");
      expect(yield* service.get("theme")).toEqual(Option.some({ name: "theme", value: "dark" }));
      expect(yield* service.get("missing")).toEqual(Option.none());
      expect(yield* service.getAll()).toEqual([
        { name: "theme", value: "dark" },
        { name: "", value: "" },
      ]);
    }),
  );

  it.effect("writes the Cookie Store API's defaults, and the attributes given", () =>
    Effect.gen(function* () {
      const { service, calls } = stubStore();
      yield* service.set({ name: "a", value: "1" });
      yield* service.set({
        name: "b",
        value: "2",
        expires: LATER,
        domain: "example.com",
        path: "/app",
        sameSite: "lax",
        partitioned: true,
      });
      yield* service.delete("a");
      yield* service.delete("b", { domain: "example.com", path: "/app", partitioned: true });
      yield* service.getAll({ name: "a" });
      expect(Arr.map(calls, (call) => call.argument)).toEqual([
        { name: "a", value: "1", path: "/", sameSite: "strict", partitioned: false },
        {
          name: "b",
          value: "2",
          path: "/app",
          sameSite: "lax",
          partitioned: true,
          expires: 86_400_000,
          domain: "example.com",
        },
        { name: "a", path: "/", partitioned: false },
        { name: "b", path: "/app", partitioned: true, domain: "example.com" },
        { name: "a" },
      ]);
    }),
  );

  it.effect("maps rejections onto reasons by name", () =>
    Effect.gen(function* () {
      const { service, refusal } = stubStore();
      const reasons = yield* Effect.forEach(
        [new TypeError("bad name"), new DOMException("opaque", "SecurityError"), "boom"],
        (cause) =>
          Effect.suspend(() => {
            refusal.next = Option.some(cause);
            return Effect.map(Effect.flip(service.set({ name: "a", value: "1" })), (error) => [
              error.operation,
              error.reason,
            ]);
          }),
        { concurrency: 1 },
      );
      expect(reasons).toEqual([
        ["set", "InvalidCookie"],
        ["set", "Security"],
        ["set", "Failed"],
      ]);
    }),
  );

  it.effect("streams each change event", () =>
    Effect.gen(function* () {
      const { service, fire, fireEmpty, target } = stubStore();
      const seen = listening(target);
      const fiber = yield* Effect.forkChild(Stream.runCollect(Stream.take(service.changes, 3)));
      yield* eventually(() => seen.count === 1);
      fire([{ name: "a", value: "1" }]);
      fire([], [{ name: "a" }]);
      fireEmpty();
      expect(yield* Fiber.join(fiber)).toEqual([
        { changed: [{ name: "a", value: "1" }], deleted: [] },
        { changed: [], deleted: [{ name: "a", value: "" }] },
        { changed: [], deleted: [] },
      ]);
    }),
  );
});

describe("CookieStore over document.cookie", () => {
  it.effect("parses the Cookie header", () =>
    Effect.gen(function* () {
      const { service } = stubDocument("theme=dark; lang=en; theme=light; note=a%20b");
      expect(service.backend).toBe("document");
      expect(yield* service.get("note")).toEqual(Option.some({ name: "note", value: "a b" }));
      expect(yield* service.get("missing")).toEqual(Option.none());
      expect(yield* service.getAll({ name: "lang" })).toEqual([{ name: "lang", value: "en" }]);
      expect(Arr.map(yield* service.getAll(), (cookie) => cookie.name)).toEqual([
        "theme",
        "lang",
        "note",
      ]);
    }),
  );

  it.effect("serialises each write with effect/http/Cookies, and has no change stream", () =>
    Effect.gen(function* () {
      const { service, writes } = stubDocument("");
      yield* service.set({ name: "a", value: "x y" });
      yield* service.set({
        name: "b",
        value: "2",
        expires: LATER,
        domain: "example.com",
        path: "/app",
        sameSite: "none",
        partitioned: true,
      });
      yield* service.delete("a");
      yield* service.delete("b", { domain: "example.com", path: "/app", partitioned: true });
      expect(writes).toEqual([
        "a=x%20y; Path=/; SameSite=Strict",
        "b=2; Domain=example.com; Path=/app; Expires=Fri, 02 Jan 1970 00:00:00 GMT; Secure; Partitioned; SameSite=None",
        "a=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
        "b=; Domain=example.com; Path=/app; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure; Partitioned",
      ]);
      const invalid = yield* Effect.flip(service.set({ name: "bad name", value: "1" }));
      expect([invalid.reason, writes.length]).toEqual(["InvalidCookie", 4]);
      const changes = yield* Effect.flip(Stream.runDrain(service.changes));
      expect([changes.operation, changes.reason]).toEqual(["changes", "Unsupported"]);
    }),
  );
});

describe("CookieStore without either API", () => {
  it.effect("fails every call Unsupported, as the ambient default does under Node", () =>
    Effect.gen(function* () {
      expect(CookieStore.make({}).backend).toBe("none");
      const results = yield* Effect.forEach(
        [
          Effect.asVoid(CookieStore.get("a")),
          Effect.asVoid(CookieStore.getAll()),
          CookieStore.set({ name: "a", value: "1" }),
          CookieStore.remove("a"),
          Stream.runDrain(CookieStore.changes),
        ],
        (effect) => Effect.map(Effect.flip(effect), (error) => [error.operation, error.reason]),
        { concurrency: 1 },
      );
      expect(results).toEqual([
        ["get", "Unsupported"],
        ["getAll", "Unsupported"],
        ["set", "Unsupported"],
        ["delete", "Unsupported"],
        ["changes", "Unsupported"],
      ]);
    }),
  );
});

describe("CookieStore.cookie", () => {
  const visits = CookieStore.cookie("visits", Schema.FiniteFromString);

  it.effect("reads and writes through the schema", () =>
    Effect.gen(function* () {
      const { service, calls } = stubStore([
        { name: "visits", value: "3" },
        { name: "broken", value: "x" },
      ]);
      const provide = Effect.provideService(CookieStore.CookieStore, service);
      expect(yield* provide(visits.get)).toEqual(Option.some(3));
      expect(yield* provide(CookieStore.cookie("absent", Schema.FiniteFromString).get)).toEqual(
        Option.none(),
      );
      const error = yield* Effect.flip(
        provide(CookieStore.cookie("broken", Schema.FiniteFromString).get),
      );
      expect(error._tag).toBe("SchemaError");
      yield* provide(visits.set(4, { path: "/app" }));
      yield* provide(visits.remove());
      expect(Arr.map(calls.slice(-2), (call) => call.argument)).toEqual([
        { name: "visits", value: "4", path: "/app", sameSite: "strict", partitioned: false },
        { name: "visits", path: "/", partitioned: false },
      ]);
    }),
  );

  it.effect("streams the cookie's own changes, dropping a value that does not decode", () =>
    Effect.gen(function* () {
      const { service, fire, target } = stubStore();
      const seen = listening(target);
      const fiber = yield* Effect.forkChild(
        logged(
          Stream.runCollect(Stream.take(visits.changes, 3)).pipe(
            Effect.provideService(CookieStore.CookieStore, service),
          ),
        ),
      );
      yield* eventually(() => seen.count === 1);
      fire([
        { name: "other", value: "1" },
        { name: "visits", value: "1" },
      ]);
      fire([{ name: "visits", value: "many" }]);
      fire([{ name: "visits", value: "2" }], [{ name: "visits" }]);
      const { value, messages } = yield* Fiber.join(fiber);
      expect(value).toEqual([Option.some(1), Option.some(2), Option.none()]);
      expect(Arr.filter(messages, (message) => message.includes("dropped"))).toEqual([
        "cookie visits: dropped a value",
      ]);
    }),
  );
});
