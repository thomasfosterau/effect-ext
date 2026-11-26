/**
 * The live layers over a page's ambient globals, in a file of its own: it
 * installs a fake window (navigator, `Notification`, `screen`, `matchMedia`
 * and the window's own event target) before any layer reads one.
 */
import { describe, expect, it } from "@effect/vitest";
import { installGlobals } from "../../effect-platform-worker-shared/tests/globals.ts";
import * as Arr from "effect/Array";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import {
  AudioOutput,
  Battery,
  Bluetooth,
  Browser,
  Credentials,
  DomObservers,
  FilePicker,
  Frames,
  InstalledApp,
  MediaDevices,
  MediaQuery,
  Navigation,
  Navigator,
  Notifications,
  ScreenOrientation,
  SpeechRecognition,
  SpeechSynthesis,
  WakeLock,
} from "@thomasfosterau/effect-platform-browser";
import { observe } from "@thomasfosterau/effect-platform-browser/BrowserTesting";

const windowEvents = new EventTarget();

/** The navigator's methods read `this`, as the platform's do. */
class FakeNavigator {
  readonly userAgent = "Ambient/1.0";
  readonly languages = ["en-AU"];
  onLine = true;
  readonly userActivation = { isActive: true, hasBeenActive: true };
  readonly wakeLock = { request: () => new Promise<never>(() => {}) };
  readonly credentials = {
    create: () => Promise.reject(new DOMException("cancelled", "NotAllowedError")),
    get: () => Promise.reject(new DOMException("cancelled", "NotAllowedError")),
    store: (credential: Credentials.CredentialLike) => {
      stored.push(credential);
      return Promise.resolve();
    },
  };
  readonly mediaDevices = Object.assign(new EventTarget(), {
    getUserMedia: () => Promise.reject(new DOMException("denied", "NotAllowedError")),
    enumerateDevices: () => Promise.resolve([]),
    getSupportedConstraints: () => ({ width: true }),
  });
  readonly battery = Object.assign(new EventTarget(), {
    charging: true,
    level: 0.5,
    chargingTime: 0,
    dischargingTime: Infinity,
  });
  getBattery(this: FakeNavigator) {
    return Promise.resolve(this.battery);
  }
  readonly relatedApps = [{ platform: "play", id: "com.example" }];
  getInstalledRelatedApps(this: FakeNavigator) {
    return Promise.resolve(this.relatedApps);
  }
  readonly bluetooth = Object.assign(new EventTarget(), {
    getAvailability: () => Promise.resolve(true),
    requestDevice: () => Promise.reject(new DOMException("closed", "NotFoundError")),
  });
}
const navigator = new FakeNavigator();

/** A `MediaRecorder` that stops as soon as it starts, recording its arguments. */
const recorded: Array<unknown> = [];
class FakeMediaRecorder extends EventTarget {
  static isTypeSupported(mimeType: string) {
    return mimeType === "audio/webm";
  }
  state = "inactive";
  readonly mimeType = "audio/webm";
  constructor(stream: unknown, options: unknown) {
    super();
    recorded.push(stream, options);
  }
  start() {
    this.dispatchEvent(new Event("stop"));
  }
  stop() {}
}

/** Each picker records what `this` it was called with, and is closed. */
const pickedBy: Array<unknown> = [];
function closedPicker(this: unknown) {
  pickedBy.push(this);
  return Promise.reject(new DOMException("closed", "AbortError"));
}

/** Stands in for each observer constructor: the layer only reads that it exists. */
class FakeObserver {
  observe() {}
  disconnect() {}
}

/** A synthesiser that finishes each utterance as soon as it is queued. */
const utterances: Array<string> = [];
class FakeUtterance extends EventTarget {
  readonly text: string;
  constructor(text: string) {
    super();
    this.text = text;
  }
}
const speechSynthesis = Object.assign(new EventTarget(), {
  getVoices: () => [],
  speak: (utterance: FakeUtterance) => {
    utterances.push(utterance.text);
    queueMicrotask(() => utterance.dispatchEvent(new Event("end")));
  },
  cancel: () => {},
  pause: () => {},
  resume: () => {},
});

/** An audio element that plays each clip to the end as soon as it starts. */
const playedUrls: Array<string> = [];
class FakeAudio extends EventTarget {
  src = "";
  play() {
    playedUrls.push(this.src);
    queueMicrotask(() => this.dispatchEvent(new Event("ended")));
    return Promise.resolve();
  }
  pause() {}
}

/** Chromium's prefixed recogniser, which hears nothing and ends. */
class FakeRecognition extends EventTarget {
  start() {
    queueMicrotask(() => this.dispatchEvent(new Event("end")));
  }
  stop() {}
  abort() {}
}

/** The window's frame and idle functions, recording whether each was called on the window. */
/** What the page's `navigator.credentials.store` was handed. */
const stored: Array<Credentials.CredentialLike> = [];

class FakePasswordCredential {
  readonly type = "password";
  readonly id: string;
  readonly origin: string;
  constructor(data: { readonly id: string; readonly origin: string }) {
    this.id = data.id;
    this.origin = data.origin;
  }
}

