---
"@thomasfosterau/effect-ext": minor
"@thomasfosterau/effect-platform-browser": minor
---

Add `Speaker` and `Dictation` to effect-ext: provider-neutral services for speech said out loud on the device (`say`) and live speech to text (`listen`, a stream of `Transcript` readings), each built with `make` and failing only with `AiError`.

effect-platform-browser now depends on effect-ext and adds two modules. `AudioOutput` plays audio bytes through an `<audio>` element, finishing when the clip ends; `Browser.layer` includes it, and `BrowserTesting` adds `TestAudioOutput`. `LiveSpeech` provides `Speaker` and `Dictation` as layers over the browser: `speakerFromSynthesis` (the browser's own voices), `speakerFromModel` (any `SpeechModel`, played through `AudioOutput`) and `dictationFromRecognition` (the browser's own recogniser), mapping each browser failure onto an `AiError` reason.
