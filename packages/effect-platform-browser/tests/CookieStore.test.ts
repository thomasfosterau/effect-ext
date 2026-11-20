import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { CookieStore } from "@thomasfosterau/effect-platform-worker-shared";
import { TestCookieStore } from "@thomasfosterau/effect-platform-browser/BrowserTesting";

const control = Effect.service(TestCookieStore.Control);
const theme = CookieStore.cookie("theme", Schema.Literals(["light", "dark"]));

describe("TestCookieStore over the Cookie Store API", () => {
  it.effect("stores what the page sets, with the API's defaults", () =>
    Effect.gen(function* () {
      const c = yield* control;
      yield* theme.set("dark", { expires: DateTime.makeUnsafe(1000), domain: "example.com" });
      yield* CookieStore.set({ name: "lang", value: "en", sameSite: "lax", path: "/app" });
      expect(yield* theme.get).toEqual(Option.some("dark"));
      expect(yield* CookieStore.getAll({ name: "lang" })).toEqual([{ name: "lang", value: "en" }]);
      expect(yield* c.jar).toEqual([
        {
          name: "theme",
          value: "dark",
          path: "/",
          domain: Option.some("example.com"),
          expires: Option.some(1000),
          sameSite: "strict",
          partitioned: false,
        },
        {
          name: "lang",
          value: "en",
          path: "/app",
          domain: Option.none(),
          expires: Option.none(),
          sameSite: "lax",
          partitioned: false,
        },
      ]);
      yield* c.advance(1000);
      expect(yield* theme.get).toEqual(Option.none());
      expect((yield* CookieStore.getAll()).length).toBe(1);
    }).pipe(Effect.provide(TestCookieStore.layer())),
  );

  it.effect("reports changes from the page, the server and the clock", () =>
    Effect.gen(function* () {
      const c = yield* control;
      const fiber = yield* Effect.forkChild(Stream.runCollect(Stream.take(CookieStore.changes, 5)));
      yield* Effect.yieldNow;
      yield* CookieStore.set({ name: "a", value: "1" });
      yield* c.fromServer({ name: "b", value: "2", expires: 500 });
      yield* CookieStore.remove("a");
      yield* CookieStore.remove("missing");
      yield* c.fromServer({ name: "c", value: "3", expires: 0 });
      yield* c.fromServer({ name: "b", value: "gone", expires: 0 });
      yield* c.advance(100);
      yield* c.fromServer({ name: "d", value: "4" });
      expect(yield* Fiber.join(fiber)).toEqual([
        { changed: [{ name: "a", value: "1" }], deleted: [] },
        { changed: [{ name: "b", value: "2" }], deleted: [] },
        { changed: [], deleted: [{ name: "a", value: "1" }] },
        { changed: [], deleted: [{ name: "b", value: "gone" }] },
        { changed: [{ name: "d", value: "4" }], deleted: [] },
      ]);
    }).pipe(Effect.provide(TestCookieStore.layer())),
  );

  it.effect("expires cookies as the clock passes them, and watches one through its schema", () =>
    Effect.gen(function* () {
      const c = yield* control;
      const fiber = yield* Effect.forkChild(Stream.runCollect(Stream.take(theme.changes, 2)));
      yield* Effect.yieldNow;
      yield* c.fromServer({ name: "theme", value: "light", expires: 200 });
      yield* c.advance(100);
      yield* c.advance(100);
      expect(yield* Fiber.join(fiber)).toEqual([Option.some("light"), Option.none()]);
    }).pipe(Effect.provide(TestCookieStore.layer({ now: 0 }))),
  );

  it.effect("rejects an invalid cookie, and fails a call as told", () =>
    Effect.gen(function* () {
      const c = yield* control;
      const reasons = yield* Effect.forEach(
        [
          { name: "", value: "1" },
          { name: "a b", value: "1" },
          { name: "a", value: "1;2" },
        ],
        (cookie) => Effect.map(Effect.flip(CookieStore.set(cookie)), (error) => error.reason),
        { concurrency: 1 },
      );
      expect(reasons).toEqual(["InvalidCookie", "InvalidCookie", "InvalidCookie"]);
      yield* c.failNext("SecurityError");
      expect((yield* Effect.flip(CookieStore.get("a"))).reason).toBe("Security");
      yield* c.failNext("UnknownError");
      expect((yield* Effect.flip(CookieStore.getAll())).reason).toBe("Failed");
      yield* c.failNext("SecurityError");
      expect((yield* Effect.flip(CookieStore.remove("a"))).reason).toBe("Security");
    }).pipe(Effect.provide(TestCookieStore.layer())),
  );
});

describe("TestCookieStore over document.cookie", () => {
  it.effect("reads and writes the jar through the header strings", () =>
    Effect.gen(function* () {
      const c = yield* control;
      expect((yield* CookieStore.CookieStore).backend).toBe("document");
      yield* CookieStore.set({ name: "note", value: "a b", expires: DateTime.makeUnsafe(5000) });
      yield* CookieStore.set({ name: "p", value: "1", partitioned: true, domain: "example.com" });
      yield* c.fromServer({ name: "server", value: "x", path: "/api" });
      yield* c.fromScript("script=y");
      yield* c.fromScript("old=z; Domain=example.com; Expires=Thu, 01 Jan 1970 00:00:00 GMT");
      expect(yield* CookieStore.get("note")).toEqual(Option.some({ name: "note", value: "a b" }));
      expect((yield* c.jar).map((cookie) => [cookie.name, cookie.value, cookie.path])).toEqual([
        ["note", "a%20b", "/"],
        ["p", "1", "/"],
        ["server", "x", "/api"],
        ["script", "y", "/"],
      ]);
      yield* CookieStore.remove("note");
      expect((yield* CookieStore.getAll()).map((cookie) => cookie.name)).toEqual([
        "p",
        "server",
        "script",
      ]);
      expect((yield* c.jar)[0]?.partitioned).toBe(true);
    }).pipe(Effect.provide(TestCookieStore.layer({ api: "document", now: 1000 }))),
  );

  it.effect("builds the unsupported service with neither API", () =>
    Effect.sync(() => {
      expect(TestCookieStore.make({ api: "none" }).cookies.backend).toBe("none");
    }),
  );
});
