/**
 * Unit tests for the `Dataset` seam: inline goldens, and goldens produced by
 * an arbitrary effect.
 *
 * @module tests/dataset
 */

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { Dataset } from "../../src/evals/index.ts";

describe("Dataset.fromArray", () => {
  it.effect("wraps an inline array of goldens as an effect", () =>
    Effect.gen(function* () {
      const dataset = Dataset.fromArray("greetings", ["Bonjour", "Ciao"]);

      expect(dataset.name).toBe("greetings");
      const goldens = yield* dataset.goldens;
      expect(goldens).toEqual(["Bonjour", "Ciao"]);
    }),
  );
});
