import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { AudioOutput } from "@thomasfosterau/effect-platform-browser";
import { TestAudioOutput } from "@thomasfosterau/effect-platform-browser/BrowserTesting";

const control = Effect.service(TestAudioOutput.Control);
const CLIP = new Uint8Array([1, 2, 3]);

/** Yields until `check` holds: a forked fiber needs a few turns to start playing. */
const eventually = <R>(
  check: Effect.Effect<boolean, never, R>,
  tries = 100,
): Effect.Effect<void, never, R> =>
  Effect.flatMap(check, (holds) =>
    holds || tries === 0
      ? Effect.void
      : Effect.andThen(
          Effect.yieldNow,
          Effect.suspend(() => eventually(check, tries - 1)),
        ),
  );

const isPlaying = Effect.flatMap(control, (c) => c.playing);

describe("AudioOutput", () => {
  it.effect("plays a clip to the end and revokes its URL", () =>
    Effect.gen(function* () {
      yield* AudioOutput.play(CLIP, "audio/mpeg");
      const c = yield* control;
      expect({
        supported: (yield* AudioOutput.AudioOutput).supported,
        played: yield* c.played,
        open: yield* c.openUrls,
        playing: yield* c.playing,
      }).toStrictEqual({
        supported: true,
        played: [{ mediaType: "audio/mpeg", byteLength: 3 }],
        open: 0,
        playing: false,
      });
    }).pipe(Effect.provide(TestAudioOutput.layer())),
  );

  it.effect("waits for the clip to end", () =>
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(AudioOutput.play(CLIP, "audio/wav"));
      yield* eventually(isPlaying);
      const c = yield* control;
      expect(fiber.pollUnsafe()).toBeUndefined();
      yield* c.finish;
      yield* Fiber.join(fiber);
      expect(yield* c.openUrls).toBe(0);
    }).pipe(Effect.provide(TestAudioOutput.layer({ hold: true }))),
  );

  it.effect("stops playing and revokes the URL when interrupted", () =>
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(AudioOutput.play(CLIP, "audio/wav"));
      yield* eventually(isPlaying);
      yield* Fiber.interrupt(fiber);
      const c = yield* control;
      expect([yield* c.playing, yield* c.openUrls]).toStrictEqual([false, 0]);
    }).pipe(Effect.provide(TestAudioOutput.layer({ hold: true }))),
  );

  it.effect("fails when the clip cannot be decoded", () =>
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(Effect.flip(AudioOutput.play(CLIP, "audio/wav")));
      yield* eventually(isPlaying);
      yield* Effect.flatMap(control, (c) => c.failCurrent);
      expect((yield* Fiber.join(fiber)).reason).toBe("Failed");
      expect(yield* Effect.flatMap(control, (c) => c.openUrls)).toBe(0);
    }).pipe(Effect.provide(TestAudioOutput.layer({ hold: true }))),
  );

  it.effect("maps play() rejections by name", () =>
    Effect.gen(function* () {
      const c = yield* control;
      const refused = (name: string) =>
        Effect.andThen(
          c.refuseNext(name),
          Effect.map(Effect.flip(AudioOutput.play(CLIP, "audio/x-unknown")), (e) => e.reason),
        );
      expect([
        yield* refused("NotAllowedError"),
        yield* refused("NotSupportedError"),
        yield* refused("AbortError"),
      ]).toStrictEqual(["NotAllowed", "NotSupported", "Failed"]);
      expect(yield* c.openUrls).toBe(0);
      expect((yield* c.played).length).toBe(3);
    }).pipe(Effect.provide(TestAudioOutput.layer())),
  );

  it.effect("is unsupported without a platform", () =>
    Effect.gen(function* () {
      const output = yield* AudioOutput.AudioOutput;
      expect(output.supported).toBe(false);
      expect((yield* Effect.flip(output.play(CLIP, "audio/mpeg"))).reason).toBe("Unsupported");
    }).pipe(Effect.provide(TestAudioOutput.layer({ supported: false }))),
  );
});