const frameCalls: Array<string> = [];
const frameTimers: Array<ReturnType<typeof setTimeout>> = [];
function requestAnimationFrame(this: unknown, callback: (time: number) => void) {
  frameCalls.push(`request frame on window: ${this === globalThis}`);
  return frameTimers.push(setTimeout(() => callback(16), 0)) - 1;
}
function cancelAnimationFrame(this: unknown, handle: number) {
  frameCalls.push(`cancel frame on window: ${this === globalThis}`);
  clearTimeout(frameTimers[handle]);
}
/** Calls back only when given a timeout, so the other request waits to be cancelled. */
function requestIdleCallback(
  this: unknown,
  callback: (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void,
  options?: { readonly timeout?: number },
) {
  frameCalls.push(`request idle on window: ${this === globalThis}, timeout ${options?.timeout}`);
  if (options !== undefined) {
    queueMicrotask(() => callback({ didTimeout: false, timeRemaining: () => 10 }));
  }
  return 2;
}
function cancelIdleCallback(this: unknown, _handle: number) {
  frameCalls.push(`cancel idle on window: ${this === globalThis}`);
}

/** A launch queue that launches the app once, at its consumer. */
const launchQueue = {
  setConsumer: (consumer: (params: { readonly targetURL: string }) => void) =>
    queueMicrotask(() => consumer({ targetURL: "https://example.com/open" })),
};

const queries: Array<{ readonly self: unknown; readonly query: string }> = [];
function matchMedia(this: unknown, query: string) {
  queries.push({ self: this, query });
  return Object.assign(new EventTarget(), { matches: true });
}

installGlobals({
  navigator,
  Notification: Object.assign(function Notification() {}, {
    permission: "granted",
    requestPermission: () => Promise.resolve("granted"),
  }),
  screen: {
    orientation: Object.assign(new EventTarget(), {
      type: "portrait-primary",
      angle: 0,
      unlock: () => {},
    }),
  },
  matchMedia,
  onbeforeinstallprompt: null,
  launchQueue,
  requestAnimationFrame,
  cancelAnimationFrame,
  requestIdleCallback,
  cancelIdleCallback,
  MediaRecorder: FakeMediaRecorder,
  PublicKeyCredential: { isConditionalMediationAvailable: () => Promise.resolve(true) },
  PasswordCredential: FakePasswordCredential,
  IdentityCredential: {},
  speechSynthesis,
  SpeechSynthesisUtterance: FakeUtterance,
  Audio: FakeAudio,
  webkitSpeechRecognition: FakeRecognition,
  showOpenFilePicker: closedPicker,
  showSaveFilePicker: closedPicker,
  showDirectoryPicker: closedPicker,
  navigation: {
    currentEntry: { url: "https://example.com/page", getState: () => undefined },
    addEventListener: () => {},
    removeEventListener: () => {},
  },
  history: { state: null },
  location: { href: "https://example.com/page", origin: "https://example.com", assign: () => {} },
  IntersectionObserver: FakeObserver,
  ResizeObserver: FakeObserver,
  MutationObserver: FakeObserver,
  addEventListener: windowEvents.addEventListener.bind(windowEvents),
  removeEventListener: windowEvents.removeEventListener.bind(windowEvents),
});

describe("Browser.layer over a page's globals", () => {
  it.effect("wires each service to its ambient object", () =>
    Effect.gen(function* () {
      const battery = yield* Battery.status;
      const dark = yield* MediaQuery.matches("(prefers-color-scheme: dark)");
      const orientation = yield* ScreenOrientation.current;
      const notifications = yield* Notifications.Notifications;
      const wakeLock = yield* WakeLock.WakeLock;
      const observers = yield* DomObservers.DomObservers;
      const navigation = yield* Navigation.Navigation;
      const filePicker = yield* FilePicker.FilePicker;
      const media = yield* MediaDevices.MediaDevices;
      const stream = { id: "s", getTracks: () => [] };
      yield* Stream.runDrain(media.record(stream, { mimeType: "audio/webm" }));
      yield* SpeechSynthesis.speak("Hello");
      yield* AudioOutput.play(new Uint8Array([1]), "audio/mpeg");
      const picked = yield* Effect.forEach(
        [
          Effect.asVoid(filePicker.open()),
          Effect.asVoid(filePicker.save()),
          Effect.asVoid(filePicker.directory()),
        ],
        (pick) => FilePicker.optional(pick),
        { concurrency: 1 },
      );
      expect({
        battery: Option.map(battery, (state) => state.level),
        dark,
        boundTo: queries.map((entry) => entry.self === globalThis),
        orientation: Option.map(orientation, (now) => now.type),
        notifications: notifications.supported,
        permission: yield* Notifications.permission,
        wakeLock: wakeLock.supported,
        observers: observers.supported,
        navigation: navigation.supported,
        url: Option.map(yield* Navigation.current, (url) => url.pathname),
        filePicker: filePicker.supported,
        picked,
        pickedBy: pickedBy.map((self) => self === globalThis),
        media: media.supported,
        constraints: yield* media.supportedConstraints,
        webm: yield* media.isTypeSupported("audio/webm"),
        recordedStream: recorded[0] === stream,
        recordedOptions: recorded[1],
        spoken: utterances,
        played: Arr.map(playedUrls, (url) => url.startsWith("blob:")),
        heard: yield* SpeechRecognition.once(),
        passkey: yield* Effect.flip(
          Credentials.register({
            rp: { name: "Example" },
            user: { id: "AA", name: "ada", displayName: "Ada" },
            challenge: "AA",
            pubKeyCredParams: [{ type: "public-key", alg: -7 }],
          }),
        ).pipe(Effect.map((error) => error.reason)),
        capabilities: yield* Credentials.capabilities,
        storedPassword: yield* Effect.map(
          Credentials.storePassword({ id: "ada", password: "pw" }),
          () => Arr.map(stored, (credential) => ({ ...credential })),
        ),
        signIns: yield* Effect.map(Credentials.Credentials, (credentials) => [
          credentials.passwordsSupported,
          credentials.identitySupported,
        ]),
        frame: yield* Frames.next,
        tick: Arr.map(yield* Stream.runCollect(Stream.take(Frames.ticks, 1)), (tick) => tick.time),
        idle: Duration.toMillis((yield* Frames.idle({ timeout: "1 second" })).timeRemaining),
        abandonedIdle: yield* Effect.flatMap(Effect.forkChild(Frames.idle()), (fiber) =>
          Effect.andThen(Effect.yieldNow, Fiber.interrupt(fiber)),
        ).pipe(Effect.as("interrupted")),
        frameCalls,
      }).toStrictEqual({
        battery: Option.some(0.5),
        dark: true,
        boundTo: [true],
        orientation: Option.some("portrait-primary"),
        notifications: true,
        permission: Option.some("granted"),
        wakeLock: true,
        observers: { intersection: true, resize: true, mutation: true },
        navigation: { navigation: true, history: true },
        url: Option.some("/page"),
        filePicker: true,
        picked: [Option.none(), Option.none(), Option.none()],
        pickedBy: [true, true, true],
        media: { userMedia: true, displayMedia: false, recorder: true },
        constraints: ["width"],
        webm: true,
        recordedStream: true,
        recordedOptions: { mimeType: "audio/webm" },
        spoken: ["Hello"],
        played: [true],
        heard: Option.none(),
        passkey: "NotAllowed",
        capabilities: { conditionalGet: true },
        storedPassword: [{ type: "password", id: "ada", origin: "https://example.com" }],
        signIns: [true, true],
        frame: 16,
        tick: [16],
        idle: 10,
        abandonedIdle: "interrupted",
        frameCalls: [
          "request frame on window: true",
          "request frame on window: true",
          "request frame on window: true",
          "cancel frame on window: true",
          "request idle on window: true, timeout 1000",
          "request idle on window: true, timeout undefined",
          "cancel idle on window: true",
        ],
      });
    }).pipe(Effect.provide(Browser.layer)),
  );

  it.effect("wires the installed app to the window, its launch queue and the navigator", () =>
    Effect.gen(function* () {
      const app = yield* InstalledApp.InstalledApp;
      const [launch] = yield* Stream.runCollect(Stream.take(InstalledApp.launches, 1));
      expect({
        supported: app.supported,
        related: Arr.map(yield* InstalledApp.relatedApps, (related) => related.id),
        launched: Option.map(launch.targetUrl, (url) => url.pathname),
        installable: yield* Stream.runCollect(Stream.take(InstalledApp.installable, 1)),
      }).toStrictEqual({
        supported: { installPrompt: true, launchQueue: true, relatedApps: true },
        related: [Option.some("com.example")],
        launched: Option.some("/open"),
        installable: [false],
      });
    }).pipe(Effect.provide(Browser.layer)),
  );

  it.effect("reaches the navigator's Bluetooth", () =>
    Effect.gen(function* () {
      const bluetooth = yield* Bluetooth.Bluetooth;
      expect({
        supported: bluetooth.supported,
        available: yield* Stream.runCollect(Stream.take(Bluetooth.availability, 1)),
        picked: (yield* Effect.flip(Bluetooth.request({ acceptAllDevices: true }))).reason,
      }).toStrictEqual({
        supported: { bluetooth: true, devices: false },
        available: [true],
        picked: "NotFound",
      });
    }).pipe(Effect.provide(Browser.layer)),
  );

  it.effect("follows connectivity through the window's own events", () =>
    Effect.gen(function* () {
      const seen = yield* observe(Navigator.onLineChanges, 2);
      navigator.onLine = false;
      windowEvents.dispatchEvent(new Event("offline"));
      expect(yield* Fiber.join(seen)).toStrictEqual([true, false]);
      expect(yield* Navigator.onLine).toBe(false);
    }).pipe(Effect.provide(Navigator.layer)),
  );
});
