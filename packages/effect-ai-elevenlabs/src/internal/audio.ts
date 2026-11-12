/**
 * Audio plumbing shared by the ElevenLabs models: collecting a byte stream
 * into a `Blob` for the `multipart/form-data` upload endpoints (Scribe STT and
 * speech-to-speech both require a complete file), resolving the neutral
 * `format` / `sampleRate` speech options into an ElevenLabs `output_format`
 * query value, and deriving an IANA media type from that value.
 *
 * Only the *input* audio is collected — the streaming TTS *output* is threaded
 * through the HTTP body chunk-by-chunk (see {@link ElevenLabsClient}) and never
 * buffered here.
 *
 * @module internal/audio
 *
 * @copyright Thomas Foster
 */

import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { optionalField } from "./fields";

/** Concatenates byte chunks into one contiguous `Uint8Array`. */
const concatBytes = (chunks: ReadonlyArray<Uint8Array>): Uint8Array => {
  const out = new Uint8Array(Arr.reduce(chunks, 0, (total, chunk) => total + chunk.length));
  Arr.reduce(chunks, 0, (offset, chunk) => {
    out.set(chunk, offset);
    return offset + chunk.length;
  });
  return out;
};

/**
 * Materialises audio input (already-resident bytes or a byte stream) into a
 * single `Uint8Array`. A `Uint8Array` passes through untouched; a stream is
 * drained to completion — unavoidable for the multipart upload endpoints,
 * which need a complete file, and bounded by the caller's own input size.
 */
export const collectBytes = (
  audio: Uint8Array | Stream.Stream<Uint8Array>,
): Effect.Effect<Uint8Array> =>
  audio instanceof Uint8Array
    ? Effect.succeed(audio)
    : Stream.runCollect(audio).pipe(Effect.map(concatBytes));

/** Wraps bytes in a `Blob` carrying the given media type (default octet-stream). */
export const toBlob = (bytes: Uint8Array, mediaType?: string): Blob =>
  // SAFETY: `Blob` copies the bytes of any `Uint8Array`; the lib typing of
  // `BlobPart` only rejects one whose buffer may be a `SharedArrayBuffer`.
  new Blob([bytes as BlobPart], { type: mediaType ?? "application/octet-stream" });

/**
 * Resolves the neutral speech options into an ElevenLabs `output_format` query
 * value. An explicit `outputFormat` (set on the model) wins; a `format` that
 * already contains an underscore is treated as a full ElevenLabs id and passed
 * through; otherwise the codec + sample rate are joined. `None` lets the
 * API apply its own default (`mp3_44100_128`).
 */
export const resolveOutputFormat = (params: {
  readonly outputFormat?: string;
  readonly format?: string;
  readonly sampleRate?: number;
}): Option.Option<string> => {
  if (params.outputFormat !== undefined) {
    return Option.some(params.outputFormat);
  }
  const { format, sampleRate } = params;
  if (format === undefined) {
    return Option.none();
  }
  if (format.includes("_")) {
    return Option.some(format);
  }
  const codec = format.toLowerCase();
  if (codec === "mp3") {
    // ElevenLabs exposes mp3 only at a handful of rate/bitrate combos; 44.1kHz
    // at 128kbps is the safe default when only "mp3" is requested.
    return Option.map(Option.fromUndefinedOr(sampleRate), (rate) => `mp3_${rate}_128`);
  }
  // pcm / ulaw / alaw / opus are addressed as `${codec}_${sampleRate}`.
  return Option.some(sampleRate !== undefined ? `${codec}_${sampleRate}` : codec);
};

/** Maps an ElevenLabs `output_format` value to an IANA media type. */
export const mediaTypeForOutputFormat = (output: Option.Option<string>): string => {
  const format = Option.getOrElse(output, () => "mp3");
  if (format.startsWith("mp3")) {
    return "audio/mpeg";
  }
  if (format.startsWith("pcm")) {
    return "audio/pcm";
  }
  if (format.startsWith("ulaw")) {
    return "audio/basic";
  }
  if (format.startsWith("alaw")) {
    return "audio/x-alaw-basic";
  }
  if (format.startsWith("opus")) {
    return "audio/opus";
  }
  if (format.startsWith("wav")) {
    return "audio/wav";
  }
  return "application/octet-stream";
};

/** The client's per-call options for a resolved `output_format` (none for `None`). */
export const audioRequestOptions = (
  outputFormat: Option.Option<string>,
): { readonly outputFormat?: string } => optionalField("outputFormat", outputFormat);
