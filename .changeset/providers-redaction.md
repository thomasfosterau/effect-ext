---
"@thomasfosterau/effect-ai-cohere": patch
"@thomasfosterau/effect-ai-mistral": patch
"@thomasfosterau/effect-ai-voyage": patch
"@thomasfosterau/effect-ai-elevenlabs": patch
---

Redact response headers in `AiError` and response metadata with the fiber's `Headers.CurrentRedactedNames`, so a customised list is honoured. Cohere and Mistral's request types accept `undefined` for an unset optional member (it is left out of the JSON body), and Cohere ignores a streamed `tool_calls` delta that is an empty array instead of reading past it.
