---
"@thomasfosterau/effect-ext": minor
---

Text-format modules (`UriTemplate`, `Langtag`, `LangtagRegistry`, `Css`, `Encoding`, `Mime`): optional members and parameters drop `| undefined` (owner rules, #17). A caller holding `undefined` omits the key (`{ ...options }`, or `Struct.pick`) instead of passing `undefined` under `exactOptionalPropertyTypes`.

- `LinkHeader.LinkOptions` (`rel`, `anchor`, `type`, `media`, `title`, `titleStar`, `hreflang`, `params`): `x?: T | undefined` → `x?: T`. Migration: omit the key rather than passing `undefined`.
- `Encoding.DecodeOptions` (`encoding`, `fatal`, `bomHandling`) and `Encoding.EncodeOptions` (`encoding`, `errorMode`): `x?: T | undefined` → `x?: T`. Same migration.
- `Mime.Sniff.SniffOptions` (`supplied`, `noSniff`, `scriptable`, `signatures`, `checkForApacheBug`): `x?: T | undefined` → `x?: T`. Same migration.
- `LangtagRegistry.CanonicalizeOptions.suppressScript`: `suppressScript?: boolean | undefined` → `suppressScript?: boolean`.
- `negotiateLanguage(available, header)`: `header: string | undefined` (required) → `header?: string`. Existing calls still compile; `negotiateLanguage(available)` now also works.

`UriTemplate.Value` keeps accepting `null` and `undefined` (RFC 6570: both, like `[]` and `{}`, are undefined variables). The CSS tokenizer and parser keep their structure; only the internal token cursor now returns `Option`.
