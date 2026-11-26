/**
 * Defines the provider-neutral service for speech played on the device.
 *
 * A `Speaker` says text out loud, where `SpeechModel` returns the audio as
 * bytes. A browser's own speech engine implements it, and so does any
 * `SpeechModel` paired with an audio sink. Failures are `AiError` values.
 *
 * @since 0.5.0
 */

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Str from "effect/String";
import type { AiError } from "effect/ai";

/**
 * Caller-facing options for one utterance.
 *
 * @category options
 *
 * @since 0.5.0
 */
export interface SayOptions {
  /** The text to say. */
  readonly text: string;
  /** Provider voice identifier (provider default when omitted). */
  readonly voice?: string;
  /** BCP 47 language of the text (provider default when omitted). */
  readonly language?: string;
}

/**
 * Provider options for one utterance, consumed by {@link make}.
 *
 * @category options
 *
 * @since 0.5.0
 */
export interface ProviderOptions {
  readonly text: string;
  readonly voice?: string;
  readonly language?: string;
}

/**
 * Defines the service interface for speech played on the device.
 *
 * - `say` — says the text, succeeding once it has been said to the end.
 *   Interrupting it stops the speech.
 *
 * @category models
 *
 * @since 0.5.0
 */
export interface Service {
  readonly say: (options: SayOptions) => Effect.Effect<void, AiError.AiError>;
}

/**
 * Service tag for speech played on the device.
 *
 * **When to use**
 *
 * Use to say text out loud from an `Effect` program, without caring whether
 * the device's own engine or a provider's audio does it.
 *
 * @see {@link Service} for the service contract provided by this tag
 * @see {@link make} for constructing a speaker from a provider
 *
 * @category services
 *
 * @since 0.5.0
 */
export class Speaker extends Context.Service<Speaker, Service>()(
  "@thomasfosterau/effect-ext/Speaker",
) {}

/**
 * Creates a `Speaker` service from a provider's `say`.
 *
 * **Details**
 *
 * Text that is empty or only whitespace never reaches the provider: it is
 * said at once, as silence. Each call runs in a `Speaker.say` span.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Speaker } from "@thomasfosterau/effect-ext"
 *
 * const said: Array<string> = []
 * const program = Effect.gen(function* () {
 *   const speaker = yield* Speaker.make({
 *     say: ({ text }) => Effect.sync(() => void said.push(text)),
 *   })
 *   yield* speaker.say({ text: "Hello" })
 *   yield* speaker.say({ text: "  " })
 *   return said
 * })
 *
 * Effect.runPromise(program).then(console.log) // ["Hello"]
 * ```
 *
 * @see {@link Service} for the service shape returned by this constructor
 *
 * @category constructors
 *
 * @since 0.5.0
 */
export const make = (params: {
  readonly say: (options: ProviderOptions) => Effect.Effect<void, AiError.AiError>;
}): Effect.Effect<Service> =>
  Effect.sync(() =>
    Speaker.of({
      say: (options) =>
        Str.isEmpty(Str.trim(options.text))
          ? Effect.void
          : params.say(options).pipe(Effect.withSpan("Speaker.say")),
    }),
  );

/**
 * Says `options.text` through the `Speaker` in context.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Speaker } from "@thomasfosterau/effect-ext"
 *
 * const program = Speaker.say({ text: "Ready" }).pipe(
 *   Effect.provideServiceEffect(
 *     Speaker.Speaker,
 *     Speaker.make({ say: ({ text }) => Effect.log(`saying ${text}`) }),
 *   ),
 * )
 *
 * Effect.runPromise(program)
 * ```
 *
 * @category accessors
 *
 * @since 0.5.0
 */
export const say = (options: SayOptions): Effect.Effect<void, AiError.AiError, Speaker> =>
  Effect.flatMap(Speaker, (speaker) => speaker.say(options));
