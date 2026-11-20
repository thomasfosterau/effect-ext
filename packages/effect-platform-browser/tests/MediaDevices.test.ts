import { describe, expect, it } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { MediaDevices } from "@thomasfosterau/effect-platform-browser";
import { observe, TestMediaDevices } from "@thomasfosterau/effect-platform-browser/BrowserTesting";

const control = Effect.service(TestMediaDevices.Control);
const media = Effect.service(MediaDevices.MediaDevices);

const kinds = (stream: MediaDevices.MediaStreamLike) =>
  stream.getTracks().map((track) => track.kind);

/** A recorder that fires the events `script` dispatches as soon as it starts. */
const scriptedRecorder = (
  script: (recorder: EventTarget) => void,
): MediaDevices.MediaRecorderFactoryLike => ({
  make: () =>
    Object.assign(new EventTarget(), {
      state: "inactive" as const,
      mimeType: "audio/webm",
      start(this: EventTarget) {
        script(this);
      },
      stop: () => {},
    }),
  isTypeSupported: () => true,
});

/** What `attach` writes to: a `<video>` or `<audio>` element's slice. */
interface MediaElement {
  srcObject: unknown;
}

const stream: MediaDevices.MediaStreamLike = { id: "s", getTracks: () => [] };

describe("MediaDevices.make", () => {
  it.effect("fails every call Unsupported without the API", () =>
    Effect.gen(function* () {
      const unsupported = MediaDevices.make();
      expect(unsupported.supported).toEqual({
        userMedia: false,
        displayMedia: false,
        recorder: false,
      });
      const reasons = yield* Effect.forEach(
        [
          Effect.asVoid(Effect.scoped(unsupported.userMedia({ audio: true }))),
          Effect.asVoid(Effect.scoped(unsupported.displayMedia())),
          Effect.asVoid(unsupported.devices),
          Stream.runDrain(unsupported.deviceChanges),
        ],
        (effect) => Effect.map(Effect.flip(effect), (error) => error.reason),
        { concurrency: 1 },
      );
      expect(reasons).toEqual(["Unsupported", "Unsupported", "Unsupported", "Unsupported"]);
      expect(yield* unsupported.supportedConstraints).toEqual([]);
      expect(yield* unsupported.isTypeSupported("audio/webm")).toBe(false);
      const recording = yield* Effect.flip(Stream.runDrain(unsupported.record(stream)));
      expect(recording.reason).toBe("Unsupported");
    }),
  );

  it.effect("records without capture where only the recorder exists", () =>
    Effect.gen(function* () {
      const recorderOnly = MediaDevices.make(
        undefined,
        scriptedRecorder((recorder) => recorder.dispatchEvent(new Event("stop"))),
      );
      expect(recorderOnly.supported.recorder).toBe(true);
      expect(yield* Stream.runCollect(recorderOnly.record(stream))).toEqual([]);
    }),
  );

  it.effect("ignores a dataavailable without a Blob, and keeps an error event's cause", () =>
    Effect.gen(function* () {
      const errorEvent = new Event("error");
      const recorder = MediaDevices.make(
        undefined,
        scriptedRecorder((target) => {
          target.dispatchEvent(Object.assign(new Event("dataavailable"), { data: "not a blob" }));
          target.dispatchEvent(new Event("dataavailable"));
          target.dispatchEvent(errorEvent);
        }),
      );
      const error = yield* Effect.flip(Stream.runCollect(recorder.record(stream)));
      expect(error.reason).toBe("Failed");
      expect(error.cause).toBe(errorEvent);
    }),
  );
});

