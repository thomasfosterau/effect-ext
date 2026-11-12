---
"@thomasfosterau/effect-ai-elevenlabs": minor
---

Raise the `effect` peer floor from `^4.0.0` to `^4.1.0`. Effect 4.1 removed the request details from `AiError`'s `NetworkError` and HTTP context, so errors this package returns no longer carry them (the status, response headers and body are kept).
