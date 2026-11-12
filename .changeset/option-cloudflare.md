---
"@thomasfosterau/effect-ai-cloudflare": minor
---

Absence is spelled the way the rest of the workspace spells it (#17). Breaking on 0.x.

- `WorkersAi` and `OpenAiModeration` option members (`apiUrl`, `transformClient`, `apiKey`, `model`, `onCall`): `x?: T | undefined` is now `x?: T`.
- `OpenAiModerationCall` (`GatewayCall`, what `onCall` observes): `status: number | undefined` is now `Option.Option<number>` and `error: AiError | undefined` is now `Option.Option<AiError>`.
