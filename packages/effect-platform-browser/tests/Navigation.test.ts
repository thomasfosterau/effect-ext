import { describe, expect, it } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { Navigation } from "@thomasfosterau/effect-platform-browser";
import { TestNavigation, observe } from "@thomasfosterau/effect-platform-browser/BrowserTesting";

const pathOf = (url: Option.Option<URL>) =>
  Option.map(url, (value) => `${value.pathname}${value.hash}`);

const Scroll = Schema.Struct({ y: Schema.Number });

const reasonOf = <A, R>(effect: Effect.Effect<A, Navigation.NavigationError, R>) =>
  Effect.map(Effect.flip(effect), (error) => error.reason);

/** Records each destination an `intercept` handler took over. */
const recording = (seen: Ref.Ref<ReadonlyArray<string>>) => (destination: Navigation.Destination) =>
  destination.url.pathname.startsWith("/app")
    ? Option.some(
        Ref.update(seen, (paths) => [
          ...paths,
          `${destination.navigationType} ${destination.url.pathname}`,
        ]),
      )
    : Option.none();

describe("Navigation over the Navigation API", () => {
  it.effect("navigates, replaces and reads the current URL", () =>
    Effect.gen(function* () {
      const control = yield* TestNavigation.Control;
      const service = yield* Navigation.Navigation;
      expect(service.supported).toStrictEqual({ navigation: true, history: true });
      expect(pathOf(yield* Navigation.current)).toStrictEqual(Option.some("/start"));
      yield* Navigation.navigate("/a");
      yield* Navigation.navigate(new URL("https://example.com/b"));
      yield* Navigation.navigate("/c", { replace: true });
      expect(yield* control.entries).toStrictEqual([
        "https://example.com/start",
        "https://example.com/a",
        "https://example.com/c",
      ]);
      yield* Navigation.back;
      expect(pathOf(yield* Navigation.current)).toStrictEqual(Option.some("/a"));
      yield* Navigation.forward;
      expect(yield* control.index).toBe(2);
      yield* control.back;
      yield* control.forward;
      expect(yield* control.index).toBe(2);
    }).pipe(Effect.provide(TestNavigation.layer({ url: "https://example.com/start" }))),
  );

  it.effect("emits the current URL, then each change", () =>
    Effect.gen(function* () {
      const control = yield* TestNavigation.Control;
      const seen = yield* observe(Navigation.changes, 4);
      yield* Navigation.navigate("/a");
      yield* Navigation.navigate("/a#top");
      yield* control.back;
      const urls = yield* Fiber.join(seen);
      expect(Arr.map(urls, (url) => `${url.pathname}${url.hash}`)).toStrictEqual([
        "/",
        "/a",
        "/a#top",
        "/a",
      ]);
    }).pipe(Effect.provide(TestNavigation.layer())),
  );

  it.effect("keeps typed state per entry", () =>
    Effect.gen(function* () {
      expect(yield* Navigation.state(Scroll)).toStrictEqual(Option.none());
      yield* Navigation.setState(Scroll, { y: 120 });
      expect(yield* Navigation.state(Scroll)).toStrictEqual(Option.some({ y: 120 }));
      yield* Navigation.navigate("/next", { state: { y: "not a number" } });
      expect(yield* Navigation.state(Scroll)).toStrictEqual(Option.none());
      yield* Navigation.back;
      expect(yield* Navigation.state(Scroll)).toStrictEqual(Option.some({ y: 120 }));
    }).pipe(Effect.provide(TestNavigation.layer())),
  );

  it.effect("maps the platform's refusals onto reasons", () =>
    Effect.gen(function* () {
      const reasons = yield* Effect.all(
        [
          reasonOf(Navigation.back),
          reasonOf(Navigation.forward),
          reasonOf(Navigation.navigate("http://[")),
          reasonOf(Navigation.navigate("/a", { state: () => undefined })),
          reasonOf(Navigation.Navigation.use((self) => self.setState(Symbol("no")))),
          reasonOf(Navigation.setState(Schema.Int, 1.5)),
        ],
        { concurrency: 1 },
      );
      expect(reasons).toStrictEqual([
        "InvalidState",
        "InvalidState",
        "InvalidUrl",
        "NotSerializable",
        "NotSerializable",
        "NotSerializable",
      ]);
    }).pipe(Effect.provide(TestNavigation.layer())),
  );
});

