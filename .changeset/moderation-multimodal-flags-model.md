---
"@thomasfosterau/effect-ai-cloudflare": minor
---

The OpenAI moderation provider follows `ModerationModel`'s multimodal inputs and richer results (effect-ai-ext#143; the abstraction is now `@thomasfosterau/effect-ext/ModerationModel`).

- **Per-category flags.** Each `ModerationResult.flags` is filled from OpenAI's `categories` (nulls dropped).
- **Resolved model id.** `ModerationResponse.modelId` is OpenAI's dated snapshot.
- **Call ledger.** `OpenAiModerationOptions.onCall` observes each HTTP call's `status`, `durationMillis` and `error` (`OpenAiModerationCall`), on success and failure, on both transports.
- Image file parts are sent as `image_url` parts, one request per multimodal input; a non-image file part fails with `AiError.InvalidUserInputError` before any request.
