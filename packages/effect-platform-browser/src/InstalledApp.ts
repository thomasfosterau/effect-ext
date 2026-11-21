/**
 * The page as an installable web app: the deferred install prompt, the
 * `appinstalled` event, the display mode it runs in, the files and URLs it
 * is launched with, and the related native apps installed beside it.
 *
 * `beforeinstallprompt` (Chromium) fires once, early in the page's life, so
 * {@link layer} listens from the moment it builds and holds the event: build
 * it at startup, with the rest of the program's layers, not on the click
 * that shows the prompt. The app badge is in `effect-platform-worker-shared`'s
 * `AppBadge`, since a service worker sets it too.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import type * as Types from "effect/Types";
import type {
  DirectoryHandleLike,
  FileHandleLike,
} from "@thomasfosterau/effect-platform-worker-shared/BrowserFileSystem";
import { reasonOf, watch } from "./internal/dom.ts";
import {
  ambientInstallEvents,
  ambientLaunchQueue,
  ambientRelatedApps,
} from "./internal/globals.ts";
import { MediaQuery } from "./MediaQuery.ts";

/**
 * What the window's `beforeinstallprompt` and `appinstalled` listeners
 * receive. A `beforeinstallprompt` event carries the rest: the `platforms`
 * it would install for, `preventDefault` (which stops the browser's own
 * install banner), `prompt` and `userChoice`.
 *
 * @since 0.1.0
 * @category models
 */
export interface InstallEventLike {
  readonly type: string;
  readonly platforms?: ReadonlyArray<string>;
  readonly userChoice?: Promise<{ readonly outcome: string }>;
  readonly preventDefault?: () => void;
  readonly prompt?: () => Promise<void>;
}

/**
 * What the browser hands a launch consumer: the URL the app was opened at
 * (`null` for a file launch in some agents), and the files or directories it
 * was opened with (file handling, or a share target), as handles
 * `BrowserFileSystem` reads.
 *
 * @since 0.1.0
 * @category models
 */
export interface LaunchParamsLike {
  readonly targetURL?: string | null;
  readonly files?: ReadonlyArray<FileHandleLike | DirectoryHandleLike>;
}

/**
 * The window's `launchQueue`. It holds the launches that came before a
 * consumer was set, and hands each one to the latest consumer.
 *
 * @since 0.1.0
 * @category models
 */
export interface LaunchQueueLike {
  setConsumer(consumer: (params: LaunchParamsLike) => void): void;
}

/**
 * A related app as `navigator.getInstalledRelatedApps()` reports it.
 *
 * @since 0.1.0
 * @category models
 */
export interface RelatedAppLike {
  readonly platform: string;
  readonly url?: string;
  readonly id?: string;
  readonly version?: string;
}

/**
 * What {@link make} builds over; each API may be missing. `window` is the
 * event target `beforeinstallprompt` and `appinstalled` fire on.
 *
 * @since 0.1.0
 * @category models
 */
export interface InstalledAppEnvironment {
  readonly window?: Stream.EventListener<InstallEventLike>;
  readonly launchQueue?: LaunchQueueLike;
  readonly getInstalledRelatedApps?: () => Promise<ReadonlyArray<RelatedAppLike>>;
}

/**
 * A deferred install prompt: the `platforms` it would install for (`"web"`
 * for the page itself).
 *
 * @since 0.1.0
 * @category models
 */
export interface InstallPrompt {
  readonly platforms: ReadonlyArray<string>;
}

/**
 * What the user answered the install prompt.
 *
 * @since 0.1.0
 * @category models
 */
export type InstallOutcome = "accepted" | "dismissed";

/**
 * One launch of the app: the URL it was opened at, and the files or
 * directories it was opened with.
 *
 * @since 0.1.0
 * @category models
 */
export interface Launch {
  readonly targetUrl: Option.Option<URL>;
  readonly files: ReadonlyArray<FileHandleLike | DirectoryHandleLike>;
}

/**
 * A native or web app, related to this one in its manifest, that the user
 * has installed.
 *
 * @since 0.1.0
 * @category models
 */
export interface RelatedApp {
  readonly platform: string;
  readonly url: Option.Option<string>;
  readonly id: Option.Option<string>;
  readonly version: Option.Option<string>;
}