describe("Navigation.intercept", () => {
  it.effect("runs the handler's effect, and navigate waits for it", () =>
    Effect.gen(function* () {
      const seen = yield* Ref.make<ReadonlyArray<string>>([]);
      yield* Navigation.intercept(recording(seen));
      yield* Navigation.navigate("/app/inbox");
      yield* Navigation.navigate("/about");
      yield* Navigation.navigate("/app/settings", { replace: true });
      yield* Navigation.back;
      expect(yield* Ref.get(seen)).toStrictEqual([
        "push /app/inbox",
        "replace /app/settings",
        "traverse /app/inbox",
      ]);
    }).pipe(Effect.scoped, Effect.provide(TestNavigation.layer())),
  );

  it.effect("leaves cross-origin and download links to the browser", () =>
    Effect.gen(function* () {
      const control = yield* TestNavigation.Control;
      const seen = yield* Ref.make<ReadonlyArray<string>>([]);
      yield* Navigation.intercept(recording(seen));
      yield* control.navigate("/app/report.pdf", { download: "report.pdf" });
      expect(yield* control.entries).toStrictEqual(["https://example.com/"]);
      yield* control.navigate("https://other.example/app");
      yield* control.navigate("/app/linked");
      yield* Effect.yieldNow;
      expect(yield* Ref.get(seen)).toStrictEqual(["push /app/linked"]);
    }).pipe(Effect.scoped, Effect.provide(TestNavigation.layer())),
  );

  it.effect("stops when its scope closes", () =>
    Effect.gen(function* () {
      const seen = yield* Ref.make<ReadonlyArray<string>>([]);
      yield* Effect.scoped(Navigation.intercept(recording(seen)));
      yield* Navigation.navigate("/app/after");
      expect(yield* Ref.get(seen)).toStrictEqual([]);
    }).pipe(Effect.provide(TestNavigation.layer())),
  );

  it.effect("fails the navigation when the handler fails", () =>
    Effect.gen(function* () {
      yield* Navigation.intercept(() => Option.some(Effect.fail("render failed")));
      const error = yield* Effect.flip(Navigation.navigate("/broken"));
      expect([error.operation, error.reason]).toStrictEqual(["navigate", "Failed"]);
    }).pipe(Effect.scoped, Effect.provide(TestNavigation.layer())),
  );

  it.effect("interrupts a handler a newer navigation supersedes", () =>
    Effect.gen(function* () {
      const interrupted = yield* Ref.make(false);
      const started = yield* Ref.make(0);
      yield* Navigation.intercept((destination) =>
        Option.some(
          destination.url.pathname === "/slow"
            ? Ref.update(started, (count) => count + 1).pipe(
                Effect.andThen(Effect.never),
                Effect.onInterrupt(() => Ref.set(interrupted, true)),
              )
            : Effect.void,
        ),
      );
      const slow = yield* Effect.forkChild(Navigation.navigate("/slow"));
      yield* Effect.repeat(Ref.get(started), { until: (count) => count > 0 });
      yield* Navigation.navigate("/fast");
      const exit = yield* Fiber.await(slow);
      expect(Exit.isFailure(exit)).toBe(true);
      expect(yield* reasonOf(Fiber.join(slow))).toBe("Aborted");
      yield* Effect.repeat(Ref.get(interrupted), { until: (done) => done });
      expect(pathOf(yield* Navigation.current)).toStrictEqual(Option.some("/fast"));
    }).pipe(Effect.scoped, Effect.provide(TestNavigation.layer())),
  );
});

