---
"@thomasfosterau/effect-ai-mistral": patch
---

The response decoder reads Mistral's numeric fields (token usage, choice `index`, `created`) as `Schema.Finite` instead of `Schema.Number`. JSON cannot carry `NaN` or an infinity, so no valid response decodes differently.