/**
 * How the app is displayed, as the `display-mode` media feature reports it.
 *
 * @since 0.1.0
 * @category models
 */
export type DisplayMode =
  | "browser"
  | "minimal-ui"
  | "standalone"
  | "fullscreen"
  | "window-controls-overlay"
  | "picture-in-picture";

/**
 * Why an installed-app call failed: `Unsupported` (the agent lacks the API),
 * `NoPrompt` (no install prompt is held: the app is installed, not
 * installable, or the prompt was used), `NotAllowed` (a prompt without a
 * user gesture), `Failed` (anything else).
 *
 * @since 0.1.0
 * @category models
 */
export type InstalledAppErrorReason = "Unsupported" | "NoPrompt" | "NotAllowed" | "Failed";

/**
 * An installed-app call failed. `operation` names it.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { InstalledApp } from "@thomasfosterau/effect-platform-browser"
 *
 * const program = Effect.flatMap(InstalledApp.make(), (app) => Effect.flip(app.prompt))
 * Effect.runPromise(Effect.scoped(program)).then((error) => console.log(error.reason)) // "Unsupported"
 * ```
 *
 * @since 0.1.0
 * @category errors
 */
export class InstalledAppError extends Schema.TaggedError<InstalledAppError>()(
  "InstalledAppError",
  {
    operation: Schema.Literals(["prompt", "launches", "relatedApps"]),
    reason: Schema.Literals(["Unsupported", "NoPrompt", "NotAllowed", "Failed"]),
    message: Schema.String,
    cause: Schema.Unknown,
  },
) {}

type Operation = InstalledAppError["operation"];

const failure = (
  operation: Operation,
  reason: InstalledAppErrorReason,
  cause: unknown,
): InstalledAppError =>
  new InstalledAppError({
    operation,
    reason,
    cause,
    message: `installed app ${operation}: ${reason}`,
  });

const REJECTION_REASONS = {
  NotAllowedError: "NotAllowed",
  InvalidStateError: "NoPrompt",
} satisfies Readonly<Record<string, InstalledAppErrorReason>>;

/**
 * The installed-app service. Provide {@link layer} at startup, or
 * `TestInstalledApp.layer` from `@thomasfosterau/effect-platform-browser/BrowserTesting` in tests.
 *
 * - `supported` — which of the three APIs the agent has.
 * - `installPrompt` — the deferred install prompt, while one is held.
 * - `installable` — whether one is held, now and as it changes.
 * - `prompt` — shows it, from a user gesture, and returns the answer.
 * - `installed` — each `appinstalled` event.
 * - `launches` — each launch, from the ones queued before it ran.
 * - `relatedApps` — the related apps the user has installed.
 *
 * @since 0.1.0
 * @category services
 */
export class InstalledApp extends Context.Service<
  InstalledApp,
  {
    readonly supported: {
      readonly installPrompt: boolean;
      readonly launchQueue: boolean;
      readonly relatedApps: boolean;
    };
    readonly installPrompt: Effect.Effect<Option.Option<InstallPrompt>>;
    readonly installable: Stream.Stream<boolean>;
    readonly prompt: Effect.Effect<InstallOutcome, InstalledAppError>;
    readonly installed: Stream.Stream<void>;
    readonly launches: Stream.Stream<Launch, InstalledAppError>;
    readonly relatedApps: Effect.Effect<ReadonlyArray<RelatedApp>, InstalledAppError>;
  }
>()("@thomasfosterau/effect-platform-browser/InstalledApp") {}

interface PromptEventLike extends InstallEventLike {
  readonly userChoice: Promise<{ readonly outcome: string }>;
  readonly preventDefault: () => void;
  readonly prompt: () => Promise<void>;
}

const isPromptEvent = (event: InstallEventLike): event is PromptEventLike =>
  P.isFunction(event.prompt) && P.isFunction(event.preventDefault) && P.isPromise(event.userChoice);

const toLaunch = (params: LaunchParamsLike): Launch => ({
  targetUrl: Option.flatMap(Option.fromNullishOr(params.targetURL), (url) =>
    URL.canParse(url) ? Option.some(new URL(url)) : Option.none(),
  ),
  files: params.files ?? [],
});

const toRelatedApp = (app: RelatedAppLike): RelatedApp => ({
  platform: app.platform,
  url: Option.fromUndefinedOr(app.url),
  id: Option.fromUndefinedOr(app.id),
  version: Option.fromUndefinedOr(app.version),
});

