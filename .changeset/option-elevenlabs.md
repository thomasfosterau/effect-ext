---
"@thomasfosterau/effect-ai-elevenlabs": minor
---

Absence is spelled the way the rest of the workspace spells it (#17). Breaking on 0.x.

- `ElevenLabsClient.Options` (`apiKey`, `apiUrl`, `transformClient`), `AudioRequestOptions.outputFormat` and the speech, transcription and voice-conversion `Settings` members: `x?: T | undefined` is now `x?: T`. A caller holding `undefined` omits the key or uses `Struct.pick`.
- `ElevenLabsClient.layerConfig`'s `apiKey`: `Config.Config<Redacted | undefined>` is now `Config.Config<Redacted>`; omit the setting for no key.
- `ElevenLabsClient.AudioResult.contentType`: `string | undefined` is now `Option.Option<string>`.
- The multipart forms (`SpeechToTextForm`, `SpeechToSpeechForm`) are built with omitted keys instead of `undefined` values; the bodies sent are unchanged.
