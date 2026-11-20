/**
 * Unit tests for `ToolCallCorrectness.toolCallCorrectness`. The option-matrix
 * suite exercises every combination of `mode` (exact/subset), `ordered`
 * (true/false), and `matchParams` (true/false) against one shared scenario
 * designed so each knob changes the outcome: `search`'s actual params differ
 * from its expected params, `lookup` appears before `search` in the actual
 * call order (defeating the expected search-then-lookup sequence when
 * `ordered` is set), and an unrelated `extra` call is always present.
 *
 * @module tests/scorers/tool-call-correctness
 */

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import { ToolCallCorrectness } from "../../../src/evals/index.ts";

const EXPECTED = [
  { name: "search", params: { query: "cats" } },
  { name: "lookup", params: { id: 1 } },
];

// `lookup` precedes `search` (reversed from EXPECTED's order), `search`'s
// params don't match, and `extra` is never expected.
const ACTUAL = [
  { name: "lookup", params: { id: 1 } },
  { name: "extra", params: {} },
  { name: "search", params: { query: "dogs" } },
];

const evaluateOptions = (options: Parameters<typeof ToolCallCorrectness.toolCallCorrectness>[0]) =>
  ToolCallCorrectness.toolCallCorrectness(options).evaluate({
    golden: { expectedTools: EXPECTED },
    toolCalls: ACTUAL,
  });

describe("ToolCallCorrectness.toolCallCorrectness — option matrix", () => {
  it.effect("subset, unordered, name-only: both expected tools found, extra ignored", () =>
    Effect.gen(function* () {
      const score = yield* evaluateOptions({ mode: "subset", ordered: false, matchParams: false });
      expect(score.score).toBe(1);
      expect(score.reason).toBe("unexpected: extra");
    }),
  );

  it.effect(
    "subset, unordered, params must match: search's params mismatch, lookup still found",
    () =>
      Effect.gen(function* () {
        const score = yield* evaluateOptions({ mode: "subset", ordered: false, matchParams: true });
        expect(score.score).toBe(0.5);
        expect(score.reason).toBe("missing: search; unexpected: extra, search");
      }),
  );

  it.effect(
    "subset, ordered, name-only: lookup appears before search in actual, so only search matches",
    () =>
      Effect.gen(function* () {
        const score = yield* evaluateOptions({ mode: "subset", ordered: true, matchParams: false });
        expect(score.score).toBe(0.5);
        expect(score.reason).toBe("missing: lookup; unexpected: lookup, extra");
      }),
  );

  it.effect(
    "subset, ordered, params must match: only lookup matches (search's params also mismatch)",
    () =>
      Effect.gen(function* () {
        const score = yield* evaluateOptions({ mode: "subset", ordered: true, matchParams: true });
        expect(score.score).toBe(0.5);
        expect(score.reason).toBe("missing: search; unexpected: extra, search");
      }),
  );

  it.effect(
    "exact, unordered, name-only: both expected tools found, but the extra call fails exact mode",
    () =>
      Effect.gen(function* () {
        const score = yield* evaluateOptions({ mode: "exact", ordered: false, matchParams: false });
        expect(score.score).toBe(0);
        expect(score.reason).toBe("unexpected: extra");
      }),
  );

  it.effect("exact, unordered, params must match: search unmatched, so exact mode fails", () =>
    Effect.gen(function* () {
      const score = yield* evaluateOptions({ mode: "exact", ordered: false, matchParams: true });
      expect(score.score).toBe(0);
      expect(score.reason).toBe("missing: search; unexpected: extra, search");
    }),
  );

  it.effect("exact, ordered, name-only: out-of-order lookup fails exact mode", () =>
    Effect.gen(function* () {
      const score = yield* evaluateOptions({ mode: "exact", ordered: true, matchParams: false });
      expect(score.score).toBe(0);
      expect(score.reason).toBe("missing: lookup; unexpected: lookup, extra");
    }),
  );

  it.effect("exact, ordered, params must match: fails on both ordering and params", () =>
    Effect.gen(function* () {
      const score = yield* evaluateOptions({ mode: "exact", ordered: true, matchParams: true });
      expect(score.score).toBe(0);
      expect(score.reason).toBe("missing: search; unexpected: extra, search");
    }),
  );
});

