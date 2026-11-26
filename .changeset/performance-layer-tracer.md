---
"@thomasfosterau/effect-platform-worker-shared": minor
---

Adds `Performance.layerTracer` and `Performance.measuredTracer`: wrap the current `Tracer` so that every sampled Effect span is also recorded as a user-timing measure (visible in the browser's performance panel) when it ends. Options filter spans by name and attach a span's cloneable attributes as the measure's `detail`. A refused measure is dropped, so tracing never fails the traced effect.
