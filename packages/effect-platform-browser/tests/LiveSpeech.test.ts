import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { AiError } from "effect/ai";
import { Dictation, Speaker, SpeechModel } from "@thomasfosterau/effect-ext";
import { LiveSpeech } from "@thomasfosterau/effect-platform-browser";
import {
  TestAudioOutput,
  TestSpeechRecognition,
  TestSpeechSynthesis,
} from "@thomasfosterau/effect-platform-browser/BrowserTesting";

/** The tag of a failed program's `AiError` reason. */
const reasonOf = <A, R>(program: Effect.Effect<A, AiError.AiError, R>) =>
  Effect.map(Effect.flip(program), (error) => error.reason._tag);

const synthesis = (options?: TestSpeechSynthesis.Options) =>
  LiveSpeech.speakerFromSynthesis.pipe(Layer.provideMerge(TestSpeechSynthesis.layer(options)));

const generated: Array<SpeechModel.ProviderOptions> = [];
const model = Layer.effect(
  SpeechModel.SpeechModel,
  SpeechModel.make({
    generate: (options) => {
      generated.push(options);
      return Effect.succeed({
        audio: new Uint8Array([1, 2, 3, 4]),
        mediaType: "audio/mpeg",
        usage: { inputCharacters: Option.none() },
      });
    },
    stream: () => Stream.empty,
  }),
);

const fromModel = LiveSpeech.speakerFromModel.pipe(
  Layer.provideMerge(Layer.merge(model, TestAudioOutput.layer())),
);

const recognition = (options?: TestSpeechRecognition.Options) =>
  LiveSpeech.dictationFromRecognition.pipe(
    Layer.provideMerge(TestSpeechRecognition.layer(options)),
  );

describe("LiveSpeech.speakerFromSynthesis", () => {
  it.effect("says the text in the voice and language asked for", () =>
    Effect.gen(function* () {
      yield* Speaker.say({ text: "Bonjour", voice: "Amélie", language: "fr-FR" });
      yield* Speaker.say({ text: "Hello" });
      yield* Speaker.say({ text: "  " });
      const spoken = yield* Effect.flatMap(TestSpeechSynthesis.Control, (c) => c.spoken);
      expect(spoken.map((u) => [u.text, u.lang, u.voice])).toStrictEqual([
        ["Bonjour", "fr-FR", Option.some("fr-FR-voice")],
        ["Hello", "", Option.none()],
      ]);
    }).pipe(Effect.provide(synthesis())),
  );

  it.effect("maps the engine's failures onto AiError reasons", () =>
    Effect.gen(function* () {
      const c = yield* TestSpeechSynthesis.Control;
      const failing = (code: string) =>
        Effect.andThen(c.failNext(code), reasonOf(Speaker.say({ text: "Hello" })));
      expect([
        yield* failing("not-allowed"),
        yield* failing("text-too-long"),
        yield* failing("audio-busy"),
        yield* failing("network"),
        yield* failing("interrupted"),
        yield* failing("synthesis-failed"),
        yield* reasonOf(Speaker.say({ text: "Hello", voice: "Nobody" })),
      ]).toStrictEqual([
        "AuthenticationError",
        "InvalidRequestError",
        "InternalProviderError",
        "InternalProviderError",
        "UnknownError",
        "UnknownError",
        "InvalidRequestError",
      ]);
    }).pipe(Effect.provide(synthesis())),
  );

  it.effect("reports a missing engine as an internal provider error", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(Speaker.say({ text: "Hello" }));
      expect(error.reason).toBeInstanceOf(AiError.InternalProviderError);
      expect(error.reason.message).toContain("speech synthesis: Unsupported");
    }).pipe(Effect.provide(synthesis({ supported: false }))),
  );

  it.effect("reports a refusal as missing permissions", () =>
    Effect.gen(function* () {
      yield* Effect.flatMap(TestSpeechSynthesis.Control, (c) => c.failNext("not-allowed"));
      const error = yield* Effect.flip(Speaker.say({ text: "Hello" }));
      expect(error.reason).toMatchObject({ kind: "InsufficientPermissions" });
    }).pipe(Effect.provide(synthesis())),
  );
});

describe("LiveSpeech.speakerFromModel", () => {
  it.effect("plays the model's audio, passing the voice", () =>
    Effect.gen(function* () {
      generated.length = 0;
      yield* Speaker.say({ text: "Hello", voice: "nova", language: "en-AU" });
      yield* Speaker.say({ text: "Again" });
      const played = yield* Effect.flatMap(TestAudioOutput.Control, (c) => c.played);
      expect({ generated, played }).toStrictEqual({
        generated: [{ text: "Hello", voice: "nova" }, { text: "Again" }],
        played: [
          { mediaType: "audio/mpeg", byteLength: 4 },
          { mediaType: "audio/mpeg", byteLength: 4 },
        ],
      });
    }).pipe(Effect.provide(fromModel)),
  );

  it.effect("maps playback failures onto AiError reasons", () =>
    Effect.gen(function* () {
      const c = yield* TestAudioOutput.Control;
      const refused = (name: string) =>
        Effect.andThen(c.refuseNext(name), reasonOf(Speaker.say({ text: "Hello" })));
      expect([
        yield* refused("NotAllowedError"),
        yield* refused("NotSupportedError"),
        yield* refused("AbortError"),
      ]).toStrictEqual(["AuthenticationError", "InvalidRequestError", "UnknownError"]);
    }).pipe(Effect.provide(fromModel)),
  );
});

describe("LiveSpeech.dictationFromRecognition", () => {
  it.effect("listens continuously, in the language asked for, with final readings", () =>
    Effect.gen(function* () {
      const c = yield* TestSpeechRecognition.Control;
      yield* c.say(["turn on", "turn on the lights"]);
      const heard = yield* Stream.runCollect(
        Stream.take(Dictation.listen({ language: "en-AU" }), 1),
      );
      const [session] = yield* c.sessions;
      expect({
        heard: heard.map((reading) => [reading.index, reading.text, reading.isFinal]),
        lang: session?.lang,
        continuous: session?.continuous,
        interim: session?.interimResults,
      }).toStrictEqual({
        heard: [[0, "turn on the lights", true]],
        lang: "en-AU",
        continuous: true,
        interim: false,
      });
    }).pipe(Effect.provide(recognition())),
  );

  it.effect("reports interim readings when asked", () =>
    Effect.gen(function* () {
      yield* Effect.flatMap(TestSpeechRecognition.Control, (c) =>
        c.say(["turn on", "turn on the lights"]),
      );
      const heard = yield* Stream.runCollect(
        Stream.take(Dictation.listen({ interimResults: true }), 2),
      );
      expect(heard.map((reading) => reading.isFinal)).toStrictEqual([false, true]);
    }).pipe(Effect.provide(recognition())),
  );

  it.effect("maps the recogniser's failures onto AiError reasons", () =>
    Effect.gen(function* () {
      const c = yield* TestSpeechRecognition.Control;
      const failing = (code: string) =>
        Effect.andThen(c.failNext(code), reasonOf(Stream.runDrain(Dictation.listen())));
      expect([
        yield* failing("service-not-allowed"),
        yield* failing("language-not-supported"),
        yield* failing("audio-capture"),
        yield* failing("aborted"),
      ]).toStrictEqual([
        "AuthenticationError",
        "InvalidRequestError",
        "InternalProviderError",
        "UnknownError",
      ]);
    }).pipe(Effect.provide(recognition())),
  );
});
