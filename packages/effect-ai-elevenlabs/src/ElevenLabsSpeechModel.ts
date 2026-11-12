/**
 * `ElevenLabsSpeechModel` — the ElevenLabs implementation of `effect-ext`'s
 * `SpeechModel` service (text-to-speech). It exposes both surfaces the
 * abstraction defines: `generate`, returning the full audio buffer, and
 * `stream`, emitting audio byte chunks as they arrive from ElevenLabs'
 * `/stream` endpoint.
 *
 * The streaming surface is fully backpressured and interruption-safe: it
 * returns the {@link ElevenLabsClient} byte stream unchanged (the abstraction
 * only wraps it in a tracing span), and that stream is the raw HTTP body, which
 * effect's `HttpClient` pulls on demand and aborts on interruption. Nothing is
 * buffered whole.
 *
 * The public surface mirrors the mistral archetype: {@link make} for the
 * service effect and {@link layer} for a `SpeechModel` layer over
 * {@link ElevenLabsClient}. Model-level defaults (voice, model id, output
 * format, voice settings) are supplied at construction and overridden per call
 * by the neutral `SpeechOptions` (`voice`, `format`, `sampleRate`).
 *
 * The neutral `format` and `sampleRate` map onto ElevenLabs' combined
 * `output_format` (`pcm` with `24000` becomes `pcm_24000`); a `format` that
 * already contains an underscore is passed through as-is, and
 * {@link Settings.outputFormat} sets an exact id. A call with neither `voice`
 * nor a default `voiceId` fails with an `AiError` (`InvalidUserInputError`).
 *
 * @module ElevenLabsSpeechModel
 *
 * @copyright Thomas Foster
 */

import * as SpeechModel from "@thomasfosterau/effect-ext/SpeechModel";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as Struct from "effect/Struct";
import * as AiError from "effect/ai/AiError";
import { ElevenLabsClient } from "./ElevenLabsClient";
import {
  audioRequestOptions,
  mediaTypeForOutputFormat,
  resolveOutputFormat,
} from "./internal/audio";
import { optionalField } from "./internal/fields";
import type * as Wire from "./internal/wire";

const MODULE = "ElevenLabsSpeechModel";

/**
 * A selection of well-known ElevenLabs model ids, offered for autocomplete
 * only — {@link Settings} accepts any string.
 */
export type Model =
  | "eleven_multilingual_v2"
  | "eleven_turbo_v2_5"
  | "eleven_flash_v2_5"
  | "eleven_v3"
  | "eleven_monolingual_v1";

/**
 * Construction-time defaults for an {@link ElevenLabsSpeechModel}. The neutral
 * `SpeechOptions` passed per call (`voice`, `format`, `sampleRate`) override
 * the corresponding defaults here.
 */
export interface Settings {
  /** Default ElevenLabs voice id, used when a call omits `voice`. */
  readonly voiceId?: string;
  /** ElevenLabs model id (e.g. `eleven_multilingual_v2`). */
  readonly modelId?: (string & Record<never, never>) | Model;
  /**
   * Explicit ElevenLabs `output_format` (e.g. `mp3_44100_128`). Wins over a
   * call's neutral `format` / `sampleRate`.
   */
  readonly outputFormat?: string;
  /** ISO language code hint passed to the model. */
  readonly languageCode?: string;
  /** Default voice-settings block (stability, similarity boost, style, …). */
  readonly voiceSettings?: Wire.VoiceSettings;
  /** Deterministic sampling seed. */
  readonly seed?: number;
}

const missingVoice = (method: string): AiError.AiError =>
  AiError.make({
    module: MODULE,
    method,
    reason: new AiError.InvalidUserInputError({
      description:
        "ElevenLabs text-to-speech requires a voice id; set `voiceId` on the model or pass `voice` in the request",
    }),
  });

const buildBody = (
  options: SpeechModel.ProviderOptions,
  settings: Settings,
): Wire.TextToSpeechRequest => ({
  text: options.text,
  ...optionalField("model_id", Option.fromUndefinedOr(settings.modelId)),
  ...optionalField("language_code", Option.fromUndefinedOr(settings.languageCode)),
  ...optionalField("voice_settings", Option.fromUndefinedOr(settings.voiceSettings)),
  ...optionalField("seed", Option.fromUndefinedOr(settings.seed)),
});

/**
 * Constructs a `SpeechModel.Service` backed by {@link ElevenLabsClient}.
 *
 * @see {@link layer} for providing the service as a `Layer`
 */
export const make = (
  settings?: Settings,
): Effect.Effect<SpeechModel.Service, never, ElevenLabsClient> =>
  Effect.gen(function* () {
    const client = yield* ElevenLabsClient;
    const config = settings ?? {};

    const resolveVoice = (options: SpeechModel.ProviderOptions): Option.Option<string> =>
      Option.fromUndefinedOr(options.voice ?? config.voiceId);

    const outputFormatFor = (options: SpeechModel.ProviderOptions): Option.Option<string> =>
      resolveOutputFormat({
        ...Struct.pick(config, ["outputFormat"]),
        ...Struct.pick(options, ["format", "sampleRate"]),
      });

    return yield* SpeechModel.make({
      generate: (options) =>
        Effect.gen(function* () {
          const resolved = resolveVoice(options);
          if (Option.isNone(resolved)) {
            return yield* missingVoice("generate");
          }
          const voice = resolved.value;
          const outputFormat = outputFormatFor(options);
          const result = yield* client.textToSpeech(
            voice,
            buildBody(options, config),
            audioRequestOptions(outputFormat),
          );
          return {
            audio: result.audio,
            mediaType: Option.getOrElse(result.contentType, () =>
              mediaTypeForOutputFormat(outputFormat),
            ),
            // ElevenLabs bills per input character; report the submitted length.
            usage: { inputCharacters: Option.some(options.text.length) },
          };
        }),
      stream: (options) => {
        const resolved = resolveVoice(options);
        if (Option.isNone(resolved)) {
          return Stream.fail(missingVoice("stream"));
        }
        const voice = resolved.value;
        return client.textToSpeechStream(
          voice,
          buildBody(options, config),
          audioRequestOptions(outputFormatFor(options)),
        );
      },
    });
  });

/**
 * Provides {@link ElevenLabsSpeechModel} as a `SpeechModel` layer, drawing
 * {@link ElevenLabsClient} from another layer.
 */
export const layer = (
  settings?: Settings,
): Layer.Layer<SpeechModel.SpeechModel, never, ElevenLabsClient> =>
  Layer.effect(SpeechModel.SpeechModel, make(settings));