const ignoreLaunch = (_params: LaunchParamsLike): void => undefined;

const launchesOver = (launchQueue: LaunchQueueLike): Stream.Stream<Launch> =>
  Stream.callback<Launch>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() =>
        launchQueue.setConsumer((params) => {
          Queue.offerUnsafe(queue, toLaunch(params));
        }),
      ),
      () => Effect.sync(() => launchQueue.setConsumer(ignoreLaunch)),
    ),
  );

/** Holds the latest `beforeinstallprompt` from `window`, until it is used or the app is installed. */
const holdPrompt = (window: Stream.EventListener<InstallEventLike>) =>
  Effect.gen(function* () {
    const held = { event: Option.none<PromptEventLike>() };
    const changes = new EventTarget();
    const replace = (event: Option.Option<PromptEventLike>): void => {
      held.event = event;
      changes.dispatchEvent(new Event("change"));
    };
    const onBeforeInstall = (event: InstallEventLike): void => {
      if (!isPromptEvent(event)) return;
      event.preventDefault();
      replace(Option.some(event));
    };
    const onInstalled = (): void => replace(Option.none());
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        window.addEventListener("beforeinstallprompt", onBeforeInstall);
        window.addEventListener("appinstalled", onInstalled);
      }),
      () =>
        Effect.sync(() => {
          window.removeEventListener("beforeinstallprompt", onBeforeInstall);
          window.removeEventListener("appinstalled", onInstalled);
        }),
    );
    const promptOf = (event: PromptEventLike): Effect.Effect<InstallOutcome, InstalledAppError> =>
      Effect.tryPromise({
        try: () => event.prompt(),
        catch: (cause) => failure("prompt", reasonOf(cause, REJECTION_REASONS, "Failed"), cause),
      }).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            if (Option.contains(held.event, event)) replace(Option.none());
          }),
        ),
        Effect.andThen(
          Effect.tryPromise({
            try: () => event.userChoice,
            catch: (cause) => failure("prompt", "Failed", cause),
          }),
        ),
        Effect.map(({ outcome }): InstallOutcome =>
          outcome === "accepted" ? "accepted" : "dismissed",
        ),
      );
    return {
      installPrompt: Effect.sync(() =>
        Option.map(held.event, (event): InstallPrompt => ({ platforms: event.platforms ?? [] })),
      ),
      installable: watch(changes, ["change"], () => Option.isSome(held.event)),
      prompt: Effect.suspend(() =>
        Option.match(held.event, {
          onNone: () => Effect.fail(failure("prompt", "NoPrompt", undefined)),
          onSome: promptOf,
        }),
      ),
      installed: Stream.map(
        Stream.fromEventListener<InstallEventLike>(window, "appinstalled"),
        (): void => undefined,
      ),
    };
  });

