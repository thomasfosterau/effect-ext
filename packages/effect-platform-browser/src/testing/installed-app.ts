/**
 * An in-memory installable app for tests of code that uses `InstalledApp`:
 * {@link layer} provides the real adapter over an in-memory window,
 * `launchQueue` and `getInstalledRelatedApps`, plus {@link Control}, which
 * fires `beforeinstallprompt` and `appinstalled`, answers the prompt and
 * launches the app with files.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Scope from "effect/Scope";
import type * as Types from "effect/Types";
import {
  type InstallOutcome,
  InstalledApp,
  type InstalledAppEnvironment,
  type LaunchParamsLike,
  type LaunchQueueLike,
  make as makeInstalledApp,
  type RelatedAppLike,
} from "../InstalledApp.ts";
import { type PendingPromise, pendingPromise } from "../internal/dom.ts";

/**
 * The in-memory app's setup: `installPrompt`, `launchQueue` and
 * `relatedApps` (each default `true`) build the service without that API
 * when `false`; `installedRelatedApps` (default none) is what
 * `getInstalledRelatedApps` reports.
 *
 * @since 0.1.0
 * @category models
 */
export interface Options {
  readonly installPrompt?: boolean;
  readonly launchQueue?: boolean;
  readonly relatedApps?: boolean;
  readonly installedRelatedApps?: ReadonlyArray<RelatedAppLike>;
}

/**
 * Drives the in-memory app.
 *
 * - `offerInstall` fires `beforeinstallprompt` for `platforms` (default
 *   `["web"]`), as the browser does once the page meets its install
 *   criteria.
 * - `answerWith` sets what the user answers the next prompt (default
 *   `"accepted"`, which then installs the app).
 * - `setUserActivation` sets whether a prompt is shown from a user gesture
 *   (default `true`); without one, `prompt()` rejects `NotAllowedError`.
 * - `install` fires `appinstalled`, as installing from the browser's menu
 *   does.
 * - `launch` launches the app with a URL or files; it waits in the queue
 *   until a consumer is set.
 * - `setRelatedApps` replaces what `getInstalledRelatedApps` reports.
 * - `prompts` counts the prompts shown.
 *
 * @since 0.1.0
 * @category services
 */
export class Control extends Context.Service<
  Control,
  {
    readonly offerInstall: (platforms?: ReadonlyArray<string>) => Effect.Effect<void>;
    readonly answerWith: (outcome: InstallOutcome) => Effect.Effect<void>;
    readonly setUserActivation: (active: boolean) => Effect.Effect<void>;
    readonly install: Effect.Effect<void>;
    readonly launch: (params: LaunchParamsLike) => Effect.Effect<void>;
    readonly setRelatedApps: (apps: ReadonlyArray<RelatedAppLike>) => Effect.Effect<void>;
    readonly prompts: Effect.Effect<number>;
  }
>()("@thomasfosterau/effect-platform-browser/BrowserTesting/InstalledAppControl") {}

/**
 * What {@link make} builds: the `InstalledApp` service over the in-memory
 * app, and the {@link Control} that drives it.
 *
 * @since 0.1.0
 * @category models
 */
export interface Fixture {
  readonly installedApp: InstalledApp["Service"];
  readonly control: Control["Service"];
}

interface PromptState {
  outcome: InstallOutcome;
  userActivation: boolean;
  prompts: number;
}

/** A `beforeinstallprompt` event: `prompt()` shows it once, and `userChoice` settles with the answer. */
class TestInstallPromptEvent extends Event {
  readonly platforms: ReadonlyArray<string>;
  readonly userChoice: Promise<{ readonly outcome: string }>;
  readonly #state: PromptState;
  readonly #window: EventTarget;
  readonly #answered: PendingPromise;
  #outcome: InstallOutcome = "dismissed";

  constructor(platforms: ReadonlyArray<string>, state: PromptState, window: EventTarget) {
    super("beforeinstallprompt", { cancelable: true });
    this.#answered = pendingPromise();
    this.platforms = platforms;
    this.userChoice = this.#answered.promise.then(() => ({ outcome: this.#outcome }));
    this.#state = state;
    this.#window = window;
  }

