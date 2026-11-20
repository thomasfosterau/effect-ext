/**
 * A controllable cookie jar for tests of code that uses `CookieStore` (from
 * `@thomasfosterau/effect-platform-worker-shared`): {@link layer} provides
 * the real adapter over an in-memory `cookieStore`, or over an in-memory
 * `document.cookie` for the fallback, plus {@link Control}, which sets
 * cookies as a server's response would, moves the clock to expire them and
 * fails calls.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Cookies from "effect/http/Cookies";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as R from "effect/Record";
import {
  CookieStore,
  type CookieStoreLike,
  type CookieStoreService,
  type DocumentCookieLike,
  make as makeCookieStore,
} from "@thomasfosterau/effect-platform-worker-shared/CookieStore";

/**
 * The in-memory jar's setup: `api` (default `"cookieStore"`) is what the
 * adapter sees: the Cookie Store API, only `document.cookie`, or neither;
 * `now` (default `0`) starts the clock, in milliseconds since the epoch.
 *
 * @since 0.1.0
 * @category models
 */
export interface Options {
  readonly api?: "cookieStore" | "document" | "none";
  readonly now?: number;
}

/**
 * A cookie in the jar, with every attribute it was set with: `expires` in
 * milliseconds since the epoch, `None` for a session cookie.
 *
 * @since 0.1.0
 * @category models
 */
export interface StoredCookie {
  readonly name: string;
  readonly value: string;
  readonly path: string;
  readonly domain: Option.Option<string>;
  readonly expires: Option.Option<number>;
  readonly sameSite: "strict" | "lax" | "none";
  readonly partitioned: boolean;
}

/**
 * Drives the in-memory jar: `jar` lists the live cookies; `fromServer`
 * stores one as a response's `Set-Cookie` would, firing `change` (an
 * `expires` at or before now deletes it); `fromScript` writes a
 * `Set-Cookie` header string to `document.cookie`, as another script on the
 * page would, browser defaults and all (`Path=/`, `SameSite=Lax`);
 * `advance` moves the clock,
 * expiring cookies and firing `change` for them; `failNext` makes the next
 * `cookieStore` call reject with a `DOMException` of that name.
 *
 * @since 0.1.0
 * @category services
 */
export class Control extends Context.Service<
  Control,
  {
    readonly jar: Effect.Effect<ReadonlyArray<StoredCookie>>;
    readonly fromServer: (cookie: {
      readonly name: string;
      readonly value: string;
      readonly expires?: number;
      readonly path?: string;
    }) => Effect.Effect<void>;
    readonly fromScript: (header: string) => Effect.Effect<void>;
    readonly advance: (milliseconds: number) => Effect.Effect<void>;
    readonly failNext: (name: string) => Effect.Effect<void>;
  }
>()("@thomasfosterau/effect-platform-browser/BrowserTesting/CookieStoreControl") {}

/**
 * What {@link make} builds: the `CookieStore` service over the in-memory
 * jar, and the {@link Control} that drives it.
 *
 * @since 0.1.0
 * @category models
 */
export interface Fixture {
  readonly cookies: CookieStoreService;
  readonly control: Control["Service"];
}

type Init = Parameters<CookieStoreLike["set"]>[0];

/** The platform's rejections, built outside any `Effect.gen`. */
const rejection = (message: string, name: string): DOMException => new DOMException(message, name);

const invalidName = (name: string): boolean => name === "" || /[=;\s]/u.test(name);

