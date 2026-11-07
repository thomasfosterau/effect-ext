---
"@thomasfosterau/effect-ext": patch
"@thomasfosterau/effect-ai-cloudflare": patch
"@thomasfosterau/effect-ai-cohere": patch
"@thomasfosterau/effect-ai-elevenlabs": patch
"@thomasfosterau/effect-ai-mistral": patch
"@thomasfosterau/effect-ai-voyage": patch
---

Internal lint clean-up of the AI providers and the evals toolkit (#24). Behaviour is unchanged. Some emitted declarations now omit type arguments equal to their defaults (`Redacted.Redacted` for `Redacted.Redacted<string>`, `Schedule.Schedule<unknown>` for `Schedule.Schedule<unknown, unknown>`); they denote the same types.
