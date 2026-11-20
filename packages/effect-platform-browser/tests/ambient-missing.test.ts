/** Without `navigator.serviceWorker` (Node's `navigator` has none), the default is `none`. */
import { describe, expect, it } from "@effect/vitest";
import { installGlobals } from "../../effect-platform-worker-shared/tests/globals.ts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { ServiceWorkerContainer as SWC } from "@thomasfosterau/effect-platform-browser";

installGlobals({ navigator: { serviceWorker: { register: "not a function" } } });

describe("ServiceWorkerContainer.Container", () => {
  it.effect("is none when navigator.serviceWorker is not a container", () =>
    Effect.map(SWC.Container, (found) => {
      expect(found).toEqual(Option.none());
    }),
  );
});
