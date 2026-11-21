import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { InstalledApp } from "@thomasfosterau/effect-platform-browser";
import {
  TestInstalledApp,
  TestMediaQuery,
  observe,
} from "@thomasfosterau/effect-platform-browser/BrowserTesting";
import type { FileHandleLike } from "@thomasfosterau/effect-platform-worker-shared/BrowserFileSystem";

/** A `beforeinstallprompt` whose `userChoice` the test settles; Chromium's early ones had no `platforms`. */
class ManualPromptEvent extends Event {
  readonly userChoice: Promise<{ readonly outcome: string }>;
  readonly shown: Promise<void>;
  readonly #settle: Array<(outcome: Option.Option<string>) => void> = [];
  constructor() {
    super("beforeinstallprompt", { cancelable: true });
    this.userChoice = new Promise((resolve, reject) => {
      this.#settle.push((outcome) =>
        Option.match(outcome, {
          onNone: () => reject(new DOMException("gone", "AbortError")),
          onSome: (value) => resolve({ outcome: value }),
        }),
      );
    });
    this.shown = Promise.resolve();
  }
  prompt(): Promise<void> {
    return this.shown;
  }
  answer(outcome: Option.Option<string>): void {
    this.#settle.forEach((settle) => settle(outcome));
  }
}

describe("InstalledApp install prompt", () => {
  it.effect("holds the prompt, shows it once and is installed when accepted", () =>
    Effect.gen(function* () {
      const control = yield* TestInstalledApp.Control;
      expect(yield* InstalledApp.installPrompt).toEqual(Option.none());
      const installable = yield* observe(InstalledApp.installable, 3);
      const installed = yield* Effect.forkChild(
        Stream.runCollect(Stream.take(InstalledApp.installed, 1)),
      );
      yield* Effect.yieldNow;

      yield* control.offerInstall(["web", "play"]);
      expect(yield* InstalledApp.installPrompt).toEqual(
        Option.some({ platforms: ["web", "play"] }),
      );
      expect(yield* InstalledApp.prompt).toBe("accepted");
      expect(yield* control.prompts).toBe(1);
      expect(yield* Fiber.join(installed)).toEqual([undefined]);
      expect(yield* Fiber.join(installable)).toEqual([false, true, false]);

      const again = yield* Effect.flip(InstalledApp.prompt);
      expect([again.operation, again.reason]).toEqual(["prompt", "NoPrompt"]);
    }).pipe(Effect.provide(TestInstalledApp.layer())),
  );

  it.effect("reports a dismissal, and needs a user gesture", () =>
    Effect.gen(function* () {
      const control = yield* TestInstalledApp.Control;
      yield* control.offerInstall();
      yield* control.setUserActivation(false);
      expect((yield* Effect.flip(InstalledApp.prompt)).reason).toBe("NotAllowed");
      expect(Option.isSome(yield* InstalledApp.installPrompt)).toBe(true);

      yield* control.setUserActivation(true);
      yield* control.answerWith("dismissed");
      expect(yield* InstalledApp.prompt).toBe("dismissed");
      expect(yield* InstalledApp.installPrompt).toEqual(Option.none());
    }).pipe(Effect.provide(TestInstalledApp.layer())),
  );

  it.effect("drops the held prompt when the app is installed from the browser's menu", () =>
    Effect.gen(function* () {
      const control = yield* TestInstalledApp.Control;
      yield* control.offerInstall();
      yield* control.install;
      expect(yield* InstalledApp.installPrompt).toEqual(Option.none());
    }).pipe(Effect.provide(TestInstalledApp.layer())),
  );

  it.effect(
    "keeps a newer prompt, ignores events that are not prompts, and fails when the answer is lost",
    () =>
      Effect.gen(function* () {
        const window = new EventTarget();
        const app = yield* InstalledApp.make({ window });
        window.dispatchEvent(new Event("beforeinstallprompt"));
        expect(yield* app.installPrompt).toEqual(Option.none());

        const first = new ManualPromptEvent();
        window.dispatchEvent(first);
        expect(first.defaultPrevented).toBe(true);
        const shown = yield* Effect.forkChild(app.prompt);
        yield* Effect.yieldNow;
        const second = new ManualPromptEvent();
        window.dispatchEvent(second);
        first.answer(Option.some("accepted"));
        expect(yield* Fiber.join(shown)).toBe("accepted");
        expect(yield* app.installPrompt).toEqual(Option.some({ platforms: [] }));

        const lost = yield* Effect.forkChild(Effect.flip(app.prompt));
        yield* Effect.yieldNow;
        second.answer(Option.none());
        expect((yield* Fiber.join(lost)).reason).toBe("Failed");
      }).pipe(Effect.scoped),
  );
});

