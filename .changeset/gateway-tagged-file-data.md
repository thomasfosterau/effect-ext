---
"@thomasfosterau/effect-ai-gateway": patch
---

`OpenAiModeration` accepts an image file part whose `data` is in the tagged JSON form that encoding a prompt produces (`{ _tag: "Uint8Array", base64 }` or `{ _tag: "URL", href }`), which `Prompt.FilePartEncoded` admits from `effect` 4.0.6. The first is sent as a `data:` URI and the second as its URL.
