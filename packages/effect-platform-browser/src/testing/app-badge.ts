/**
 * An in-memory app badge for tests of code that uses `AppBadge` (from
 * `@thomasfosterau/effect-platform-worker-shared`): {@link layer} provides
 * the real adapter over an in-memory `navigator`, plus {@link Control} to
 * read the badge back and make the next call reject.
 *
 * @since 0.1.0
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import {
  AppBadge,
  type AppBadgeService,
  type BadgeNavigatorLike,
  make as makeAppBadge,
} from "@thomasfosterau/effect-platform-worker-shared/AppBadge";

/**
 * The in-memory badge's setup: `supported` (default `true`) builds the
 * service without the Badging API when `false`.
 *
 * @since 0.1.0
 * @category models
 */
export interface Options {
  readonly supported?: boolean;
}

/**
 * What the icon shows: a count, or a plain dot.
 *
 * @since 0.1.0
 * @category models
 */
export type Badge = number | "dot";

/**
 * Reads and drives the in-memory badge: `badge` is what the icon shows
 * (`None` when clear); `failNext` makes the next call reject with a
 * `DOMException` of that name.
 *
 * @since 0.1.0
 * @category services
 */
export class Control extends Context.Service<
  Control,
  {
    readonly badge: Effect.Effect<Option.Option<Badge>>;
    readonly failNext: (name: string) => Effect.Effect<void>;
  }
>()("@thomasfosterau/effect-platform-browser/BrowserTesting/AppBadgeControl") {}

/**
 * What {@link make} builds: the `AppBadge` service over the in-memory
 * `navigator`, and the {@link Control} that reads it.
 *
 * @since 0.1.0
 * @category models
 */
export interface Fixture {
  readonly badge: AppBadgeService;
  readonly control: Control["Service"];
}

/**
 * Builds an in-memory badge: the `AppBadge` service over it, and its
 * {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { TestAppBadge } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const { badge, control } = TestAppBadge.make()
 * Effect.runPromise(Effect.andThen(badge.set(4), control.badge)).then(console.log) // Some(4)
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = (options?: Options): Fixture => {
  const state = { badge: Option.none<Badge>(), failure: Option.none<string>() };
  const settle = (apply: () => void): Promise<void> =>
    Option.match(state.failure, {
      onNone: () => {
        apply();
        return Promise.resolve();
      },
      onSome: (name) => {
        state.failure = Option.none();
        return Promise.reject(new DOMException(`the badge call was refused`, name));
      },
    });
  const navigator: BadgeNavigatorLike = {
    setAppBadge: (contents) =>
      settle(() => {
        state.badge =
          contents === undefined
            ? Option.some("dot")
            : contents === 0
              ? Option.none()
              : Option.some(contents);
      }),
    clearAppBadge: () =>
      settle(() => {
        state.badge = Option.none();
      }),
  };
  return {
    badge: makeAppBadge((options?.supported ?? true) ? navigator : undefined),
    control: Control.of({
      badge: Effect.sync(() => state.badge),
      failNext: (name) =>
        Effect.sync(() => {
          state.failure = Option.some(name);
        }),
    }),
  };
};

/**
 * Provides `AppBadge` over a fresh in-memory badge, and its {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { AppBadge } from "@thomasfosterau/effect-platform-worker-shared"
 * import { TestAppBadge } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.gen(function* () {
 *   yield* AppBadge.set()
 *   return yield* (yield* TestAppBadge.Control).badge
 * })
 * Effect.runPromise(Effect.provide(program, TestAppBadge.layer())).then(console.log) // Some("dot")
 * ```
 *
 * @since 0.1.0
 * @category layers
 */
export const layer = (options?: Options): Layer.Layer<Control> =>
  Layer.syncContext(() => {
    const { badge, control } = make(options);
    return Context.make(AppBadge, badge).pipe(Context.add(Control, control));
  });