describe("InstalledApp.launches", () => {
  it.effect("hands over the launches queued before it ran, then each new one", () =>
    Effect.gen(function* () {
      const control = yield* TestInstalledApp.Control;
      const file: FileHandleLike = {
        kind: "file",
        name: "notes.txt",
        getFile: () => Promise.resolve(new File(["hi"], "notes.txt")),
        createWritable: () => Promise.reject(new DOMException("read-only", "NotAllowedError")),
      };
      yield* control.launch({ targetURL: "https://app.example/open?file=1", files: [file] });
      const launches = yield* Effect.forkChild(
        Stream.runCollect(Stream.take(InstalledApp.launches, 3)),
      );
      yield* Effect.yieldNow;
      yield* control.launch({ targetURL: null });
      yield* control.launch({ targetURL: "not a url" });
      const [opened, bare, invalid] = yield* Fiber.join(launches);
      expect(Option.map(opened.targetUrl, (url) => url.searchParams.get("file"))).toEqual(
        Option.some("1"),
      );
      expect(opened.files.map((handle) => handle.name)).toEqual(["notes.txt"]);
      expect(bare).toEqual({ targetUrl: Option.none(), files: [] });
      expect(invalid.targetUrl).toEqual(Option.none());
    }).pipe(Effect.provide(TestInstalledApp.layer())),
  );
});

describe("InstalledApp.relatedApps", () => {
  it.effect("lists the installed related apps, with absent fields as None", () =>
    Effect.gen(function* () {
      const control = yield* TestInstalledApp.Control;
      expect(yield* InstalledApp.relatedApps).toEqual([]);
      yield* control.setRelatedApps([{ platform: "play", id: "com.example", version: "2" }]);
      expect(yield* InstalledApp.relatedApps).toEqual([
        {
          platform: "play",
          url: Option.none(),
          id: Option.some("com.example"),
          version: Option.some("2"),
        },
      ]);
    }).pipe(Effect.provide(TestInstalledApp.layer())),
  );

  it.effect("maps a rejection onto a reason", () =>
    Effect.gen(function* () {
      const app = yield* InstalledApp.make({
        getInstalledRelatedApps: () => Promise.reject(new DOMException("no", "NotAllowedError")),
      });
      const error = yield* Effect.flip(app.relatedApps);
      expect([error.operation, error.reason]).toEqual(["relatedApps", "NotAllowed"]);
    }).pipe(Effect.scoped),
  );
});

describe("InstalledApp unsupported", () => {
  it.effect("degrades each missing API", () =>
    Effect.gen(function* () {
      const app = yield* InstalledApp.InstalledApp;
      expect(app.supported).toEqual({
        installPrompt: false,
        launchQueue: false,
        relatedApps: false,
      });
      expect(yield* app.installPrompt).toEqual(Option.none());
      expect(yield* Stream.runCollect(app.installable)).toEqual([false]);
      expect(yield* Stream.runCollect(app.installed)).toEqual([]);
      expect((yield* Effect.flip(app.prompt)).reason).toBe("Unsupported");
      expect((yield* Effect.flip(Stream.runDrain(app.launches))).operation).toBe("launches");
      expect((yield* Effect.flip(app.relatedApps)).reason).toBe("Unsupported");
    }).pipe(
      Effect.provide(
        TestInstalledApp.layer({ installPrompt: false, launchQueue: false, relatedApps: false }),
      ),
    ),
  );
});

describe("InstalledApp.displayMode", () => {
  it.effect("is the most specific matching mode, and follows changes", () =>
    Effect.gen(function* () {
      const control = yield* TestMediaQuery.Control;
      expect(yield* InstalledApp.displayMode).toBe("browser");
      const modes = yield* observe(InstalledApp.displayModeChanges, 4);
      yield* control.set("(display-mode: standalone)", true);
      expect(yield* InstalledApp.displayMode).toBe("standalone");
      yield* control.set("(display-mode: fullscreen)", true);
      yield* control.set("(display-mode: fullscreen)", false);
      expect(yield* Fiber.join(modes)).toEqual([
        "browser",
        "standalone",
        "fullscreen",
        "standalone",
      ]);
    }).pipe(Effect.provide(TestMediaQuery.layer())),
  );
});
