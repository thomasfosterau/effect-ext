/** The barrel re-exports no `RerankerModel` name: consumers take it from effect-ext. */

import { describe, expect, it } from "vite-plus/test";
import * as R from "effect/Record";
import * as RerankerModelExt from "@thomasfosterau/effect-ext/RerankerModel";

describe("barrel", () => {
  it.each(R.keys(RerankerModelExt))("re-exports no RerankerModel value %s", async (name) => {
    const entry = await import("@thomasfosterau/effect-ai-cloudflare");

    expect(entry, name).not.toHaveProperty(name);
  });
});
