/**
 * `ElevenLabsTranscriptionModel` — the ElevenLabs implementation of
 * `effect-ext`'s `TranscriptionModel` service (speech-to-text) over Scribe.
 * It accepts audio as bytes or a stream, uploads it as `multipart/form-data`,
 * and maps the Scribe transcript into the neutral response: the full text,
 * per-word segment timestamps, and the detected language. The latest word end
 * is reported as `usage.durationSeconds`.
 *
 * Scribe is a whole-file endpoint, so a streamed input is drained to a `Blob`
 * before upload — the only audio buffered anywhere in this package, and bounded
 * by the caller's own input.
 *
 * @module ElevenLabsTranscriptionModel
 *
 * @copyright Thomas Foster
 */

import * as TranscriptionModel from "@thomasfosterau/effect-ext/TranscriptionModel";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as P from "effect/Predicate";
import { ElevenLabsClient } from "./ElevenLabsClient";
import { collectBytes, toBlob } from "./internal/audio";
import { optionalField } from "./internal/fields";
import type * as Wire from "./internal/wire";

/** The default Scribe model id. */
const DEFAULT_MODEL_ID = "scribe_v1";

/**
 * A selection of well-known Scribe model ids, offered for autocomplete only —
 * {@link Settings} accepts any string.
 */
export type Model = "scribe_v1" | "scribe_v1_experimental";

/** Construction-time defaults for an {@link ElevenLabsTranscriptionModel}. */
export interface Settings {
  /** Scribe model id (default `scribe_v1`). */
  readonly modelId?: (string & Record<never, never>) | Model;
  /** Default language-code hint; a call's `language` overrides it. */
  readonly languageCode?: string;
  /** Timestamp granularity (`word` or `character`; default `word`). */
  readonly timestampsGranularity?: string;
  /** Annotate speakers in the transcript. */
  readonly diarize?: boolean;
  /** Tag non-speech audio events (laughter, etc.). */
  readonly tagAudioEvents?: boolean;
}

/** One spoken word's span in the transcript. */
interface Segment {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/**
 * A token as a segment: only spoken words carry meaningful segment offsets, so
 * `spacing` / `audio_event` tokens and any word missing a timestamp pair map
 * to `None`.
 */
const toSegment = (word: Wire.TranscriptWord): Option.Option<Segment> =>
  (P.isNullish(word.type) || word.type === "word") && P.isNumber(word.start) && P.isNumber(word.end)
    ? Option.some({ text: word.text ?? "", start: word.start, end: word.end })
    : Option.none();

/** The latest end offset any token reports: the transcript's duration. */
const latestEnd = (words: ReadonlyArray<Wire.TranscriptWord>): Option.Option<number> =>
  Arr.match(
    Arr.filter(
      Arr.map(words, (word) => word.end),
      P.isNumber,
    ),
    {
      onEmpty: () => Option.none(),
      onNonEmpty: (ends) => Option.some(Arr.max(ends, Order.Number)),
    },
  );

/** Maps a Scribe transcript into the neutral provider response. */
const mapTranscript = (body: Wire.SpeechToTextResponse): TranscriptionModel.ProviderResponse => {
  const words = body.words ?? [];
  const segments = Arr.getSomes(Arr.map(words, toSegment));
  return {
    text: body.text ?? "",
    segments: Option.liftPredicate(segments, Arr.isReadonlyArrayNonEmpty),
    language: Option.fromNullishOr(body.language_code),
    usage: { durationSeconds: latestEnd(words) },
  };
};

/**
 * Constructs a `TranscriptionModel.Service` backed by {@link ElevenLabsClient}.
 *
 * @see {@link layer} for providing the service as a `Layer`
 */
export const make = (
  settings?: Settings,
): Effect.Effect<TranscriptionModel.Service, never, ElevenLabsClient> =>
  Effect.gen(function* () {
    const client = yield* ElevenLabsClient;
    const config = settings ?? {};

    return yield* TranscriptionModel.make({
      transcribe: (options) =>
        Effect.gen(function* () {
          const bytes = yield* collectBytes(options.audio);
          const form: Wire.SpeechToTextForm = {
            file: toBlob(bytes, options.mediaType),
            model_id: config.modelId ?? DEFAULT_MODEL_ID,
            ...optionalField(
              "language_code",
              Option.fromUndefinedOr(options.language ?? config.languageCode),
            ),
            ...optionalField(
              "timestamps_granularity",
              Option.fromUndefinedOr(config.timestampsGranularity),
            ),
            ...optionalField("diarize", Option.fromUndefinedOr(config.diarize)),
            ...optionalField("tag_audio_events", Option.fromUndefinedOr(config.tagAudioEvents)),
          };
          const [body] = yield* client.speechToText(form);
          return mapTranscript(body);
        }),
    });
  });

/**
 * Provides {@link ElevenLabsTranscriptionModel} as a `TranscriptionModel`
 * layer, drawing {@link ElevenLabsClient} from another layer.
 */
export const layer = (
  settings?: Settings,
): Layer.Layer<TranscriptionModel.TranscriptionModel, never, ElevenLabsClient> =>
  Layer.effect(TranscriptionModel.TranscriptionModel, make(settings));
