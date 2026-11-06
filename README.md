# effect-ext

Experimental extensions to [Effect](https://effect.website), in two families of packages:

- **[`@thomasfosterau/effect-ext`](packages/effect-ext/README.md)** — extensions to the Effect standard library.
  - **Binary data** — an `Allocator` service handing out `ArrayBuffer` blocks, binary `Layout`s with C-like alignment, `BufferStruct`s, a growable `Vec`, a `StructOfArrays` container, and Rust-style UTF-8 `String` / `Str` with byte offsets and Rust's method names.
  - **Schema** — partial-update fields that keep "absent" and "cleared" apart, `SchemaIssue` trees rendered as RFC 6901 JSON Pointers, bounded pagination and id-list codecs, branded UUIDs and slugs, exact literal-union tuples, field introspection by decode probe, and URLs whose scheme, host, port, credentials and path are part of their type.
  - **Web platform** — framework-neutral request / response policies, an SSRF-guarded fetch, structured logging and span tracing, content negotiation, service-worker caching strategies, browser APIs as Effect services with in-memory test doubles, robots.txt, sitemaps, RSS / Atom / JSON Feed, URI Templates, BCP 47 language tags, CSS parsing, the WHATWG Encoding Standard and MIME types (formerly `@thomasfosterau/effect-web` and its sibling packages).
  - **Numeric** — Rust-style numeric types: fixed-width integers `I8` … `U128` with strict, checked, wrapping, saturating and overflowing arithmetic, clamped ranges, floats with IEEE 754 total ordering, exact rationals, complex numbers and `num-traits` style type classes (formerly the unpublished `effect-numeric`).
  - **Time** — parsers and printers for RFC 3339 and RFC 9557 date-times, ISO 8601 durations, POSIX TZ strings, cron expressions, RFC 5545 recurrence rules, IANA time zone names and TZif files, producing Effect's own `DateTime` and `Cron` (formerly the unpublished `@thomasfosterau/effect-time`).
- **The `@thomasfosterau/effect-ai-*` family and `effect-evals`** — purely additive extensions to Effect's AI module (`effect/ai`): the service abstractions upstream lacks (reranking, classification, speech, transcription, images, moderation, voice conversion), first-party providers for vendors the Effect org doesn't ship, a Cloudflare AI Gateway routing layer, and an Effect-native evaluation toolkit. Each is written to feel like it belongs in `effect/ai` itself: a `Context.Service` tag per capability, `Layer`-based wiring, every failure an `AiError`, `Effect.withSpan` telemetry.

> **Status:** experimental and pre-1.0. APIs may change between minor versions, so pin what you use. This repository and its packages have been created using Claude Code.

Five repositories were merged into this one before or after their packages were first published, and comments ported from them cite their trackers: `effect-schema-ext#NN` is `thomasfosterau/effect-schema-ext` (the Schema modules other than `Url`); in the AI packages a bare `#NNN` written before the merge is `thomasfosterau/effect-ai-ext`'s tracker; and in effect-ext's web modules it is `thomasfosterau/effect-web`'s (see [AGENTS.md](AGENTS.md)). The numeric and time modules (from `thomasfosterau/effect-numeric` and `thomasfosterau/effect-time`) cite no tracker of their own.

## Packages

| Package | What it is | Peers |
| --- | --- | --- |
| [`@thomasfosterau/effect-ext`](packages/effect-ext) | Standard-library extensions, one subpath per module: `Allocator`, `Layout`, `BufferStruct`, `Vec`, `StructOfArrays`, `String`, `Str`, `TriState`, `Issues`, `Bounded`, `Ids`, `LiteralExact`, `Ast`, `Url`; `Web`, `Net`, `Observability`, `Negotiate`, `ServiceWorker`, `Browser`, `BrowserTesting`, `Robots`, `Sitemap`, `RssFeed`, `AtomFeed`, `JsonFeed`, `UriTemplate`, `Langtag`, `LangtagRegistry`, `Css`, `Encoding` (and its CJK indexes), `Mime`; `I8` … `I128`, `U8` … `U128`, `FixedInt`, `Wrapping`, `Saturating`, `Checked`, `Overflowing`, `Clamped`, `Float`, `F32`, `Ratio`, `Complex`, `Num`, `Integer`, `Range`, `ArithmeticError`; `Rfc3339`, `Rfc9557`, `IsoDuration`, `PosixTz`, `CronExpression`, `RRule`, `IanaTimeZone`, `Tzif` | `effect`, optional `@effect/platform-browser`, `@thomasfosterau/effect-jsonapi`, `@thomasfosterau/effect-parse` (each for the modules that import it) |
| [`@thomasfosterau/effect-ai-ext`](packages/effect-ai-ext) | Provider-neutral service abstractions: `RerankerModel`, `ClassifierModel`, `SpeechModel`, `TranscriptionModel`, `ImageModel`, `ModerationModel`, `VoiceConversionModel`; one subpath per module | `effect` |
| [`@thomasfosterau/effect-ai-mistral`](packages/effect-ai-mistral) | Mistral provider: `LanguageModel` over chat completions, streaming and tool calls | `effect` |
| [`@thomasfosterau/effect-ai-cohere`](packages/effect-ai-cohere) | Cohere provider: embed, rerank, classify, chat | `effect` |
| [`@thomasfosterau/effect-ai-voyage`](packages/effect-ai-voyage) | Voyage AI provider: embed, rerank | `effect` |
| [`@thomasfosterau/effect-ai-elevenlabs`](packages/effect-ai-elevenlabs) | ElevenLabs provider: text-to-speech, speech-to-text, voice conversion | `effect` |
| [`@thomasfosterau/effect-ai-gateway`](packages/effect-ai-gateway) | Routes `@effect/ai-anthropic` and gateway-native Cohere / OpenAI moderation through a Cloudflare AI Gateway (Worker binding or public HTTPS endpoint), bring-your-own-key | `effect`, `@effect/ai-anthropic`, optional `@cloudflare/workers-types` |
| [`@thomasfosterau/effect-evals`](packages/effect-evals) | LLM evaluation toolkit: datasets, scorers, thresholds, G-Eval and RAG metrics, a caching runner, and the `effect-evals` CLI | `effect`, optional `@effect/platform-node` (CLI only) |

Each package's README is its API reference, and each published package's `CHANGELOG.md` is written by Changesets. Every package is ESM with declarations and `"sideEffects": false`.

## Install

Install the packages you need next to `effect`, which must be a single copy in your dependency tree (two copies break `Context`, `Layer` and `Schema` identity):

```sh
pnpm add effect @thomasfosterau/effect-ext
pnpm add effect @thomasfosterau/effect-ai-ext @thomasfosterau/effect-ai-voyage
```

The published peer range is `effect ^4.0.0`. Node 22.18 or later, or any runtime with `fetch` (Cloudflare Workers included) for the AI packages.

## Examples

```ts
import { Effect, Schema } from "effect";
import { Layout, TriState, Vec } from "@thomasfosterau/effect-ext";

// A growable Float64Array-backed vector
const xs = Effect.runSync(Vec.fromIterable(Layout.f64, [1, 2, 3]));
Vec.typedArray(xs); // Float64Array [1, 2, 3], zero-copy

// A partial-update field that tells "leave it alone" from "clear it"
const UpdateNote = Schema.Struct({ id: Schema.String, summary: TriState.clearable(Schema.String) });
const cleared = Schema.decodeUnknownSync(UpdateNote)({ id: "n1", summary: null });
TriState.read(cleared.summary); // { _tag: "Clear" }
```

Rerank documents with Voyage behind the provider-neutral `RerankerModel` service, so the call site never names the vendor:

```ts
import { Config, Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { RerankerModel } from "@thomasfosterau/effect-ai-ext";
import { VoyageClient, VoyageRerankerModel } from "@thomasfosterau/effect-ai-voyage";

const RerankerLive = VoyageRerankerModel.layer({ model: "rerank-2.5" }).pipe(
  Layer.provide(VoyageClient.layerConfig({ apiKey: Config.Redacted("VOYAGE_API_KEY") })),
  Layer.provide(FetchHttpClient.layer),
);

const program = Effect.gen(function* () {
  const reranker = yield* RerankerModel.RerankerModel;
  const { results } = yield* reranker.rerank({
    query: "what is effect?",
    documents: ["a TypeScript library", "a fruit", "a functional effect system"],
    topN: 2,
  });
  return results;
}).pipe(Effect.provide(RerankerLive));
```

Swapping in Cohere (`CohereRerankerModel`) or the gateway's Cohere route changes only the layer. Every provider client takes an `apiUrl` override, which is how a routing layer such as the gateway repoints it at a proxy for BYOK.

## Documentation

- The package READMEs — the API reference, module by module.
- [CONTRIBUTING.md](CONTRIBUTING.md) — setup, hooks and the individual checks.
- [AGENTS.md](AGENTS.md) — repository conventions and the verification gates.
- [PUBLISHING.md](PUBLISHING.md) — the changesets release flow and its one-time setup.
- [SECURITY.md](SECURITY.md) — vulnerability reporting, credentials and the supply-chain posture.
- [Issues](https://github.com/thomasfosterau/effect-ext/issues)

## License

[MIT](LICENSE)
