# Text formats

`UriTemplate` (with `LinkHeader` and `WellKnown`), `Langtag` and `LangtagRegistry`, `Css`, `Encoding` (with its CJK indexes) and `Mime`: parsers and printers for the web's text formats. They were `effect-web`'s sibling packages; see "Moving from effect-web" in the [web guide](https://github.com/thomasfosterau/effect-ext/blob/trunk/packages/effect-ext/guides/web.md).

## UriTemplate

URI Templates ([RFC 6570](https://www.rfc-editor.org/rfc/rfc6570)), Web Linking ([RFC 8288](https://www.rfc-editor.org/rfc/rfc8288)) and well-known URIs ([RFC 8615](https://www.rfc-editor.org/rfc/rfc8615)) for [Effect](https://effect.website).

```sh
pnpm add @thomasfosterau/effect-ext/UriTemplate effect
```

### `UriTemplate`

```ts
import * as Result from "effect/Result";
import { UriTemplate } from "@thomasfosterau/effect-ext/UriTemplate";

const template = UriTemplate.parse("https://api.example/users{/id}{?fields*}");
Result.flatMap(template, (t) => UriTemplate.expand(t, { id: "42", fields: ["name", "email"] }));
// Success("https://api.example/users/42?fields=name&fields=email")
```

- `parse(source): Result<UriTemplate, TemplateError>`. The error carries a `reason` (`UnmatchedBrace`, `InvalidLiteral`, `ReservedOperator`, `InvalidVariable`) and the 0-based `position` of the fault.
- `expand(template, variables): Result<string, TemplateError>` covers all four levels: simple, `+` reserved, `#` fragment, `.` label, `/` path segment, `;` path-style parameter, `?` query and `&` continuation, prefix `:n` and explode `*`, with lists and associative arrays. A value is a string, number or boolean, a list of them, or a flat record of them. `null`, `undefined`, `[]` and `{}` count as undefined. The only failure is `PrefixOnComposite` (a prefix on a list or record).
- `variables(template)` lists each variable name once, in order.
- `matcher(template): Result<Matcher, TemplateError>` and `match(matcher, url): Option<Matched>` are the inverse, for routing: the variables a URL was expanded from. RFC 6570 warns the inverse is ambiguous, so only an unambiguous subset compiles; anything else fails `Unmatchable` with the expression's position (prefix modifiers, several variables in one unnamed expression, explode outside `/` `.` `?` `&`, two expressions with nothing between them that could tell them apart, a query expression before another part, a variable used twice). `U` values are percent-decoded and a raw `,` splits a list; `+` / `#` values are kept as written; query variables are read by name in any order, and an exploded one with no parameter of its own name takes the unclaimed parameters as a record. For a URL the template produced, `expand(template, match(url))` reproduces it.
- `UriTemplateFromString` is the same as a `Schema` codec.

Conformance is checked against the [uritemplate-test](https://github.com/uri-templates/uritemplate-test) suite: the RFC's examples, the extended tests and the negative tests.

### `LinkHeader`

```ts
import { LinkHeader } from "@thomasfosterau/effect-ext/UriTemplate";

const links = LinkHeader.parse(response.headers.get("link") ?? "", response.url);
LinkHeader.findRel(links, "describedby"); // Option<Link>
LinkHeader.serialize([LinkHeader.make("/items?page=3", { rel: "next" })]); // "</items?page=3>; rel=next"
```

- `parse(header, base?)` returns `Link`s, each with `target`, a `rel` set, `anchor`, `type`, `media`, `title`, `titleStar` (RFC 8187, decoded with its language), `hreflang` and the remaining `params`. Targets and anchors are resolved against `base` when one is given. It never fails: malformed link-values are skipped, as RFC 8288 Appendix B describes.
- `serialize(links)` produces one header value. Values are quoted where needed, and `title*` is written as UTF-8.
- `make(target, options)` builds a link. `hasRel`, `findRel` and `filterRel` query by relation type: registered types are compared ignoring case, extension URIs exactly.
- `LinkHeaderFromString` is the header value as a `Schema` codec.

### `WellKnown`

```ts
import { WellKnown } from "@thomasfosterau/effect-ext/UriTemplate";

WellKnown.url("https://example.org/tables/1.csv", "csvm"); // Success(URL "https://example.org/.well-known/csvm")
WellKnown.suffixOf("https://example.org/.well-known/acme-challenge/x"); // Some("acme-challenge")
```

- `url(origin, suffix): Result<URL, WellKnownError>` builds the URL at the root of the origin. It fails with `InvalidSuffix` (not a path segment, or `.` / `..`) or `InvalidOrigin` (a scheme other than `http`, `https`, `ws` or `wss`).
- `suffixOf(url)` returns the suffix a well-known URL addresses. `isValidSuffix` checks suffix syntax.
- `RegisteredSuffix` / `registeredSuffixes` list suffixes in common use (`csvm`, `security.txt`, `change-password`, `openid-configuration`, …).

## Langtag and LangtagRegistry

BCP 47 language tags ([RFC 5646](https://www.rfc-editor.org/rfc/rfc5646)) and language-range matching ([RFC 4647](https://www.rfc-editor.org/rfc/rfc4647)) for [Effect](https://effect.website).

`Intl.Locale` canonicalises tags but rejects some well-formed ones (grandfathered and private-use forms), and there is no built-in RFC 4647 matching. This package parses every well-formed tag, matches the way RFC 4647 specifies, and negotiates a language from `Accept-Language`.

```sh
pnpm add @thomasfosterau/effect-ext/Langtag effect
```

### `LanguageTag`

```ts
import * as Option from "effect/Option";
import { LanguageTag } from "@thomasfosterau/effect-ext/Langtag";

LanguageTag.parse("zh-hant-tw"); // Some("zh-Hant-TW")
LanguageTag.parse("de-419-DE"); // None: two regions

const tag = Option.getOrThrow(LanguageTag.parse("ar-EG"));
LanguageTag.primaryLanguage(tag); // Some("ar")
LanguageTag.region(tag); // Some("EG")
LanguageTag.direction(tag); // "rtl"
```

- `parse(string): Option<LanguageTag>` — any case in, canonical case out (`en-us` → `en-US`, `ZH-HANT` → `zh-Hant`, `I-KLINGON` → `i-klingon`). A `LanguageTag` is a branded string, so two tags are equal exactly when they are `===`.
- `LanguageTagFromString` — the same as a `Schema` codec (string → `LanguageTag`); `LanguageTag` is the schema of the branded, canonical-case value itself.
- `isWellFormed(string)` — the RFC 5646 §2.1 ABNF: language, extlangs, script, region, variants, extensions, private use, and the grandfathered tags.
- `subtags(tag)` — `{ kind, language, extlangs, script, region, variants, extensions, privateUse }`, with `Option` for the single subtags.
- `primaryLanguage`, `script`, `region` — the single subtags as `Option`s.
- `direction(tag)` — `"rtl"` or `"ltr"`, a hint for an HTML `dir`: from the script where there is one (`az-Arab`), else from the language (`ar`, `he`, `fa`, `ur`, `yi`, …).

**Well-formed, not valid.** The root entry never consults the IANA Language Subtag Registry: `qq-Zzzz` parses, `iw` is not mapped to `he`, and a repeated singleton (`ar-a-aaa-b-bbb-a-ccc`) is not rejected. Validity and canonical form are the `LangtagRegistry` entry's.

### `LangtagRegistry` — validity and canonical form

```ts
import * as Option from "effect/Option";
import { LanguageTag } from "@thomasfosterau/effect-ext/Langtag";
import { canonicalize, isValid } from "@thomasfosterau/effect-ext/LangtagRegistry";

const tag = Option.getOrThrow(LanguageTag.parse("iw-IL"));
isValid(tag); // true: `iw` is registered (deprecated)
canonicalize(tag); // "he-IL"
```

- `isValid(tag)` — RFC 5646 §2.2.9: grandfathered and private-use tags, or every language, extlang, script, region and variant subtag registered, with no variant and no extension singleton repeated.
- `canonicalize(tag, { suppressScript? })` — RFC 5646 §4.5: grandfathered and redundant tags and deprecated subtags replaced by their `Preferred-Value` (`i-klingon` → `tlh`, `zh-guoyu` → `cmn`, `in` → `id`, region `BU` → `MM`), an extlang by the language it is (`zh-yue-HK` → `yue-HK`), extensions sorted by singleton; `suppressScript: true` also drops a script the language implies (`en-Latn-US` → `en-US`).
- `suppressScript(language)` — the registry's `Suppress-Script` (`en` → `Latn`).
- `registryDate` — the snapshot's `File-Date`.

It is a separate entry so its ~45 KB registry snapshot is bundled only by code that imports it. The snapshot is generated by `scripts/generate-language-subtag-registry.mjs`.

### `LanguageRange`

```ts
import { LanguageRange } from "@thomasfosterau/effect-ext/Langtag";

LanguageRange.filterBasic(["de-CH", "en"], ["en-US", "de", "de-CH-1996"]); // ["de-CH-1996", "en-US"]
LanguageRange.filterExtended(["*-CH"], ["de-CH", "fr-CH", "de-DE"]); // ["de-CH", "fr-CH"]
LanguageRange.lookup(["de-CH-1996", "fr"], ["fr-FR", "de"]); // Some("de")
```

- `matchesBasic` / `filterBasic` — RFC 4647 §3.3.1: a range matches a tag equal to it or starting with it and a `-`; `*` matches everything.
- `matchesExtended` / `filterExtended` — §3.3.2: subtags match in order, skipping tag subtags (never past a singleton), `*` matching any subtag.
- `lookup` / `fallbacks` — §3.4: each range, truncated from the end (`de-CH-1996` → `de-CH` → `de`), against the available tags; `None` for the caller's default. Lookup truncates the _range_: `de` does not select an available `de-DE`.
- `isBasic`, `isExtended` — range syntax.

Every function compares case-insensitively and returns the caller's own values.

### `AcceptLanguage` and `negotiateLanguage`

```ts
import { AcceptLanguage, negotiateLanguage } from "@thomasfosterau/effect-ext/Langtag";

AcceptLanguage.parse("fr-CH, fr;q=0.9, en;q=0.8"); // [{ range: "fr-CH", quality: 1 }, …]
negotiateLanguage(["en", "de", "fr"], request.headers.get("accept-language") ?? undefined);
```

- `AcceptLanguage.parse(header)` — `{ range, quality }` entries, highest quality first, ties in header order. Bad ranges are dropped; a malformed `q` reads as `1`; `q=0` entries are kept.
- `negotiateLanguage(available, header)` — lookup over the positive-quality ranges in order, never choosing a tag a `q=0` range matches; `*` takes the first remaining available tag. `None` when nothing is acceptable.

## Css

CSS for [Effect](https://effect.website): the [CSS Syntax Level 3](https://www.w3.org/TR/css-syntax-3/) tokenizer and parser (a `style` attribute's declarations, stylesheets, rules, component values) with error recovery, typed [CSS Color 4](https://www.w3.org/TR/css-color-4/) colours with conversion to sRGB, and [CSS Values 4](https://www.w3.org/TR/css-values-4/) lengths. Checked against the [css-parsing-tests](https://github.com/SimonSapin/css-parsing-tests) suite.

```sh
pnpm add @thomasfosterau/effect-ext/Css effect
```

```ts
import * as Option from "effect/Option";
import { Color, Length, Syntax } from "@thomasfosterau/effect-ext/Css";

for (const item of Syntax.parseDeclarationList(
  "color: oklch(70% 0.1 200); margin-left: 12pt !important",
)) {
  if (item._tag !== "Declaration") continue; // a SyntaxError: { kind, offset }
  const [value] = item.value.filter((component) => component._tag !== "Whitespace");
  if (value === undefined) continue;
  if (item.name === "color") Color.parse(value).pipe(Option.flatMap(Color.toSrgb)); // Option.some({ red, green, blue, alpha })
  if (item.name === "margin-left") Length.parse(value).pipe(Option.flatMap(Length.toPixels)); // Option.some(16)
}
```

### `Syntax`

| Export | Specification entry point |
| --- | --- |
| `parseDeclarationList(css)` | Parse a list of declarations (a `style` attribute): `Declaration`s and `AtRule`s, with `SyntaxError` items for what was skipped. |
| `parseStylesheet(css)`, `parseRuleList(css)` | A stylesheet (CDO / CDC skipped at the top level) or a list of rules: `QualifiedRule`s and `AtRule`s, block contents as component values. |
| `parseRule(css)`, `parseDeclaration(css)`, `parseComponentValue(css)` | Exactly one, or a `SyntaxError` (`empty`, `invalid`, `extra-input`). |
| `parseBlockContents(css)` | A block's contents with CSS nesting (the editor's draft's "parse a block's contents"): `Declaration`s, `AtRule`s and nested `QualifiedRule`s in order; something like `a:hover {…}` that is not a declaration is a rule. |
| `parseComponentValueList(css)` | The input as component values: tokens, `Func`s and `Block`s. |

A `SyntaxError` carries `offset`, the code-point offset in the preprocessed input (CRLF counted as one). The token and component-value types are in `Token`.

The parsers take text, not bytes. To parse a stylesheet fetched as bytes, decode it first, for example with [`@thomasfosterau/effect-ext/Encoding`](https://www.npmjs.com/package/@thomasfosterau/effect-ext/Encoding). Pass it the encoding Syntax 3 §3.2 would pick: the protocol's `charset`, then an `@charset` rule, then the referring document's encoding, then UTF-8. A byte-order mark overrides that encoding, which is the decoder's default BOM sniff.

```ts
import * as Effect from "effect/Effect";
import { Encoding } from "@thomasfosterau/effect-ext/Encoding";
import { Syntax } from "@thomasfosterau/effect-ext/Css";

const bytes = new Uint8Array([
  0x70, 0x20, 0x7b, 0x20, 0x63, 0x6f, 0x6c, 0x6f, 0x72, 0x3a, 0x20, 0x72, 0x65, 0x64, 0x20, 0x7d,
]);
const rules = await Effect.runPromise(
  Effect.map(Encoding.decode(bytes, { encoding: "UTF-8" }), Syntax.parseStylesheet),
);
```

### `AnPlusB`

`AnPlusB.parse(cssOrComponentValues)` reads the `An+B` microsyntax (Syntax 3 §6) of `:nth-child()` and its relatives into `[a, b]`: `odd`, `even`, an integer, or `An` with an optional `+ B` / `- B` (`2n+1`, `-n + 3`, `+N-2`), case-insensitive, whitespace allowed around the sign but not inside `+n` or a number.

### `Color`

`Color.parse(cssOrComponentValue)` takes named colours, `transparent`, `currentcolor`, hex (3, 4, 6, 8 digits), `rgb()` / `rgba()` / `hsl()` / `hsla()` in both comma and space syntaxes, `hwb()`, `lab()`, `lch()`, `oklab()`, `oklch()` and `color()` in the predefined spaces (`srgb`, `srgb-linear`, `display-p3`, `display-p3-linear`, `a98-rgb`, `prophoto-rgb`, `rec2020`, `xyz`, `xyz-d50`, `xyz-d65`), with `none` and angle units. The result is a tagged `Color` (a named colour is `Named`, keeping its name; `hsl()` and `hwb()` keep their own channels, `none` included, as `Hsl` and `Hwb`); `Color.serialize` prints its specified value as today's CSS Color 4 does: a named colour as its name, hex, `rgb()`, `hsl()` and `hwb()` as `rgb()` / `rgba()` with integer channels, except that a `none` channel stays (`rgb()` as `color(srgb …)`, `hsl()` and `hwb()` as themselves), and `lab()`-family lightness clamped, and `Color.toSrgb` converts it to sRGB (0 to 1, not gamut-mapped). From [CSS Color 5](https://www.w3.org/TR/css-color-5/): `device-cmyk()` (space and legacy comma syntaxes, channels clamped to [0, 1], serialised as `color(device-cmyk …)`, converted to sRGB naively), `color()` in a custom `--name` space (channels kept as written, no sRGB without its `@color-profile`) `light-dark()` (both colours kept; no sRGB, since which applies depends on the used colour scheme) and `color-mix()` (an optional `in <space> [<method> hue]`, `oklab` by default, then one or more colours with optional percentages from 0% to 100%; kept as written and serialised as its specified value, with the default method left out and the percentages filled in, or left out when all equal and summing to 100%). `Color.resolve` computes a mix (CSS Color 5 §3.2): each colour converted to the interpolation space, a missing component carried forward to its analogue and an achromatic colour's hue treated as missing, then interpolated with premultiplied alpha and the hue method, two colours at a time, with alpha scaled when the percentages sum to under 100%. The result is in the interpolation space (`color(srgb …)` for `srgb`, `hsl` and `hwb`), and `toSrgb` goes through it). Web-platform-tests' `css/css-color/parsing` vectors run in `tests/color-valid.test.ts`, `tests/color-invalid.test.ts` and `tests/color-mix.test.ts`. Every one passes except those that use `calc()` or `var()`.

### `Length`

`Length.parse` takes a dimension in a length unit (absolute `px cm mm q in pt pc`, and the font- and viewport-relative ones), a percentage, or a unitless `0`; `toPixels` and `convert` handle the absolute units (1in = 96px = 72pt), `serialize` prints it back. `parse` also takes a `calc()` that simplifies to one unit (`calc(1in + 10px)` is `106px`); `parseSum` returns any `calc()` of lengths and percentages simplified to one term per unit (CSS Values 4 §10: `+` and `-` with whitespace around them, `*` by a number, `/` by a non-zero number, nested parentheses), with the absolute units folded into `px`, and `serializeSum` writes it back (`calc(50% - 1em)`).

### `Shorthand`

`Shorthand.expand(declaration)` expands a box shorthand into its longhands, keeping `!important`: `margin`, `padding` and `inset` by the 1 to 4 values rule, `border-width` / `-style` / `-color` likewise, and `border` / `border-top` (and the other sides) into each side's `-width`, `-style` and `-color`, in any order, with an omitted part at its initial value (`medium`, `none`, `currentcolor`). A CSS-wide keyword goes to every longhand. `None` for an invalid value or one holding `var()`. `Shorthand.isShorthand(name)` says whether a property is one of these.

### `Font`

`Font.parse` reads the `font` shorthand (CSS Fonts 4 §2.8): optional style (an oblique angle included), `small-caps`, weight and width keywords in any order, each at most once and `normal` standing for any of them, then the size, an optional `/ line-height` and the family list; or a system font keyword (`caption`, `menu`, …) alone. What it leaves out takes its initial value. `parseFamily`, `parseWeight` (`normal` is 400, `bold` 700, or 1 to 1000, `bolder`, `lighter`), `parseStyle`, `parseSize` and `parseLineHeight` read the longhands. A family name made of identifiers may not start with a generic or CSS-wide keyword; quote it.

```ts
import * as Option from "effect/Option";
import { Font } from "@thomasfosterau/effect-ext/Css";

const font = Font.parse('italic bold 12px/1.5 "Fira Sans", serif');
// Option.some({ _tag: "Font", style: { _tag: "Italic" }, weight: 700, lineHeight: { _tag: "Number", value: 1.5 }, … })
```

### `Text`

`Text.parseAlign` (`text-align`), `parseVerticalAlign` (a keyword, or a length or percentage), and `text-decoration`: `parseDecoration` reads the shorthand (a line, a style, a colour and a thickness, each at most once and in any order, with `currentcolor` as `None`), and `parseDecorationLine`, `parseDecorationStyle` and `parseDecorationThickness` the longhands.

### `Serialize`

Writes parsed CSS back as text. `identifier`, `string` and `url` follow CSSOM's rules (`Serialize.identifier("1st")` is `\31 st`); `componentValues` follows CSS Syntax 3 §9, keeping each number's written form and putting `/**/` between two tokens that would otherwise tokenize as one; `declaration` and `declarationList` write a `style` attribute the way CSSOM does (`color: red; margin: 0 auto !important;`). Parsing the output gives back the same component values, less comments and whitespace runs; the round trip is tested over every css-parsing-tests input.

```ts
import { Serialize, Syntax } from "@thomasfosterau/effect-ext/Css";

Serialize.declarationList(Syntax.parseDeclarationList("color:red;;margin : 0 auto"));
// "color: red; margin: 0 auto;"
```

### Not yet

The other math functions (`min()`, `max()`, `clamp()`, …).

## Encoding

The [WHATWG Encoding Standard](https://encoding.spec.whatwg.org/) on [Effect](https://effect.website): resolve an encoding label, sniff a byte-order mark, decode bytes or a byte stream, and encode text to UTF-8 or a legacy single-byte encoding. Both directions are fatal by default: malformed input fails with a typed `DecodeError` that says which byte went wrong, and an unmappable character with an `EncodeError` that says which character, never a silent U+FFFD or `?`.

```sh
pnpm add @thomasfosterau/effect-ext/Encoding effect
```

```ts
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { Encoding } from "@thomasfosterau/effect-ext/Encoding";

const encoding = Option.getOrElse(Encoding.getEncoding("latin1"), () => "UTF-8" as const); // "windows-1252"
const text = await Effect.runPromise(
  Encoding.decode(new Uint8Array([0x63, 0x61, 0x66, 0xe9]), { encoding }),
); // "café"

const decoded = Stream.make(new Uint8Array([0xe2, 0x82]), new Uint8Array([0xac])).pipe(
  Encoding.decodeStream(),
  Stream.runCollect,
); // ["€"]

const csv = await Effect.runPromise(Encoding.encode("Café;5 €", { encoding: "windows-1252" })); // Uint8Array [0x43, 0x61, 0x66, 0xe9, …]
```

### API

| Export | What it does |
| --- | --- |
| `ENCODING_NAMES`, `EncodingName` | The standard's 40 encodings (`UTF-8`, `windows-1252`, `Shift_JIS`, …), as a literal union. |
| `getEncoding(label)` | A label to its encoding (§4.2): ASCII whitespace trimmed, ASCII case-insensitive, against the standard's 228 labels. `Option.none()` for an unknown label. |
| `sniffBom(bytes)` | The BOM sniff (§6): `Option<{ encoding: "UTF-8" \| "UTF-16LE" \| "UTF-16BE", length }>`, a standalone step for hosts that layer their own detection on top (XML Appendix F, HTML `<meta charset>`). |
| `decode(bytes, options?)` | Bytes to a string. `Effect<string, DecodeError \| UnsupportedEncodingError>`. |
| `decodeStream(stream, options?)` / `stream.pipe(decodeStream(options?))` | A `Stream<Uint8Array>` to a `Stream<string>`, with sequences split across chunks handled. Offsets count from the start of the stream. |
| `isSupported(encoding, tables?)` | Whether this runtime (or the given tables) can decode the encoding. |
| `DecodeError` | `{ encoding, offset, message }`: the byte offset the error was detected at (the input's length for a sequence cut short by the end of input). |
| `encode(text, options?)` | Text to bytes (§4.3). `Effect<Uint8Array, EncodeError \| UnsupportedEncodingError>`. A lone surrogate is encoded as U+FFFD. |
| `encodeStream(stream, options?)` / `stream.pipe(encodeStream(options?))` | A `Stream<string>` to a `Stream<Uint8Array>`, with surrogate pairs split across chunks handled. Offsets count from the start of the stream. |
| `canEncode(encoding, tables?)` | Whether there is an encoder: UTF-8, every single-byte encoding and `x-user-defined`, and a CJK encoding when `tables` hold its index. |
| `tablesLayer(...tables)`, `EncodingTables`, `Tables` | Provide the CJK indexes from the opt-in entries (`EncodingJapanese`, `EncodingGb18030`, `EncodingBig5`, `EncodingEucKr`) to `encode` / `decode` and their stream forms. |
| `getOutputEncoding(encoding)` | §4.3's "get an output encoding": `replacement`, `UTF-16BE` and `UTF-16LE` (which have no encoder) become `UTF-8`. |
| `EncodeError` | `{ encoding, offset, codePoint, message }`: the unmappable code point and its UTF-16 code-unit offset (a string index). |
| `UnsupportedEncodingError` | `{ encoding, message }`: the runtime's `TextDecoder` lacks the encoding and no table for it is bundled, or there is no encoder for it. |

`DecodeOptions`:

- `encoding` — defaults to `UTF-8`.
- `fatal` — defaults to `true`; `false` decodes malformed input to U+FFFD.
- `bomHandling` — `"sniff"` (default: the standard's "decode", where a BOM overrides `encoding` and is removed), `"strip"` (the requested encoding stands, its own BOM removed) or `"keep"` (a BOM decodes as U+FEFF).

`EncodeOptions`:

- `encoding` — defaults to `UTF-8`.
- `errorMode` — `"fatal"` (default) fails on an unmappable code point; `"html"` writes `&#N;`, as an HTML form does (which silently loses the difference from text that already read `&#N;`).

### Runtime support

The single-byte encodings and `x-user-defined` are decoded and encoded from the standard's indexes, bundled here (about 25 KB of source), whatever the runtime has: some runtimes ship a `TextDecoder` without the legacy encodings (small-ICU Node builds, some edge runtimes), full-ICU Node lacks `ISO-8859-16` and `x-user-defined`, and Node's ICU decodes `IBM866`, `KOI8-U`, `windows-874`, `windows-1253` and `windows-1255` differently from the standard. UTF-8, UTF-16 and the CJK encodings are decoded with the runtime's `TextDecoder`; a CJK encoding it lacks fails with `UnsupportedEncodingError` (check with `isSupported` first if you need to choose).

The CJK encodings (Shift_JIS, EUC-JP, ISO-2022-JP, GBK / gb18030, Big5, EUC-KR) encode, and decode by the standard's own algorithms, once their indexes are provided. The indexes are opt-in entries, so a bundle that never meets them never loads them (each is 70 to 95 KB of source):

```ts
import * as Effect from "effect/Effect";
import { Encoding } from "@thomasfosterau/effect-ext/Encoding";
import * as Japanese from "@thomasfosterau/effect-ext/EncodingJapanese"; // Shift_JIS, EUC-JP, ISO-2022-JP
import * as Gb18030 from "@thomasfosterau/effect-ext/EncodingGb18030"; // gb18030, GBK
import * as Big5 from "@thomasfosterau/effect-ext/EncodingBig5";
import * as EucKr from "@thomasfosterau/effect-ext/EncodingEucKr";

const sjis = await Effect.runPromise(
  Encoding.encode("日本語", { encoding: "Shift_JIS" }).pipe(
    Effect.provide(Encoding.tablesLayer(Japanese.tables)),
  ),
);
```

Without them, a CJK encoding decodes through the runtime's `TextDecoder` (a small-ICU runtime lacks it: `UnsupportedEncodingError`) and does not encode (`UnsupportedEncodingError`).

## Mime

MIME types for [Effect](https://effect.website), after the [WHATWG MIME Sniffing](https://mimesniff.spec.whatwg.org/) and [Fetch](https://fetch.spec.whatwg.org/#data-urls) standards: parse and serialise `type/subtype;name=value`, decide what a resource is from its leading bytes, map file extensions, and process `data:` URLs. Checked against the web-platform-tests vectors for MIME type parsing and `data:` URLs, and against the `mimesniff/` media and sniffing resources.

```sh
pnpm add @thomasfosterau/effect-ext/Mime effect
```

```ts
import * as Option from "effect/Option";
import { DataUrl, Extension, MimeType, Sniff } from "@thomasfosterau/effect-ext/Mime";

MimeType.parse('Text/HTML; Charset="utf-8"').pipe(Option.map(MimeType.serialize)); // Option.some("text/html;charset=utf-8")

const bytes = new TextEncoder().encode("%PDF-1.7\n");
MimeType.essence(Sniff.sniff(bytes)); // "application/pdf"

Extension.mimeTypeFor("Report.DOCX"); // Option.some("application/vnd.openxmlformats-officedocument.wordprocessingml.document")

DataUrl.process("data:,Hello%2C%20World").pipe(
  Option.map(({ body }) => new TextDecoder().decode(body)),
); // Option.some("Hello, World")
```

### `MimeType`

| Export | What it does |
| --- | --- |
| `parse(string)` | §4.4: `Option<MimeType>`, `None` without a valid `type/subtype`. Type, subtype and parameter names lower-cased; parameters ordered, first value of a repeated name wins; a malformed parameter skipped. |
| `serialize(mimeType)` | §4.5: `type/subtype;name=value`, quoting a value that is empty or not a token. |
| `essence`, `parameter(mimeType, name)`, `isXml` | `type/subtype`; a parameter by case-insensitive name; whether it is an XML MIME type (`+xml`, `text/xml`, `application/xml`). |
| `MimeType`, `MimeTypeFromString` | The record's `Schema` (`{ type, subtype, parameters: ReadonlyArray<[name, value]> }`) and the string codec (decode by `parse`, encode by `serialize`). |

### `Sniff`

| Export | What it does |
| --- | --- |
| `sniff(bytes, { supplied?, noSniff?, scriptable? = true, signatures?, checkForApacheBug? = false })` | §7's computed MIME type, from the first 1445 bytes: an unknown type is identified (HTML / XML / PDF while `scriptable`, PostScript, BOM-led text, images, audio and video, archives, your `signatures`, then text or binary; your `signatures` also refine a generic `application/zip` match; HTML / XML / PDF are not detected under `noSniff`); a supplied image, audio or video type (`application/ogg` included) is corrected from the bytes; under `checkForApacheBug`, a supplied type that is byte-for-byte one of old Apache's `text/plain` values becomes `text/plain` or `application/octet-stream` from the bytes, never a scriptable type (set it when `supplied` is an HTTP `Content-Type`); anything else (or `noSniff`) keeps the supplied type, and a supplied `text/html` is never sniffed as a feed (the specification dropped those rules). |
| `matchImage`, `matchAudioOrVideo`, `matchFont`, `matchArchive` | The §6 pattern matchers, each a `Signature`: `(bytes) => Option<string>`. Audio / video includes the MP4, WebM and MP3-without-ID3 (two consecutive Layer III frames) signatures. |
| `Signature` | Your own detector: register OOXML / ODF (zip inspection), CFB, RTF and the like through `signatures`: tried over a generic `application/zip` match and after every other standard pattern. |

### `Extension`

`DEFAULT_EXTENSIONS` is a curated table of web formats, images, audio and video, fonts, documents (PDF, RTF, EPUB, OOXML, ODF) and archives, not a mime-db copy. `mimeTypeFor(nameOrExtension, table?)`, `extensionFor(mimeType, table?)` (the preferred extension: `jpg` for `image/jpeg`) and `extend(entries, base?)` for custom entries.

### `DataUrl`

`process(url)` is Fetch's `data:` URL processor: `Option<{ mimeType, body: Uint8Array }>`, percent-decoding the body or forgiving-base64-decoding it under `;base64`, with `text/plain;charset=US-ASCII` for a missing or malformed type. `forgivingBase64Decode` is exported on its own.
