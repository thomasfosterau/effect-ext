/**
 * `ElevenLabsVoiceConversionModel` — the ElevenLabs implementation of
 * `effect-ext`'s `VoiceConversionModel` service (speech-to-speech). It
 * accepts source audio as bytes or a stream, uploads it as
 * `multipart/form-data` to `/v1/speech-to-speech/{voice_id}`, and returns the
 * re-voiced audio buffer.
 *
 * Like Scribe, speech-to-speech is a whole-file endpoint, so a streamed input
 * is drained to a `Blob` before upload.
 *
 * @module ElevenLabsVoiceConversionModel
 *
 * @copyright Thomas Foster
 */

import * as VoiceConversionModel from "@thomasfosterau/effect-ext/VoiceConversionModel";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import { ElevenLabsClient } from "./ElevenLabsClient";
import {
  audioRequestOptions,
  collectBytes,
  mediaTypeForOutputFormat,
  resolveOutputFormat,
  toBlob,
} from "./internal/audio";
import { optionalField } from "./internal/fields";
import type * as Wire from "./internal/wire";

/** Serialises the voice settings form field exactly as `JSON.stringify` would. */
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

/**
 * A selection of well-known ElevenLabs speech-to-speech model ids, offered for
 * autocomplete only — {@link Settings} accepts any string.
 */
export type Model = "eleven_multilingual_sts_v2" | "eleven_english_sts_v2";

/** Construction-time defaults for an {@link ElevenLabsVoiceConversionModel}. */
export interface Settings {
  /** ElevenLabs speech-to-speech model id (e.g. `eleven_multilingual_sts_v2`). */
  readonly modelId?: (string & Record<never, never>) | Model;
  /**
   * Explicit ElevenLabs `output_format` (e.g. `mp3_44100_128`). Wins over a
   * call's neutral `format`.
   */
  readonly outputFormat?: string;
  /** Voice-settings block applied to the target voice. */
  readonly voiceSettings?: Wire.VoiceSettings;
  /** Strip background noise from the source audio before conversion. */
  readonly removeBackgroundNoise?: boolean;
  /** Deterministic sampling seed. */
  readonly seed?: number;
  /** Media-type hint for the uploaded source audio (e.g. `audio/mpeg`). */
  readonly inputMediaType?: string;
}

/**
 * Constructs a `VoiceConversionModel.Service` backed by {@link ElevenLabsClient}.
 *
 * @see {@link layer} for providing the service as a `Layer`
 */
export const make = (
  settings?: Settings,
): Effect.Effect<VoiceConversionModel.Service, never, ElevenLabsClient> =>
  Effect.gen(function* () {
    const client = yield* ElevenLabsClient;
    const config = settings ?? {};

    return yield* VoiceConversionModel.make({
      convert: (options) =>
        Effect.gen(function* () {
          const bytes = yield* collectBytes(options.audio);
          const outputFormat = resolveOutputFormat({
            ...Struct.pick(config, ["outputFormat"]),
            ...Struct.pick(options, ["format"]),
          });
          const form: Wire.SpeechToSpeechForm = {
            audio: toBlob(bytes, config.inputMediaType),
            ...optionalField("model_id", Option.fromUndefinedOr(config.modelId)),
            ...optionalField(
              "voice_settings",
              Option.map(Option.fromUndefinedOr(config.voiceSettings), encodeJson),
            ),
            ...optionalField(
              "remove_background_noise",
              Option.fromUndefinedOr(config.removeBackgroundNoise),
            ),
            ...optionalField("seed", Option.fromUndefinedOr(config.seed)),
          };
          const result = yield* client.speechToSpeech(
            options.targetVoice,
            form,
            audioRequestOptions(outputFormat),
          );
          return {
            audio: result.audio,
            mediaType: Option.getOrElse(result.contentType, () =>
              mediaTypeForOutputFormat(outputFormat),
            ),
            usage: { durationSeconds: Option.none() },
          };
        }),
    });
  });

/**
 * Provides {@link ElevenLabsVoiceConversionModel} as a `VoiceConversionModel`
 * layer, drawing {@link ElevenLabsClient} from another layer.
 */
export const layer = (
  settings?: Settings,
): Layer.Layer<VoiceConversionModel.VoiceConversionModel, never, ElevenLabsClient> =>
  Layer.effect(VoiceConversionModel.VoiceConversionModel, make(settings));