describe("Navigation over history", () => {
  it.effect("pushes, replaces and follows popstate and hashchange", () =>
    Effect.gen(function* () {
      const control = yield* TestNavigation.Control;
      expect((yield* Navigation.Navigation).supported).toStrictEqual({
        navigation: false,
        history: true,
      });
      const seen = yield* observe(Navigation.changes, 5);
      const second = yield* observe(Stream.take(Navigation.changes, 2), 2);
      yield* Navigation.navigate("/a");
      expect(Arr.map(yield* Fiber.join(second), (url) => url.pathname)).toStrictEqual(["/", "/a"]);
      yield* Navigation.navigate("/a#top");
      yield* Navigation.navigate("/b", { replace: true });
      yield* control.back;
      yield* control.navigate("/a#bottom");
      const urls = yield* Fiber.join(seen);
      expect(Arr.map(urls, (url) => `${url.pathname}${url.hash}`)).toStrictEqual([
        "/",
        "/a",
        "/a#top",
        "/b",
        "/a",
      ]);
      expect(yield* control.entries).toStrictEqual([
        "https://example.com/",
        "https://example.com/a",
        "https://example.com/a#bottom",
      ]);
    }).pipe(Effect.provide(TestNavigation.layer({ api: "history" }))),
  );

  it.effect("goes back and forward, firing hashchange across a hash", () =>
    Effect.gen(function* () {
      const control = yield* TestNavigation.Control;
      yield* Navigation.navigate("/#one");
      yield* Navigation.back;
      expect(yield* control.index).toBe(0);
      yield* Navigation.forward;
      yield* Navigation.forward;
      expect(pathOf(yield* Navigation.current)).toStrictEqual(Option.some("/#one"));
      yield* control.forward;
      yield* control.navigate("/elsewhere");
      expect(yield* control.index).toBe(2);
    }).pipe(Effect.provide(TestNavigation.layer({ api: "history" }))),
  );

  it.effect("loads a cross-origin URL instead of pushing it", () =>
    Effect.gen(function* () {
      const control = yield* TestNavigation.Control;
      yield* Navigation.navigate("https://other.example/x");
      yield* Navigation.navigate("https://third.example/y", { replace: true });
      expect(yield* control.entries).toStrictEqual([
        "https://example.com/",
        "https://third.example/y",
      ]);
    }).pipe(Effect.provide(TestNavigation.layer({ api: "history" }))),
  );

  it.effect("keeps state, and refuses what the platform refuses", () =>
    Effect.gen(function* () {
      yield* Navigation.setState(Scroll, { y: 7 });
      expect(yield* Navigation.state(Scroll)).toStrictEqual(Option.some({ y: 7 }));
      const reasons = yield* Effect.all(
        [
          reasonOf(Navigation.navigate("http://[")),
          reasonOf(Navigation.navigate("/a", { state: () => undefined })),
          reasonOf(Navigation.Navigation.use((self) => self.setState(Symbol("no")))),
          reasonOf(Navigation.intercept(() => Option.none<Effect.Effect<void>>())),
        ],
        { concurrency: 1 },
      );
      expect(reasons).toStrictEqual([
        "InvalidUrl",
        "NotSerializable",
        "NotSerializable",
        "Unsupported",
      ]);
    }).pipe(Effect.scoped, Effect.provide(TestNavigation.layer({ api: "history" }))),
  );
});

describe("Navigation without history", () => {
  it.effect("is unsupported", () =>
    Effect.gen(function* () {
      const service = yield* Navigation.Navigation;
      expect(service.supported).toStrictEqual({ navigation: false, history: false });
      expect(yield* Navigation.current).toStrictEqual(Option.none());
      expect(yield* Stream.runCollect(Navigation.changes)).toStrictEqual([]);
      expect(yield* service.state).toStrictEqual(Option.none());
      const reasons = yield* Effect.all(
        [
          reasonOf(Navigation.navigate("/a")),
          reasonOf(Navigation.back),
          reasonOf(Navigation.forward),
          reasonOf(service.setState(1)),
          reasonOf(Navigation.intercept(() => Option.none<Effect.Effect<void>>())),
        ],
        { concurrency: 1 },
      );
      expect(Arr.every(reasons, (reason) => reason === "Unsupported")).toBe(true);
    }).pipe(Effect.scoped, Effect.provide(TestNavigation.layer({ api: "none" }))),
  );

  it("make({}) without a window is unsupported", () => {
    const partial = Navigation.make({
      history: { state: null, pushState() {}, replaceState() {}, back() {}, forward() {} },
    });
    expect(partial.supported).toStrictEqual({ navigation: false, history: false });
  });
});
