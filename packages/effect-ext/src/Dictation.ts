/**
 * Defines the provider-neutral service for live speech to text.
 *
 * `Dictation` listens to the user as they speak and streams what it hears,
 * where `TranscriptionModel` transcribes audio the caller already has. A
 * browser's own recogniser implements it. Failures are `AiError` values.
 *
 * @since 0.5.0
 */

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { AiError } from "effect/ai";

/**
 * One reading of a phrase. A phrase is read again (`isFinal: false`) until a
 * final reading settles it; `index` numbers the phrase within the session,
 * so a later reading with the same `index` replaces an earlier one.
 *
 * @example
 * ```ts
 * import { Dictation } from "@thomasfosterau/effect-ext"
 *
 * const reading = new Dictation.Transcript({ index: 0, text: "turn on", isFinal: false })
 * console.log(reading.isFinal) // false
 * ```
 *
 * @category models
 *
 * @since 0.5.0
 */
export class Transcript extends Schema.Class<Transcript, { readonly brand: unique symbol }>(
  "@thomasfosterau/effect-ext/Dictation/Transcript",
)({
  /** The phrase's number within the session, from 0. */
  index: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  /** What was heard. */
  text: Schema.String,
  /** Whether this reading is the phrase's last. */
  isFinal: Schema.Boolean,
}) {}

/**
 * Caller-facing options for one listening session.
 *
 * @category options
 *
 * @since 0.5.0
 */
export interface ListenOptions {
  /** BCP 47 language to expect (provider default when omitted). */
  readonly language?: string;
  /** Report readings before a phrase is final (off when omitted). */
  readonly interimResults?: boolean;
}

/**
 * Provider options for one listening session, consumed by {@link make}.
 *
 * @category options
 *
 * @since 0.5.0
 */
export interface ProviderOptions {
  readonly language?: string;
  readonly interimResults?: boolean;
}

/**
 * Provider reading contract, consumed by {@link make}.
 *
 * @category models
 *
 * @since 0.5.0
 */
export interface ProviderTranscript {
  readonly index: number;
  readonly text: string;
  readonly isFinal: boolean;
}

/**
 * Defines the service interface for live speech to text.
 *
 * - `listen` — listens until the provider's session ends, as its readings.
 *   Ending the stream early stops listening.
 *
 * @category models
 *
 * @since 0.5.0
 */
export interface Service {
  readonly listen: (options?: ListenOptions) => Stream.Stream<Transcript, AiError.AiError>;
}

/**
 * Service tag for live speech to text.
 *
 * **When to use**
 *
 * Use to take what the user says as text in an `Effect` program, without
 * caring which recogniser hears it.
 *
 * @see {@link Service} for the service contract provided by this tag
 * @see {@link make} for constructing a dictation service from a provider
 *
 * @category services
 *
 * @since 0.5.0
 */
export class Dictation extends Context.Service<Dictation, Service>()(
  "@thomasfosterau/effect-ext/Dictation",
) {}

const decodeTranscript = (
  reading: ProviderTranscript,
): Effect.Effect<Transcript, AiError.AiError> =>
  Schema.decodeEffect(Transcript)(reading).pipe(
    Effect.mapError((issue) =>
      AiError.make({
        module: "Dictation",
        method: "listen",
        reason: new AiError.InvalidOutputError({
          description: `Invalid reading: ${issue.message}`,
        }),
      }),
    ),
  );

/**
 * Creates a `Dictation` service from a provider's `listen`.
 *
 * **Details**
 *
 * Each reading becomes a {@link Transcript}; one whose `index` is not a
 * whole number from 0 fails the stream with `AiError.InvalidOutputError`.
 * Interim readings reach the caller only when `interimResults` is set,
 * whatever the provider sends. Each session runs in a `Dictation.listen`
 * span.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import { Dictation } from "@thomasfosterau/effect-ext"
 *
 * const program = Effect.gen(function* () {
 *   const dictation = yield* Dictation.make({
 *     listen: () =>
 *       Stream.make(
 *         { index: 0, text: "turn on", isFinal: false },
 *         { index: 0, text: "turn on the lights", isFinal: true },
 *       ),
 *   })
 *   return yield* Stream.runCollect(dictation.listen())
 * })
 *
 * Effect.runPromise(program).then((readings) => console.log(readings.map((r) => r.text)))
 * // ["turn on the lights"]
 * ```
 *
 * @see {@link Service} for the service shape returned by this constructor
 *
 * @category constructors
 *
 * @since 0.5.0
 */
export const make = (params: {
  readonly listen: (options: ProviderOptions) => Stream.Stream<ProviderTranscript, AiError.AiError>;
}): Effect.Effect<Service> =>
  Effect.sync(() =>
    Dictation.of({
      listen: (options = {}) =>
        params.listen(options).pipe(
          Stream.filter((reading) => reading.isFinal || options.interimResults === true),
          Stream.mapEffect(decodeTranscript),
          Stream.withSpan("Dictation.listen"),
        ),
    }),
  );

/**
 * Listens through the `Dictation` in context.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import { Dictation } from "@thomasfosterau/effect-ext"
 *
 * const program = Stream.runCollect(Dictation.listen({ language: "en-AU" })).pipe(
 *   Effect.provideServiceEffect(
 *     Dictation.Dictation,
 *     Dictation.make({ listen: () => Stream.make({ index: 0, text: "hello", isFinal: true }) }),
 *   ),
 * )
 *
 * Effect.runPromise(program).then((readings) => console.log(readings.length)) // 1
 * ```
 *
 * @category accessors
 *
 * @since 0.5.0
 */
export const listen = (
  options?: ListenOptions,
): Stream.Stream<Transcript, AiError.AiError, Dictation> =>
  Stream.unwrap(Effect.map(Dictation, (dictation) => dictation.listen(options)));
