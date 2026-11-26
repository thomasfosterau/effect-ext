/**
 * Cloudflare AI for Effect. Workers AI decision models through the official
 * `@effect/ai-cloudflare` package (`WorkersAi`, which re-exports its
 * `CloudflareClient`, `CloudflareDecisionModel` and `CloudflareSchema`), and
 * Effect AI providers (Anthropic, Cohere, OpenAI moderation) routed through
 * a Cloudflare AI Gateway, by Worker binding or by the public HTTPS endpoint
 * (the `…FromUrl` variants). Provider keys are BYOK, configured on the
 * gateway, so no layer here takes a vendor API key except OpenAI
 * moderation's opt-in `apiKey`. Both transports share one request body and
 * one lenient response decode per provider, and every failure (a rejected
 * call, a non-2xx status, an unreadable or undecodable body) is an `AiError`
 * naming the provider module and method.
 *
 * The barrel re-exports no `RerankerModel` name: the reranker abstraction
 * that `Cohere.makeReranker` implements lives in
 * `@thomasfosterau/effect-ext/RerankerModel`, so import it from there.
 *
 * @module effect-ai-cloudflare
 */

export * as Anthropic from "./Anthropic";
export * as Binding from "./Binding";
export * as Cohere from "./Cohere";
export * as OpenAiModeration from "./OpenAiModeration";
export * as Url from "./Url";
export * as WorkersAi from "./WorkersAi";
