/**
 * The case shape shared by every scorer that compares a string `output`
 * against an optional string `golden.expected`: {@link ExactMatch.exactMatch}
 * / {@link ExactMatch.normalizedMatch}, {@link Levenshtein.levenshtein}, and
 * {@link EmbeddingSimilarity.embeddingSimilarity}.
 *
 * @module scorers/StringCase
 *
 * @copyright Thomas Foster
 *
 * @since 0.1.0
 */

/**
 * The shape a string-comparison scorer needs from a case: a string `output` compared against an optional string `golden.expected`.
 *
 * @since 0.1.0
 */
export interface StringCase {
  readonly golden: { readonly expected?: string };
  readonly output: string;
}