describe("capture", () => {
  it.effect("captures the kinds asked for and stops them when the scope closes", () =>
    Effect.gen(function* () {
      const drive = yield* control;
      const captured = yield* Effect.scoped(
        Effect.gen(function* () {
          const camera = yield* MediaDevices.userMedia({ audio: true, video: true });
          expect(yield* drive.live).toBe(2);
          return kinds(camera);
        }),
      );
      expect(captured).toEqual(["audio", "video"]);
      expect(yield* drive.live).toBe(0);
      expect(yield* drive.requests).toEqual([
        { method: "getUserMedia", constraints: Option.some({ audio: true, video: true }) },
      ]);
    }).pipe(Effect.provide(TestMediaDevices.layer())),
  );

  it.effect("captures the screen, with its audio when asked", () =>
    Effect.gen(function* () {
      const screen = yield* Effect.scoped(Effect.map(MediaDevices.displayMedia(), kinds));
      const withAudio = yield* Effect.scoped(
        Effect.map(MediaDevices.displayMedia({ video: true, audio: true }), kinds),
      );
      expect([screen, withAudio]).toEqual([["video"], ["video", "audio"]]);
      expect((yield* media).supported.displayMedia).toBe(true);
    }).pipe(Effect.provide(TestMediaDevices.layer())),
  );

  it.effect("reports a missing getDisplayMedia unsupported", () =>
    Effect.gen(function* () {
      expect((yield* media).supported.displayMedia).toBe(false);
      const error = yield* Effect.flip(Effect.scoped(MediaDevices.displayMedia()));
      expect(error.reason).toBe("Unsupported");
    }).pipe(Effect.provide(TestMediaDevices.layer({ displayMedia: false }))),
  );

  it.effect("fails NotFound without a device of the kind", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(Effect.scoped(MediaDevices.userMedia({ video: true })));
      expect(error.reason).toBe("NotFound");
    }).pipe(Effect.provide(TestMediaDevices.layer({ devices: [] }))),
  );

  it.effect("maps rejections onto reasons, keeping an overconstrained constraint", () =>
    Effect.gen(function* () {
      const drive = yield* control;
      const failures = [
        ["NotAllowedError", undefined],
        ["SecurityError", undefined],
        ["NotReadableError", undefined],
        ["OverconstrainedError", "width"],
        ["OverconstrainedError", undefined],
        ["AbortError", undefined],
        ["UnknownError", undefined],
      ] as const;
      const errors = yield* Effect.forEach(
        failures,
        ([name, constraint]) =>
          Effect.andThen(
            drive.failNext(name, constraint),
            Effect.flip(Effect.scoped(MediaDevices.userMedia({ audio: true }))),
          ),
        { concurrency: 1 },
      );
      expect(errors.map((error) => [error.reason, error.constraint])).toEqual([
        ["NotAllowed", Option.none()],
        ["NotAllowed", Option.none()],
        ["NotReadable", Option.none()],
        ["Overconstrained", Option.some("width")],
        ["Overconstrained", Option.none()],
        ["Aborted", Option.none()],
        ["Failed", Option.none()],
      ]);
    }).pipe(Effect.provide(TestMediaDevices.layer())),
  );
});

describe("devices", () => {
  it.effect("lists the devices, then each change, deduplicated", () =>
    Effect.gen(function* () {
      const drive = yield* control;
      expect((yield* MediaDevices.devices).map((device) => device.deviceId)).toEqual([
        "microphone",
        "camera",
        "speaker",
      ]);
      const seen = yield* observe(MediaDevices.deviceChanges, 2);
      const headset = {
        deviceId: "headset",
        groupId: "usb",
        kind: "audioinput",
        label: "Headset",
      } as const;
      yield* drive.setDevices([headset]);
      yield* drive.setDevices([headset]);
      expect(yield* Fiber.join(seen)).toEqual([
        [
          { deviceId: "microphone", groupId: "built-in", kind: "audioinput", label: "Microphone" },
          { deviceId: "camera", groupId: "built-in", kind: "videoinput", label: "Camera" },
          { deviceId: "speaker", groupId: "built-in", kind: "audiooutput", label: "Speaker" },
        ],
        [headset],
      ]);
    }).pipe(Effect.provide(TestMediaDevices.layer())),
  );

  it.effect("reports the constraints and MIME types the agent supports", () =>
    Effect.gen(function* () {
      const service = yield* media;
      expect(yield* service.supportedConstraints).toEqual([
        "deviceId",
        "echoCancellation",
        "facingMode",
        "height",
        "width",
      ]);
      expect(yield* service.isTypeSupported("audio/webm")).toBe(true);
      expect(yield* service.isTypeSupported("audio/x-wav")).toBe(false);
    }).pipe(Effect.provide(TestMediaDevices.layer())),
  );
});