/**
 * Builds the {@link InstalledApp} service over the given APIs, listening for
 * the install prompt until the scope closes; each API missing degrades
 * (`Unsupported`, `None`, or a stream with nothing in it). {@link layer}
 * passes the window's.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { InstalledApp } from "@thomasfosterau/effect-platform-browser"
 *
 * const program = Effect.flatMap(InstalledApp.make({ window: new EventTarget() }), (app) => app.installPrompt)
 * Effect.runPromise(Effect.scoped(program)).then(console.log) // None: nothing fired yet
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = (
  environment?: InstalledAppEnvironment,
): Effect.Effect<InstalledApp["Service"], never, Scope.Scope> =>
  Effect.gen(function* () {
    const prompts = yield* Option.match(Option.fromUndefinedOr(environment?.window), {
      onNone: () =>
        Effect.succeed({
          installPrompt: Effect.succeed(Option.none<InstallPrompt>()),
          installable: Stream.make(false),
          prompt: Effect.fail(failure("prompt", "Unsupported", undefined)),
          installed: Stream.empty,
        }),
      onSome: holdPrompt,
    });
    const launchQueue = Option.fromUndefinedOr(environment?.launchQueue);
    const getRelatedApps = Option.fromUndefinedOr(environment?.getInstalledRelatedApps);
    return InstalledApp.of({
      supported: {
        installPrompt: environment?.window !== undefined,
        launchQueue: Option.isSome(launchQueue),
        relatedApps: Option.isSome(getRelatedApps),
      },
      ...prompts,
      launches: Option.match(launchQueue, {
        onNone: () => Stream.fail(failure("launches", "Unsupported", undefined)),
        onSome: launchesOver,
      }),
      relatedApps: Option.match(getRelatedApps, {
        onNone: () => Effect.fail(failure("relatedApps", "Unsupported", undefined)),
        onSome: (get) =>
          Effect.map(
            Effect.tryPromise({
              try: get,
              catch: (cause) =>
                failure("relatedApps", reasonOf(cause, REJECTION_REASONS, "Failed"), cause),
            }),
            Arr.map(toRelatedApp),
          ),
      }),
    });
  });

/**
 * The {@link InstalledApp} service over the window's events, `launchQueue`
 * and `navigator.getInstalledRelatedApps`, listening for the install prompt
 * from the moment it builds. Build it at startup: a `beforeinstallprompt`
 * that fired before it is gone.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { InstalledApp } from "@thomasfosterau/effect-platform-browser"
 *
 * const program = Effect.map(InstalledApp.InstalledApp, (app) => app.supported)
 * Effect.runPromise(Effect.provide(program, InstalledApp.layer)).then(console.log)
 * // { installPrompt: false, launchQueue: false, relatedApps: false } under Node
 * ```
 *
 * @since 0.1.0
 * @category layers
 */
export const layer: Layer.Layer<InstalledApp> = Layer.effect(
  InstalledApp,
  Effect.suspend(() => {
    const environment: Types.Mutable<InstalledAppEnvironment> = {};
    Option.map(ambientInstallEvents(), (window) => {
      environment.window = window;
    });
    Option.map(ambientLaunchQueue(), (launchQueue) => {
      environment.launchQueue = launchQueue;
    });
    Option.map(ambientRelatedApps(), (get) => {
      environment.getInstalledRelatedApps = get;
    });
    return make(environment);
  }),
);

/**
 * The deferred install prompt, while one is held: show an "Install" button
 * while this is `Some`.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { InstalledApp } from "@thomasfosterau/effect-platform-browser"
 * import { TestInstalledApp } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.gen(function* () {
 *   const control = yield* TestInstalledApp.Control
 *   yield* control.offerInstall()
 *   return yield* InstalledApp.installPrompt
 * })
 * Effect.runPromise(Effect.provide(program, TestInstalledApp.layer())).then(console.log)
 * // Some({ platforms: ["web"] })
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const installPrompt: Effect.Effect<
  Option.Option<InstallPrompt>,
  never,
  InstalledApp
> = Effect.flatMap(InstalledApp, (app) => app.installPrompt);

/**
 * Whether an install prompt is held, now and as it changes: what an
 * "Install" button's visibility follows.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import { InstalledApp } from "@thomasfosterau/effect-platform-browser"
 * import { TestInstalledApp } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Stream.runCollect(Stream.take(InstalledApp.installable, 1))
 * Effect.runPromise(Effect.provide(program, TestInstalledApp.layer())).then(console.log) // [false]
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const installable: Stream.Stream<boolean, never, InstalledApp> = Stream.unwrap(
  Effect.map(InstalledApp, (app) => app.installable),
);

/**
 * Shows the held install prompt and returns the user's answer; run it from
 * a click. The prompt can be shown once: afterwards, and once the app is
 * installed, this fails `NoPrompt`.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { InstalledApp } from "@thomasfosterau/effect-platform-browser"
 * import { TestInstalledApp } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.gen(function* () {
 *   const control = yield* TestInstalledApp.Control
 *   yield* control.offerInstall()
 *   return yield* InstalledApp.prompt
 * })
 * Effect.runPromise(Effect.provide(program, TestInstalledApp.layer())).then(console.log) // "accepted"
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const prompt: Effect.Effect<InstallOutcome, InstalledAppError, InstalledApp> =
  Effect.flatMap(InstalledApp, (app) => app.prompt);

/**
 * Each time the app is installed, from the prompt or from the browser's own
 * menu.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import { InstalledApp } from "@thomasfosterau/effect-platform-browser"
 *
 * const thank = InstalledApp.installed.pipe(Stream.runForEach(() => Effect.log("installed")))
 * Effect.runFork(Effect.provide(thank, InstalledApp.layer))
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const installed: Stream.Stream<void, never, InstalledApp> = Stream.unwrap(
  Effect.map(InstalledApp, (app) => app.installed),
);

/**
 * Each launch of the app, starting with those queued before this ran: open
 * the files of a file-handling launch (`BrowserFileSystem` reads the
 * handles), or route to its URL. The browser hands launches to one consumer,
 * the latest: run one of these streams, for the app's lifetime.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import { InstalledApp } from "@thomasfosterau/effect-platform-browser"
 *
 * const open = InstalledApp.launches.pipe(
 *   Stream.runForEach((launch) => Effect.log("opened with", launch.files.map((file) => file.name))),
 * )
 * Effect.runFork(Effect.ignore(Effect.provide(open, InstalledApp.layer)))
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const launches: Stream.Stream<Launch, InstalledAppError, InstalledApp> = Stream.unwrap(
  Effect.map(InstalledApp, (app) => app.launches),
);

/**
 * The related apps, listed in the manifest's `related_applications`, that
 * the user has installed (Chromium on Android and Windows).
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { InstalledApp } from "@thomasfosterau/effect-platform-browser"
 * import { TestInstalledApp } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = InstalledApp.relatedApps
 * Effect.runPromise(
 *   Effect.provide(program, TestInstalledApp.layer({ installedRelatedApps: [{ platform: "play", id: "com.example" }] })),
 * ).then((apps) => console.log(apps.map((app) => app.platform))) // ["play"]
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const relatedApps: Effect.Effect<
  ReadonlyArray<RelatedApp>,
  InstalledAppError,
  InstalledApp
> = Effect.flatMap(InstalledApp, (app) => app.relatedApps);

/** Most specific first: a mode that also matches a broader one wins. */
const DISPLAY_MODES: ReadonlyArray<DisplayMode> = [
  "picture-in-picture",
  "fullscreen",
  "window-controls-overlay",
  "standalone",
  "minimal-ui",
];

