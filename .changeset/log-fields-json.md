---
"@thomasfosterau/effect-ext": minor
---

`Observability`'s `logStructured`, `logEvent`, `logWarningEvent` and `logErrorEvent` take `LogFields` (new, a record of `Schema.Json` values) instead of `Record<string, unknown>`. Render a failure with `describeError` before logging it, and leave an absent field out rather than passing `undefined`.
