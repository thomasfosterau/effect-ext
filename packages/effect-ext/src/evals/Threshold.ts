/**
 * Threshold policies — the pass/fail rule applied to a {@link Score.Score}.
 * Three shapes cover the metric catalog this package is building toward:
 * `minScore` for ordinary quality metrics (higher is better), `maxScore` for
 * safety/harm metrics where lower is better, and `strict` for binary
 * pass/fail metrics that only accept a perfect score.
 *
 * @module Threshold
 *
 * @copyright Thomas Foster
 *
 * @since 0.1.0
 */

import * as Match from "effect/Match";

/**
 * Passes when the score is at least `threshold` (higher is better).
 *
 * @since 0.1.0
 */
export interface MinScore {
  readonly _tag: "MinScore";
  readonly threshold: number;
}

/**
 * Passes when the score is at most `threshold` (lower is better, e.g. safety metrics).
 *
 * @since 0.1.0
 */
export interface MaxScore {
  readonly _tag: "MaxScore";
  readonly threshold: number;
}

/**
 * Passes only on a perfect score of `1`.
 *
 * @since 0.1.0
 */
export interface Strict {
  readonly _tag: "Strict";
}

/**
 * A threshold policy: how a raw `0..1` score becomes a pass/fail verdict.
 *
 * @since 0.1.0
 */
export type Threshold = MinScore | MaxScore | Strict;

/**
 * A `minScore` policy: passes when the score is at least `threshold`.
 *
 * @since 0.1.0
 */
export const minScore = (threshold: number): MinScore => ({ _tag: "MinScore", threshold });

/**
 * A `maxScore` policy: passes when the score is at most `threshold`.
 *
 * @since 0.1.0
 */
export const maxScore = (threshold: number): MaxScore => ({ _tag: "MaxScore", threshold });

/**
 * The `strict` policy: passes only on a perfect score of `1`.
 *
 * @since 0.1.0
 */
export const strict: Strict = { _tag: "Strict" };

/**
 * Applies a threshold policy to a raw score, returning the pass/fail verdict.
 *
 * @since 0.1.0
 */
export const passes = (policy: Threshold, score: number): boolean =>
  Match.valueTags(policy, {
    MinScore: ({ threshold }) => score >= threshold,
    MaxScore: ({ threshold }) => score <= threshold,
    Strict: () => score === 1,
  });

/**
 * Renders a threshold policy as a short human-readable comparison, for reporters and failure messages.
 *
 * @since 0.1.0
 */
export const describe = (policy: Threshold): string =>
  Match.valueTags(policy, {
    MinScore: ({ threshold }) => `>= ${threshold}`,
    MaxScore: ({ threshold }) => `<= ${threshold}`,
    Strict: () => "== 1 (strict)",
  });