const firstMatching = (matches: ReadonlyArray<boolean>): DisplayMode =>
  Option.getOrElse(
    Option.flatMap(
      Arr.findFirstIndex(matches, (match) => match),
      (index) => Arr.get(DISPLAY_MODES, index),
    ),
    (): DisplayMode => "browser",
  );

const displayModeQuery = (mode: DisplayMode): string => `(display-mode: ${mode})`;

/**
 * The display mode the app runs in now, through `MediaQuery`: `"browser"` in
 * a tab, `"standalone"` (or the manifest's other modes) once installed.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { InstalledApp } from "@thomasfosterau/effect-platform-browser"
 * import { TestMediaQuery } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = InstalledApp.displayMode
 * Effect.runPromise(
 *   Effect.provide(program, TestMediaQuery.layer({ "(display-mode: standalone)": true })),
 * ).then(console.log) // "standalone"
 * ```
 *
 * @since 0.1.0
 * @category display mode
 */
export const displayMode: Effect.Effect<DisplayMode, never, MediaQuery> = Effect.flatMap(
  MediaQuery,
  (mediaQuery) =>
    Effect.map(
      Effect.forEach(DISPLAY_MODES, (mode) => mediaQuery.matches(displayModeQuery(mode)), {
        concurrency: 1,
      }),
      firstMatching,
    ),
);

/**
 * The display mode now, then each change: a page installed while open
 * moves from `"browser"` to `"standalone"`, and fullscreen passes through
 * `"fullscreen"`.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import { InstalledApp } from "@thomasfosterau/effect-platform-browser"
 * import { TestMediaQuery } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Stream.runCollect(Stream.take(InstalledApp.displayModeChanges, 1))
 * Effect.runPromise(Effect.provide(program, TestMediaQuery.layer())).then(console.log) // ["browser"]
 * ```
 *
 * @since 0.1.0
 * @category display mode
 */
export const displayModeChanges: Stream.Stream<DisplayMode, never, MediaQuery> = Stream.unwrap(
  Effect.map(MediaQuery, (mediaQuery) =>
    Stream.zipLatestAll(
      ...Arr.map(DISPLAY_MODES, (mode) => mediaQuery.changes(displayModeQuery(mode))),
    ).pipe(Stream.map(firstMatching), Stream.changes),
  ),
);