describe("record", () => {
  it.effect("delivers a chunk per timeslice, ending when the tracks end", () =>
    Effect.gen(function* () {
      const drive = yield* control;
      const chunks = yield* Effect.scoped(
        Effect.gen(function* () {
          const microphone = yield* MediaDevices.userMedia({ audio: true });
          const recording = yield* Effect.forkChild(
            Stream.runCollect(
              MediaDevices.record(microphone, { mimeType: "audio/webm", timeslice: "1 second" }),
            ),
          );
          yield* Effect.yieldNow;
          yield* drive.deliver("one");
          yield* drive.deliver(new TextEncoder().encode("three"));
          yield* drive.endTracks("audio");
          return yield* Fiber.join(recording);
        }),
      );
      expect(chunks.map((chunk) => chunk.size)).toEqual([3, 5]);
      expect(chunks.every((chunk) => chunk.type === "audio/webm")).toBe(true);
    }).pipe(Effect.provide(TestMediaDevices.layer())),
  );

  it.effect("keeps recording until every track of the stream has ended", () =>
    Effect.gen(function* () {
      const drive = yield* control;
      yield* Effect.scoped(
        Effect.gen(function* () {
          const both = yield* MediaDevices.userMedia({ audio: true, video: true });
          const recording = yield* Effect.forkChild(
            Stream.runDrain(MediaDevices.record(both, { timeslice: 10 })),
          );
          yield* Effect.yieldNow;
          yield* drive.endTracks("video");
          expect(yield* drive.recording).toBe(1);
          yield* drive.endTracks("audio");
          yield* Fiber.join(recording);
          expect(yield* drive.recording).toBe(0);
        }),
      );
    }).pipe(Effect.provide(TestMediaDevices.layer())),
  );

  it.effect("stops gracefully when until completes, keeping the last chunk", () =>
    Effect.gen(function* () {
      const drive = yield* control;
      const chunks = yield* Effect.scoped(
        Effect.gen(function* () {
          const camera = yield* MediaDevices.userMedia({ video: true });
          return yield* Stream.runCollect(
            MediaDevices.record(camera, { until: drive.deliver("frames") }),
          );
        }),
      );
      expect(chunks.map((chunk) => [chunk.type, chunk.size])).toEqual([["video/webm", 6]]);
      expect(yield* drive.recording).toBe(0);
    }).pipe(Effect.provide(TestMediaDevices.layer())),
  );

  it.effect("stops the recorder when the stream is abandoned", () =>
    Effect.gen(function* () {
      const drive = yield* control;
      yield* Effect.scoped(
        Effect.gen(function* () {
          const microphone = yield* MediaDevices.userMedia({ audio: true });
          const first = yield* Effect.forkChild(
            Stream.runCollect(
              Stream.take(
                MediaDevices.record(microphone, { timeslice: 10, mimeType: "audio/webm" }),
                1,
              ),
            ),
          );
          yield* Effect.yieldNow;
          expect(yield* drive.recording).toBe(1);
          yield* drive.deliver("a");
          yield* Fiber.join(first);
        }),
      );
      expect(yield* drive.recording).toBe(0);
    }).pipe(Effect.provide(TestMediaDevices.layer())),
  );

  it.effect("fails NotSupported for a MIME type or an ended stream, Failed on error", () =>
    Effect.gen(function* () {
      const drive = yield* control;
      yield* Effect.scoped(
        Effect.gen(function* () {
          const microphone = yield* MediaDevices.userMedia({ audio: true });
          const mime = yield* Effect.flip(
            Stream.runDrain(MediaDevices.record(microphone, { mimeType: "audio/x-wav" })),
          );
          expect(mime.reason).toBe("NotSupported");
          const failing = yield* Effect.forkChild(
            Effect.flip(Stream.runDrain(MediaDevices.record(microphone, { timeslice: 10 }))),
          );
          yield* Effect.yieldNow;
          yield* drive.failRecording;
          expect((yield* Fiber.join(failing)).reason).toBe("Failed");
          yield* drive.endTracks();
          const ended = yield* Effect.flip(Stream.runDrain(MediaDevices.record(microphone)));
          expect(ended.reason).toBe("NotSupported");
          const foreign = yield* Effect.flip(Stream.runDrain(MediaDevices.record(stream)));
          expect(foreign.reason).toBe("NotSupported");
        }),
      );
    }).pipe(Effect.provide(TestMediaDevices.layer())),
  );

  it.effect("reports a missing recorder unsupported", () =>
    Effect.map(media, (service) => {
      expect(service.supported).toEqual({ userMedia: true, displayMedia: true, recorder: false });
    }).pipe(Effect.provide(TestMediaDevices.layer({ recorder: false }))),
  );

  it.effect("reports missing media devices unsupported", () =>
    Effect.map(media, (service) => {
      expect(service.supported.userMedia).toBe(false);
    }).pipe(Effect.provide(TestMediaDevices.layer({ mediaDevices: false }))),
  );
});

describe("trackEnded and attach", () => {
  it.effect("waits for the platform to end a track, or returns at once if it has", () =>
    Effect.gen(function* () {
      const drive = yield* control;
      yield* Effect.scoped(
        Effect.gen(function* () {
          const screen = yield* MediaDevices.displayMedia();
          const track = yield* Effect.fromOption(Arr.head(screen.getTracks()));
          const abandoned = yield* Effect.forkChild(MediaDevices.trackEnded(track));
          const ended = yield* Effect.forkChild(MediaDevices.trackEnded(track));
          yield* Effect.yieldNow;
          yield* Fiber.interrupt(abandoned);
          yield* drive.endTracks("video");
          yield* drive.endTracks("video");
          yield* Fiber.join(ended);
          yield* MediaDevices.trackEnded(track);
          expect(track.readyState).toBe("ended");
        }),
      );
    }).pipe(Effect.provide(TestMediaDevices.layer())),
  );

  it.effect("shows a stream in an element for the scope, clearing only its own", () =>
    Effect.gen(function* () {
      const video: MediaElement = { srcObject: null };
      const other: MediaElement = { srcObject: null };
      yield* Effect.scoped(
        Effect.gen(function* () {
          const camera = yield* MediaDevices.userMedia({ video: true });
          yield* MediaDevices.attach(video, camera);
          yield* MediaDevices.attach(other, camera);
          expect(video.srcObject).toBe(camera);
          other.srcObject = "replaced";
        }),
      );
      expect(video.srcObject).toBeNull();
      expect(other.srcObject).toBe("replaced");
    }).pipe(Effect.provide(TestMediaDevices.layer())),
  );
});
