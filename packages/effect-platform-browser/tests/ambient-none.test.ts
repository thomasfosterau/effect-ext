/** With no `navigator` at all (a server render), the live layers still build, and degrade. */
import { describe, expect, it } from "@effect/vitest";
import { installGlobals } from "../../effect-platform-worker-shared/tests/globals.ts";
import * as Effect from "effect/Effect";
import {
  Browser,
  Locks,
  Navigation,
  Navigator,
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
        history: (yield* Navigation.Navigation).supported.history,
      }).toStrictEqual({
        userAgent: "",
        languages: [],
        locks: false,
        wakeLock: false,
        history: false,
      });
    }).pipe(Effect.provide(Browser.layer)),
  );
});
