---
"@thomasfosterau/effect-ai-cloudflare": patch
"@thomasfosterau/effect-ai-cohere": patch
"@thomasfosterau/effect-ai-voyage": patch
"@thomasfosterau/effect-ai-elevenlabs": patch
---

Depend on `@thomasfosterau/effect-ext` with a caret range (`^0.3.0`) instead of the exact version. The workspace reference was `workspace:*`, which publishes as an exact pin: every release of these providers pinned exactly the effect-ext of its release day, so an app that also installed another effect-ext consumer (such as `@thomasfosterau/effect-jsonapi`, which depends on `^0.2.0`) got a second effect-ext copy. With `workspace:^` the published range lets the app's package manager dedupe within the effect-ext minor.