describe("ToolCallCorrectness.toolCallCorrectness — edge cases", () => {
  it.effect("scores a perfect match as 1 under exact mode with no leftovers", () =>
    Effect.gen(function* () {
      const score = yield* ToolCallCorrectness.toolCallCorrectness({
        mode: "exact",
        ordered: true,
      }).evaluate({
        golden: { expectedTools: [{ name: "search" }, { name: "lookup" }] },
        toolCalls: [
          { name: "search", params: { query: "cats" } },
          { name: "lookup", params: { id: 1 } },
        ],
      });
      expect(score).toEqual({ score: 1, reason: undefined });
    }),
  );

  it.effect(
    "prefers matching a params-constrained expected entry before a bare one for the same tool, unordered",
    () =>
      Effect.gen(function* () {
        // Without a specificity-aware processing order, the bare `A` entry would
        // greedily claim actual[0] (any params satisfy it), leaving the
        // params-constrained `A` entry unable to match actual[1]'s params —
        // an achievable full match would be under-scored.
        const score = yield* ToolCallCorrectness.toolCallCorrectness({
          matchParams: true,
        }).evaluate({
          golden: { expectedTools: [{ name: "A" }, { name: "A", params: { x: 1 } }] },
          toolCalls: [
            { name: "A", params: { x: 1 } },
            { name: "A", params: { x: 2 } },
          ],
        });
        expect(score).toEqual({ score: 1, reason: undefined });
      }),
  );

  it.effect("accepts plain tool-name strings, matching Golden.Golden's expectedTools shape", () =>
    Effect.gen(function* () {
      const score = yield* ToolCallCorrectness.toolCallCorrectness().evaluate({
        golden: { expectedTools: ["search", "lookup"] },
        toolCalls: [
          { name: "search", params: { query: "cats" } },
          { name: "lookup", params: { id: 1 } },
        ],
      });
      expect(score.score).toBe(1);
    }),
  );

  it.effect("treats a bare string entry as name-only even when matchParams is set", () =>
    Effect.gen(function* () {
      const score = yield* ToolCallCorrectness.toolCallCorrectness({ matchParams: true }).evaluate({
        golden: { expectedTools: ["search"] },
        toolCalls: [{ name: "search", params: { query: "anything" } }],
      });
      expect(score.score).toBe(1);
    }),
  );

  it.effect("deep-compares array-valued params, not just object-valued ones", () =>
    Effect.gen(function* () {
      const matching = yield* ToolCallCorrectness.toolCallCorrectness({
        matchParams: true,
      }).evaluate({
        golden: { expectedTools: [{ name: "search", params: ["cats", "dogs"] }] },
        toolCalls: [{ name: "search", params: ["cats", "dogs"] }],
      });
      expect(matching.score).toBe(1);

      const differentLength = yield* ToolCallCorrectness.toolCallCorrectness({
        matchParams: true,
      }).evaluate({
        golden: { expectedTools: [{ name: "search", params: ["cats", "dogs"] }] },
        toolCalls: [{ name: "search", params: ["cats"] }],
      });
      expect(differentLength.score).toBe(0);

      const arrayVsObject = yield* ToolCallCorrectness.toolCallCorrectness({
        matchParams: true,
      }).evaluate({
        golden: { expectedTools: [{ name: "search", params: ["cats"] }] },
        toolCalls: [{ name: "search", params: { 0: "cats" } }],
      });
      expect(arrayVsObject.score).toBe(0);
    }),
  );

  it.effect(
    "distinguishes different Date-valued params (Equal.equals, not a plain-object key comparison)",
    () =>
      Effect.gen(function* () {
        const same = yield* ToolCallCorrectness.toolCallCorrectness({ matchParams: true }).evaluate(
          {
            golden: {
              expectedTools: [
                {
                  name: "schedule",
                  params: { at: DateTime.toDateUtc(DateTime.makeUnsafe("2026-01-01")) },
                },
              ],
            },
            toolCalls: [
              {
                name: "schedule",
                params: { at: DateTime.toDateUtc(DateTime.makeUnsafe("2026-01-01")) },
              },
            ],
          },
        );
        expect(same.score).toBe(1);

        const different = yield* ToolCallCorrectness.toolCallCorrectness({
          matchParams: true,
        }).evaluate({
          golden: {
            expectedTools: [
              {
                name: "schedule",
                params: { at: DateTime.toDateUtc(DateTime.makeUnsafe("2026-01-01")) },
              },
            ],
          },
          toolCalls: [
            {
              name: "schedule",
              params: { at: DateTime.toDateUtc(DateTime.makeUnsafe("2026-06-01")) },
            },
          ],
        });
        expect(different.score).toBe(0);
      }),
  );

  it.effect("scores 1 (trivially) when no tools are expected", () =>
    Effect.gen(function* () {
      const score = yield* ToolCallCorrectness.toolCallCorrectness().evaluate({
        golden: {},
        toolCalls: [],
      });
      expect(score).toEqual({ score: 1, reason: undefined });
    }),
  );

  it.effect("defaults to subset, unordered, name-only when called with no options", () =>
    Effect.gen(function* () {
      const withDefaults = yield* ToolCallCorrectness.toolCallCorrectness().evaluate({
        golden: { expectedTools: EXPECTED },
        toolCalls: ACTUAL,
      });
      const explicit = yield* evaluateOptions({
        mode: "subset",
        ordered: false,
        matchParams: false,
      });
      expect(withDefaults).toEqual(explicit);
    }),
  );

  it.effect("treats a missing toolCalls array as no actual calls", () =>
    Effect.gen(function* () {
      const score = yield* ToolCallCorrectness.toolCallCorrectness().evaluate({
        golden: { expectedTools: ["search"] },
      });
      expect(score).toEqual({ score: 0, reason: "missing: search" });
    }),
  );
});
