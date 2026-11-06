---
"@thomasfosterau/effect-ai-cloudflare": minor
---

First release under this name: `@thomasfosterau/effect-ai-gateway` (published to 0.5.1, now deprecated) is renamed `@thomasfosterau/effect-ai-cloudflare` and extends the official `@effect/ai-cloudflare`. Every export of the gateway package keeps its name and behaviour, so moving is an import change. Changes since effect-ai-gateway 0.5.1, besides those listed with this release:

- **Workers AI decision models, from the same package.** The new `WorkersAi` module re-exports `@effect/ai-cloudflare`'s `CloudflareClient`, `CloudflareDecisionModel` (Clef and Clef-flash for `effect/ai`'s `DecisionModel`) and `CloudflareSchema` unchanged, and wires that client to the AI Gateway the other routes use: `cloudflareClientLayer({ gateway, apiToken, apiUrl?, transformClient? })` sets its account id and `gatewayId` from a `GatewayUrlConfig` and sends the gateway's `cf-aig-authorization` token; `cloudflareClientLayerConfig` reads `CF_ACCOUNT_ID`, `CF_AIG_GATEWAY_ID`, `CF_AIG_TOKEN` and `CF_API_TOKEN` (the Cloudflare API token Workers AI REST authenticates with); `decisionModelLayerConfig({ model })` is the decision model over it.
- **Breaking: new required peer and a higher `effect` floor.** `@effect/ai-cloudflare` is a peer (`^4.0.6`, the first release whose `CloudflareClient` routes through an AI Gateway), and the `effect` peer rises from `^4.0.0` to `^4.0.6`, which that release requires. `@effect/ai-anthropic` stays `^4.0.0`.
- The package lives in [`thomasfosterau/effect-ext`](https://github.com/thomasfosterau/effect-ext); its `repository`, `homepage` and `bugs` fields point there.