  prompt(): Promise<void> {
    if (!this.#state.userActivation)
      return Promise.reject(new DOMException("prompt() needs a user gesture", "NotAllowedError"));
    this.#state.prompts += 1;
    this.#outcome = this.#state.outcome;
    queueMicrotask(() => {
      this.#answered.resolve();
      if (this.#outcome === "accepted") this.#window.dispatchEvent(new Event("appinstalled"));
    });
    return Promise.resolve();
  }
}

/** A launch queue: launches wait until a consumer is set, then each goes to the latest one. */
const launchQueue = () => {
  const queued: Array<LaunchParamsLike> = [];
  const consumer = { current: Option.none<(params: LaunchParamsLike) => void>() };
  const flush = (): void =>
    Option.match(consumer.current, {
      onNone: () => undefined,
      onSome: (consume) => Arr.forEach(queued.splice(0), consume),
    });
  const queue: LaunchQueueLike = {
    setConsumer: (consume) => {
      consumer.current = Option.some(consume);
      // The browser hands queued launches over on a task, never inside `setConsumer`.
      queueMicrotask(flush);
    },
  };
  return {
    queue,
    launch: (params: LaunchParamsLike): void => {
      queued.push(params);
      queueMicrotask(flush);
    },
  };
};

/**
 * Builds an in-memory installable app: the `InstalledApp` service over it,
 * and its {@link Control}. The service listens for the install prompt until
 * the scope closes.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { TestInstalledApp } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.gen(function* () {
 *   const { installedApp, control } = yield* TestInstalledApp.make()
 *   yield* control.answerWith("dismissed")
 *   yield* control.offerInstall()
 *   return yield* installedApp.prompt
 * })
 * Effect.runPromise(Effect.scoped(program)).then(console.log) // "dismissed"
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = (options?: Options): Effect.Effect<Fixture, never, Scope.Scope> =>
  Effect.gen(function* () {
    const settings = { installPrompt: true, launchQueue: true, relatedApps: true, ...options };
    const state: PromptState = { outcome: "accepted", userActivation: true, prompts: 0 };
    const related = { apps: options?.installedRelatedApps ?? [] };
    const window = new EventTarget();
    const launches = launchQueue();

    const environment: Types.Mutable<InstalledAppEnvironment> = {};
    if (settings.installPrompt) environment.window = window;
    if (settings.launchQueue) environment.launchQueue = launches.queue;
    if (settings.relatedApps)
      environment.getInstalledRelatedApps = () => Promise.resolve(related.apps);

    return {
      installedApp: yield* makeInstalledApp(environment),
      control: Control.of({
        offerInstall: (platforms) =>
          Effect.sync(() => {
            window.dispatchEvent(new TestInstallPromptEvent(platforms ?? ["web"], state, window));
          }),
        answerWith: (outcome) =>
          Effect.sync(() => {
            state.outcome = outcome;
          }),
        setUserActivation: (active) =>
          Effect.sync(() => {
            state.userActivation = active;
          }),
        install: Effect.sync(() => {
          window.dispatchEvent(new Event("appinstalled"));
        }),
        launch: (params) => Effect.sync(() => launches.launch(params)),
        setRelatedApps: (apps) =>
          Effect.sync(() => {
            related.apps = apps;
          }),
        prompts: Effect.sync(() => state.prompts),
      }),
    };
  });

/**
 * Provides `InstalledApp` over a fresh in-memory app (see {@link Options}),
 * and its {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { InstalledApp } from "@thomasfosterau/effect-platform-browser"
 * import { TestInstalledApp } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.gen(function* () {
 *   const control = yield* TestInstalledApp.Control
 *   yield* control.offerInstall(["web", "play"])
 *   return yield* InstalledApp.installPrompt
 * })
 * Effect.runPromise(Effect.provide(program, TestInstalledApp.layer())).then(console.log)
 * // Some({ platforms: ["web", "play"] })
 * ```
 *
 * @since 0.1.0
 * @category layers
 */
export const layer = (options?: Options): Layer.Layer<InstalledApp | Control> =>
  Layer.effectContext(
    Effect.map(make(options), ({ installedApp, control }) =>
      Context.make(InstalledApp, installedApp).pipe(Context.add(Control, control)),
    ),
  );
