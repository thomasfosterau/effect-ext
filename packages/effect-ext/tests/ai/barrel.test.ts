/**
 * The AI abstractions on the `@thomasfosterau/effect-ext` barrel. Each is a
 * namespace beside the standard-library modules, the same module instance as
 * its subpath, and no name collides with an upstream `effect/ai` module. The
 * barrel does not re-export `effect/ai` itself (the retired
 * `@thomasfosterau/effect-ai-ext` barrel did): upstream modules come from
 * `effect/ai`.
 *
 * @module tests/ai/barrel
 */

import { describe, expect, it } from "vite-plus/test";
import * as UpstreamAi from "effect/ai";
import * as Ext from "@thomasfosterau/effect-ext";
import * as RerankerModel from "@thomasfosterau/effect-ext/RerankerModel";

/** The extension abstractions this package adds on top of `effect/ai`. */
const EXTENSION_ONLY = [
  "RerankerModel",
  "ClassifierModel",
  "SpeechModel",
  "TranscriptionModel",
  "ImageModel",
  "ModerationModel",
  "VoiceConversionModel",
] as const;

describe("effect-ext barrel: the AI abstractions", () => {
  it.each(EXTENSION_ONLY)("re-exports the %s extension abstraction", (name) => {
    expect(Ext).toHaveProperty(name, expect.anything());
  });

  it("shares one module instance between the barrel and the subpath", () => {
    // The service tag is the identity a layer is provided against.
    expect(Ext.RerankerModel.RerankerModel).toBe(RerankerModel.RerankerModel);
  });

  it("does not re-export the upstream effect/ai modules", () => {
    expect(Ext).not.toHaveProperty("LanguageModel");
    expect(Ext).not.toHaveProperty("EmbeddingModel");
  });

  it.each(EXTENSION_ONLY)("does not collide the %s extension with an upstream name", (name) => {
    expect(UpstreamAi, `${name} must not exist upstream`).not.toHaveProperty(name);
  });
});
