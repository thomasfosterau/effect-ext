/**
 * Module-load smoke test (issue #32).
 *
 * Imports the package entry, so every top-level statement in every module
 * runs against the workspace's pinned `effect`, and checks the public surface
 * is all there. `effect-ai-gateway@0.1.1` crashed at exactly this point on
 * `effect@4.0.0-rc.115` (`TypeError: Config.string is not a function`, from a
 * top-level `Config.all({ … })` in `Url.ts`) before any behavioural test got
 * to run. A renamed or removed upstream export used at module scope fails
 * here first.
 *
 * @module tests/ai/module-load
 */

import { describe, expect, it } from "vite-plus/test";
import * as R from "effect/Record";

/** This package's own abstractions — each also published as a subpath. */
const NAMESPACES = [
  "RerankerModel",
  "ClassifierModel",
  "SpeechModel",
  "TranscriptionModel",
  "ImageModel",
  "ModerationModel",
  "VoiceConversionModel",
] as const;

describe("module load", () => {
  it("imports the package entry and exposes every abstraction", async () => {
    const entry: Record<string, unknown> = await import("@thomasfosterau/effect-ext");

    expect(R.keys(entry)).toEqual(expect.arrayContaining([...NAMESPACES]));
  });

  it.each(NAMESPACES)("exposes the %s namespace from the package entry", async (name) => {
    const entry = await import("@thomasfosterau/effect-ext");

    expect(entry[name], name).toBeTypeOf("object");
  });

  it.each(NAMESPACES)("imports the ./%s subpath", async (name) => {
    const subpath: Record<string, unknown> = await import(`@thomasfosterau/effect-ext/${name}`);

    expect(R.keys(subpath).length).toBeGreaterThan(0);
  });
});
