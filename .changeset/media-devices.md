---
"@thomasfosterau/effect-platform-browser": minor
---

Add `MediaDevices`: camera, microphone and screen capture as scoped streams whose tracks stop when the scope closes; the device list and its changes; `trackEnded` and `attach`; and `record`, which turns a stream into the `MediaRecorder`'s `Blob` chunks. `Browser.layer` provides it, and `BrowserTesting`'s `TestMediaDevices` doubles devices, captures and the recorder.
