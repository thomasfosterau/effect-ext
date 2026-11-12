---
"@thomasfosterau/effect-ext": minor
---

`Negotiate` is now media-type-agnostic, and effect-ext drops its optional peer `@thomasfosterau/effect-jsonapi`. **Breaking.**

`NegotiationOptions` is now `{ accept, contentType? }`, lists of `Representation`s (`{ mediaType, servesPath?, acceptsParameters? }`) in priority order, replacing `isApiPath`, `isMarkdownPath` and `extensions`. `Negotiation` is now a `Data.TaggedEnum` (`Selected`, `Fallback`, `NotAcceptable`, `UnsupportedMediaType`, with the `Negotiation` constructors, `$is` and `$match`) replacing the `{ representation, dispatch, markdown, error }` object. `NOT_ACCEPTABLE`, `UNSUPPORTED_MEDIA_TYPE` and the old `Representation` string union are removed; `Negotiate` is also now on the `.` barrel.

Migration: build a `markdown` representation (`{ mediaType: MARKDOWN_MEDIA_TYPE, servesPath: makeMarkdownPathMatcher(segments) }`) and a JSON:API one (`servesPath: makeApiPathMatcher(...)`, `acceptsParameters` for the `ext` / `profile` rule), pass `accept: [markdown, jsonApi]` and `contentType: [jsonApi]`, and switch on `verdict._tag` instead of `dispatch` / `markdown` / `error`. The JSON:API rules and its 406 / 415 error documents now come from effect-jsonapi, built on this module.
