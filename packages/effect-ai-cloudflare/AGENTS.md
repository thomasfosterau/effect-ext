# @thomasfosterau/effect-ai-cloudflare

Cloudflare AI for Effect, extending the official `@effect/ai-cloudflare`. Two halves:

- **Workers AI** (`WorkersAi.ts`): re-exports `@effect/ai-cloudflare`'s `CloudflareClient`, `CloudflareDecisionModel` and `CloudflareSchema` unchanged, and builds that `CloudflareClient` from the same gateway config the routes use (`gatewayId` routing plus the `cf-aig-authorization` token). REST only: upstream's client is an `HttpClient` against `api.cloudflare.com`, so there is no `env.AI.run` variant.
- **The AI Gateway routes**: repoint other providers' clients at a Cloudflare AI Gateway route, through a Worker `AI` binding or the gateway's public HTTPS endpoint, BYOK. Anthropic goes through the upstream `@effect/ai-anthropic` client; Cohere embed / rerank and OpenAI moderation go through the gateway's universal endpoint. These do not sit on `CloudflareClient`: it authenticates with a Cloudflare API token as `Authorization: Bearer` against `api.cloudflare.com` and turns every non-2xx into an `HttpClientError`, while the routes call `gateway.ai.cloudflare.com` (or the binding), carry the provider's own auth (BYOK: none, the gateway injects it) and map a non-2xx body through `AiError.reasonFromHttpStatus`.

## Boundary

Peers: `effect` and `@effect/ai-cloudflare` (both `^4.0.6`, `catalogs.ai-cloudflare-peers`: `CloudflareClient`'s `gatewayId` option first shipped in @effect/ai-cloudflare 4.0.6, which peers on `effect ^4.0.6`), `@effect/ai-anthropic`, and `@cloudflare/workers-types` (optional, types only). May import `@thomasfosterau/effect-ext` and nothing else from this workspace (`.fallowrc.json` zone `cloudflare`). The barrel is flat (`export *` of each module; `WorkersAi` adds upstream's three namespaces) and re-exports no `RerankerModel` name; consumers import it from `@thomasfosterau/effect-ext/RerankerModel` (#97).

Published as `@thomasfosterau/effect-ai-gateway` up to 0.5.1; renamed before this repository's first release, so the new name starts again at 0.1.0.

## Invariants

- **The published `.d.ts` names nothing from `@cloudflare/workers-types`** (#113): the binding is typed by the structural `WorkersAiBinding` / `WorkersAiGateway`, which a real `env.AI: Ai` must stay assignable to (`tests/workers-types-binding.test.ts`; `vp run check:dist` compiles a Worker probe against the built types). The workers-types peer floor is the first release whose `AiGateway` declares `getUrl()`.
- **No provider key is read.** Keys live on the gateway; upstream clients get `apiKey: undefined`. The only keys taken are `OpenAiModeration`'s optional, caller-supplied `apiKey` and Workers AI's Cloudflare API token (`CF_API_TOKEN`), which is Cloudflare's own, not a provider's.
- **Every gateway route has a binding variant and a `…FromUrl` variant** (Workers AI, REST only, is the exception) sharing one request body and one lenient response decode. The URL variants read `CF_ACCOUNT_ID`, `CF_AIG_GATEWAY_ID` and `CF_AIG_TOKEN` (`Url.gatewayUrlConfig`), all required, no default gateway id: a missing or empty one fails construction with a `ConfigError`.
- **Every failure is an `AiError`** naming the module and method: a rejected binding call, a non-2xx status, an unreadable or undecodable body.
- **Interrupting a `gatewayRun` aborts the subrequest** (the `signal` from `Effect.tryPromise` is passed to `run`; `tests/binding.test.ts`). The HTTPS variants ride `FetchHttpClient`, which is already interruption-safe.
- **No application vocabulary**: the gateway id is always the caller's.