/**
 * Builds an in-memory cookie jar: the `CookieStore` service over it, and its
 * {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { TestCookieStore } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const { cookies, control } = TestCookieStore.make()
 * const program = Effect.andThen(
 *   control.fromServer({ name: "session", value: "abc" }),
 *   cookies.get("session"),
 * )
 * Effect.runPromise(program).then(console.log) // Some({ name: "session", value: "abc" })
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = (options?: Options): Fixture => {
  const clock = { now: options?.now ?? 0 };
  const jar: Array<StoredCookie> = [];
  const find = (name: string) => Arr.findFirst(jar, (cookie) => cookie.name === name);
  /** Removes `name` from the jar; whether it was there. */
  const drop = (name: string): boolean =>
    Option.match(
      Arr.findFirstIndex(jar, (cookie) => cookie.name === name),
      {
        onNone: () => false,
        onSome: (index) => jar.splice(index, 1).length === 1,
      },
    );
  const failures: Array<string> = [];

  const live = (cookie: StoredCookie): boolean =>
    Option.match(cookie.expires, { onNone: () => true, onSome: (at) => at > clock.now });

  class FakeCookieStore extends EventTarget implements CookieStoreLike {
    #check(): void {
      const next = failures.shift();
      if (next !== undefined) throw rejection("refused", next);
    }
    #fire(changed: ReadonlyArray<StoredCookie>, deleted: ReadonlyArray<StoredCookie>): void {
      const item = (cookie: StoredCookie) => ({ name: cookie.name, value: cookie.value });
      this.dispatchEvent(
        Object.assign(new Event("change"), {
          changed: Arr.map(changed, item),
          deleted: Arr.map(deleted, item),
        }),
      );
    }
    store(cookie: StoredCookie): void {
      if (live(cookie)) {
        drop(cookie.name);
        jar.push(cookie);
        this.#fire([cookie], []);
      } else if (drop(cookie.name)) {
        this.#fire([], [cookie]);
      }
    }
    expire(): void {
      const expired = Arr.filter(jar, (cookie) => !live(cookie));
      Arr.forEach(expired, (cookie) => drop(cookie.name));
      if (Arr.isReadonlyArrayNonEmpty(expired)) this.#fire([], expired);
    }
    async get(name: string) {
      this.#check();
      return Option.getOrUndefined(find(name));
    }
    async getAll(filter?: { readonly name?: string }) {
      this.#check();
      return Arr.filter(jar, (cookie) => filter?.name === undefined || cookie.name === filter.name);
    }
    async set(init: Init) {
      this.#check();
      if (invalidName(init.name) || init.value.includes(";")) {
        throw new TypeError(`invalid cookie ${init.name}`);
      }
      const full = { path: "/", sameSite: "strict" as const, partitioned: false, ...init };
      this.store({
        name: full.name,
        value: full.value,
        path: full.path,
        domain: Option.fromUndefinedOr(full.domain),
        expires: Option.fromUndefinedOr(full.expires),
        sameSite: full.sameSite,
        partitioned: full.partitioned,
      });
    }
    async delete(target: { readonly name: string }) {
      this.#check();
      Option.map(find(target.name), (cookie) =>
        this.store({ ...cookie, expires: Option.some(Number.NEGATIVE_INFINITY) }),
      );
    }
  }
  const store = new FakeCookieStore();

  /** Stores each cookie of a `Set-Cookie` header, as `document.cookie` does. */
  const fromHeader = (header: string): void =>
    Arr.forEach(R.values(Cookies.fromSetCookie(header).cookies), (parsed) =>
      store.store({
        name: parsed.name,
        value: parsed.valueEncoded,
        path: parsed.options?.path ?? "/",
        domain: Option.fromUndefinedOr(parsed.options?.domain),
        expires: Option.map(Option.fromUndefinedOr(parsed.options?.expires), (at) => at.getTime()),
        sameSite: parsed.options?.sameSite ?? "lax",
        partitioned: parsed.options?.partitioned ?? false,
      }),
    );

  /** `document.cookie`: a `Cookie` header to read, a `Set-Cookie` header to write. */
  class FakeDocument implements DocumentCookieLike {
    get cookie(): string {
      return Arr.join(
        Arr.map(Arr.filter(jar, live), (it) => `${it.name}=${it.value}`),
        "; ",
      );
    }
    set cookie(header: string) {
      fromHeader(header);
    }
  }

  const api = options?.api ?? "cookieStore";
  return {
    cookies: makeCookieStore(
      api === "cookieStore"
        ? { cookieStore: store }
        : api === "document"
          ? { document: new FakeDocument() }
          : {},
    ),
    control: Control.of({
      jar: Effect.sync(() => Arr.filter(jar, live)),
      fromServer: (cookie) =>
        Effect.sync(() =>
          store.store({
            name: cookie.name,
            value: cookie.value,
            path: cookie.path ?? "/",
            domain: Option.none(),
            expires: Option.fromUndefinedOr(cookie.expires),
            sameSite: "lax",
            partitioned: false,
          }),
        ),
      fromScript: (header) => Effect.sync(() => fromHeader(header)),
      advance: (milliseconds) =>
        Effect.sync(() => {
          clock.now += milliseconds;
          store.expire();
        }),
      failNext: (name) => Effect.sync(() => failures.push(name)),
    }),
  };
};

/**
 * Provides `CookieStore` over a fresh in-memory jar, and its
 * {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { CookieStore } from "@thomasfosterau/effect-platform-worker-shared"
 * import { TestCookieStore } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.gen(function* () {
 *   const control = yield* TestCookieStore.Control
 *   yield* CookieStore.set({ name: "theme", value: "dark" })
 *   return yield* control.jar
 * })
 * Effect.runPromise(Effect.provide(program, TestCookieStore.layer())).then(console.log)
 * ```
 *
 * @since 0.1.0
 * @category layers
 */
export const layer = (options?: Options): Layer.Layer<Control> =>
  Layer.syncContext(() => {
    const { cookies, control } = make(options);
    return Context.make(CookieStore, cookies).pipe(Context.add(Control, control));
  });
