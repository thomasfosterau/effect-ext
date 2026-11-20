/** With no `navigator` at all (a server render), the live layers still build, and degrade. */
import { describe, expect, it } from "@effect/vitest";
import { installGlobals } from "../../effect-platform-worker-shared/tests/globals.ts";
import * as Effect from "effect/Effect";
import {
  Browser,
  FilePicker,
  Locks,
  MediaDevices,
  Navigation,
  Navigator,
  SpeechRecognition,
  SpeechSynthesis,
  WakeLock,
} from "@thomasfosterau/effect-platform-browser";

installGlobals({ navigator: undefined });

describe("Browser.layer without a navigator", () => {
  it.effect("reports the navigator's services unsupported", () =>
    Effect.gen(function* () {
      const info = yield* Navigator.info;
      expect({
        userAgent: info.userAgent,
        languages: info.languages,
        locks: (yield* Locks.Locks).supported,
        wakeLock: (yield* WakeLock.WakeLock).supported,
        filePicker: (yield* FilePicker.FilePicker).supported,
        media: (yield* MediaDevices.MediaDevices).supported,
        history: (yield* Navigation.Navigation).supported.history,
        speech: (yield* SpeechSynthesis.SpeechSynthesis).supported,
        recognition: (yield* SpeechRecognition.SpeechRecognition).supported,
      }).toStrictEqual({
        userAgent: "",
        languages: [],
        locks: false,
        wakeLock: false,
        filePicker: false,
        media: { userMedia: false, displayMedia: false, recorder: false },
        history: false,
        speech: false,
        recognition: false,
      });
    }).pipe(Effect.provide(Browser.layer)),
  );
});
