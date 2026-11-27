---
"@thomasfosterau/effect-ai-cloudflare": patch
---

Drop the optional `@cloudflare/workers-types` peer. The published declarations name nothing from it, so it was never needed; a Worker's `env.AI` from workers-types 4.20250312.0 or later is still assignable to `WorkersAiBinding`.
