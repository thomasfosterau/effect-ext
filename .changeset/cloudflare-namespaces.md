---
"@thomasfosterau/effect-ai-cloudflare": minor
---

The root now re-exports each module as a namespace, like every other package, and the names drop the module prefix the namespace makes redundant. Subpath imports keep their paths but take the new names.

Migration:

| Before | After (root) | After (subpath) |
| --- | --- | --- |
| `anthropicLanguageModelLayer`, `…FromUrl` | `Anthropic.languageModelLayer`, `…FromUrl` | `/Anthropic`: `languageModelLayer` |
| `makeCohereEmbeddingModel`, `…FromUrl` | `Cohere.makeEmbeddingModel`, `…FromUrl` | `/Cohere`: `makeEmbeddingModel` |
| `makeCohereReranker`, `…FromUrl` | `Cohere.makeReranker`, `…FromUrl` | `/Cohere`: `makeReranker` |
| `COHERE_EMBEDDING_MODEL`, `COHERE_RERANK_MODEL`, `COHERE_EMBEDDING_DIMENSIONS` | `Cohere.EMBEDDING_MODEL`, `Cohere.RERANK_MODEL`, `Cohere.EMBEDDING_DIMENSIONS` | `/Cohere` |
| `CohereEmbeddingOptions` | `Cohere.EmbeddingOptions` | `/Cohere` |
| `makeOpenAiModerationModel`, `…FromUrl` | `OpenAiModeration.makeModel`, `…FromUrl` | `/OpenAiModeration`: `makeModel` |
| `OPENAI_MODERATION_MODEL`, `OpenAiModerationOptions`, `OpenAiModerationCall` | `OpenAiModeration.MODEL`, `.Options`, `.Call` | `/OpenAiModeration` |
| `gatewayRun`, `gatewayUrl`, `GatewayBinding`, … | `Binding.gatewayRun`, … | `/Binding` (unchanged) |
| `gatewayUrlConfig`, `gatewayBaseUrl`, … | `Url.gatewayUrlConfig`, … | `/Url` (unchanged) |
| `cloudflareClientLayer`, `CloudflareClient`, … | `WorkersAi.cloudflareClientLayer`, `WorkersAi.CloudflareClient`, … | `/WorkersAi` (unchanged) |
