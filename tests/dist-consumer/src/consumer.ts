/**
 * @copyright Thomas Foster
 *
 * A consumer of the EMITTED declarations (`packages/effect-ext/dist`),
 * resolved through the package's `exports` exactly as an npm install would.
 * Every `Equals<…>` assertion fails if a declaration degrades on emit — a
 * brand that emits as `string`, a codec whose `Type` emits as `unknown`, a
 * reader whose signature emits as `any` (an unresolved name in a `.d.ts` is
 * the error type under `skipLibCheck`). Type-checked by `vp run check`; never
 * executed.
 *
 * @module dist-consumer
 */

import * as Option from "effect/Option";
import type * as Schema from "effect/Schema";
import type * as SchemaIssue from "effect/SchemaIssue";
import type * as Effect from "effect/Effect";
import {
  Allocator,
  Ast,
  Bounded,
  BufferStruct,
  Ids,
  Issues,
  Layout,
  LiteralExact,
  OptionalKey,
  Str,
  String,
  StructOfArrays,
  TriState,
  Url,
  Vec,
} from "@thomasfosterau/effect-ext";
import * as VecEntry from "@thomasfosterau/effect-ext/Vec";
import * as TriStateEntry from "@thomasfosterau/effect-ext/TriState";
import * as BoundedEntry from "@thomasfosterau/effect-ext/Bounded";
import { Langtag, Mime, Sitemap, UriTemplate, Web } from "@thomasfosterau/effect-ext";
import * as Robots from "@thomasfosterau/effect-ext/Robots";
import * as Browser from "@thomasfosterau/effect-ext/Browser";
import * as Negotiate from "@thomasfosterau/effect-ext/Negotiate";
import { Ratio, U8, U64 } from "@thomasfosterau/effect-ext";
import { I8 } from "@thomasfosterau/effect-ext/I8";
import * as Rfc3339 from "@thomasfosterau/effect-ext/Rfc3339";
import * as CronExpression from "@thomasfosterau/effect-ext/CronExpression";
import type * as Cron from "effect/Cron";
import type * as DateTime from "effect/DateTime";

type Assert<T extends true> = T;
type Equals<A, B> =
  (<X>() => X extends A ? 1 : 2) extends <X>() => X extends B ? 1 : 2 ? true : false;
type Not<T extends boolean> = T extends true ? false : true;
type IsAny<T> = 0 extends 1 & T ? true : false;

// ── Ids ────────────────────────────────────────────────────────────────
const PersonId = Ids.make("PersonId");
const AgentPersonId = Ids.refine(Ids.make("AgentId"), "PersonId");
type PersonId = typeof PersonId.Type;

declare const raw: string;
// @ts-expect-error -- the brand survives declaration emit
export const rawAsPerson: PersonId = raw;

// ── Langtag (merged in from effect-web) ─────────────────────────────────
type LanguageTag = Langtag.LanguageTag.LanguageTag;
// @ts-expect-error -- the LanguageTag brand survives declaration emit
export const rawAsTag: LanguageTag = raw;

// ── Numeric (merged in from effect-numeric) ────────────────────────────
declare const rawNumber: number;
// @ts-expect-error -- the U8 brand survives declaration emit
export const rawAsU8: U8 = rawNumber;
// @ts-expect-error -- a U8 is not an I8 after emit
export const u8AsI8: I8 = U8.make(1);

// ── TriState ───────────────────────────────────────────────────────────
const summary = TriState.clearable(Ids.Slug);
const Update = { summary, birthPlaceId: TriState.clearableNullOr(PersonId) };

// ── Bounded ────────────────────────────────────────────────────────────
const pagination = Bounded.pagination({ maxLimit: 100 });
const strictPagination = Bounded.requiredPagination({ maxLimit: 100 });
// @ts-expect-error -- `maxLimit` stays required through declaration emit
export const uncapped = Bounded.pagination({});
// @ts-expect-error -- the Option guard survives declaration emit
export const misread = TriState.readNullOr(Option.none<string>());

// ── LiteralExact ───────────────────────────────────────────────────────
const statuses = LiteralExact.tuple<"a" | "b">()(["a", "b"]);
// @ts-expect-error -- the exhaustiveness check survives declaration emit
export const partial = LiteralExact.tuple<"a" | "b">()(["a"]);

type NullOrFieldsOfA = ReturnType<
  typeof TriState.toNullOrFields<{ readonly a: Option.Option<string> }>
>;

// ── Layout, Vec, StructOfArrays, BufferStruct ─────────────────────────
const Point = Layout.struct({ x: Layout.i32, y: Layout.f64, alive: Layout.bool });
type Point = Layout.Type<typeof Point>;
type MakeVec = ReturnType<typeof Vec.make<typeof Layout.u16>>;
type MakeSoa = ReturnType<typeof StructOfArrays.make<typeof Point.fields>>;

// ── Str, String ────────────────────────────────────────────────────────
type SplitOnce = ReturnType<typeof Str.splitOnce>;

// ── Url ────────────────────────────────────────────────────────────────
const ApiUrl = Url.schema({ scheme: "https", hostname: "api.example.com" });
// @ts-expect-error -- a plain string is not a branded Url after emit
export const plainUrl: Url.Url<{ readonly scheme: "https" }> = raw;

const nicknameKey = OptionalKey.optionalKey(
  "nickname",
  Option.getOrUndefined(Option.some("Countess")),
);
const parentKey = OptionalKey.fromOption("parent", Option.none<number>());
/** `number`, or absent as `undefined` (spelled without writing the union). */
type MaybeNumber = ReturnType<typeof Option.getOrUndefined<number>>;
const forwarded = OptionalKey.fields({ limit: Option.getOrUndefined(Option.some(1)), tag: "x" });

export type Checks = [
  // OptionalKey
  Assert<Equals<typeof nicknameKey, { readonly nickname?: string }>>,
  Assert<Equals<typeof parentKey, { readonly parent?: number }>>,
  Assert<Equals<typeof forwarded, OptionalKey.Defined<{ limit: MaybeNumber; tag: string }>>>,
  // Ids
  Assert<Not<Equals<PersonId, string>>>,
  Assert<Equals<typeof PersonId.Encoded, string>>,
  Assert<Not<Equals<typeof AgentPersonId.Type, string>>>,
  Assert<Equals<typeof Ids.Uuid.Type, string>>,
  Assert<Equals<ReturnType<typeof Ids.slug>, Schema.String>>,
  // TriState
  Assert<Equals<typeof summary, Schema.optionalKey<Schema.OptionFromNullOr<Schema.String>>>>,
  // The nullable encoding's decoded type is exactly `PersonId`, `null` and
  // `undefined`, asserted part by part so no `| null` union is written here.
  Assert<Equals<NonNullable<typeof Update.birthPlaceId.Type>, PersonId>>,
  Assert<Equals<Extract<typeof Update.birthPlaceId.Type, null>, null>>,
  Assert<Equals<Extract<typeof Update.birthPlaceId.Type, undefined>, undefined>>,
  Assert<Equals<ReturnType<typeof TriState.suppliedValue<number>>, Option.Option<number>>>,
  Assert<Equals<ReturnType<typeof TriState.read<number>>, TriState.TriState<number>>>,
  Assert<Equals<NonNullable<ReturnType<typeof TriState.toNullOr<number>>>, number>>,
  Assert<Equals<Extract<ReturnType<typeof TriState.toNullOr<number>>, null>, null>>,
  Assert<Equals<Extract<ReturnType<typeof TriState.toNullOr<number>>, undefined>, undefined>>,
  Assert<Equals<typeof TriStateEntry.suppliedValue, typeof TriState.suppliedValue>>,
  // Bounded
  Assert<Equals<typeof Bounded.IdList.Type, ReadonlyArray<string>>>,
  Assert<Equals<typeof Bounded.IdList.Encoded, string | ReadonlyArray<string>>>,
  Assert<Equals<typeof pagination.limit.Type, number>>,
  Assert<Equals<typeof BoundedEntry.PageOffset, typeof Bounded.PageOffset>>,
  Assert<Equals<typeof strictPagination, Bounded.RequiredPagination>>,
  Assert<Equals<NonNullable<Bounded.IdListOptions["maxLength"]>, Option.Option<number>>>,
  // The page window is built on `Schema.Finite` (#75), and says so on emit.
  Assert<Equals<typeof Bounded.PageOffset, Schema.Finite>>,
  Assert<Equals<ReturnType<typeof Bounded.pageLimit>, Schema.Finite>>,
  Assert<Equals<typeof strictPagination.limit, Schema.Finite>>,
  Assert<Equals<keyof NullOrFieldsOfA, "a">>,
  Assert<Equals<NonNullable<NullOrFieldsOfA["a"]>, string>>,
  Assert<Equals<Extract<NullOrFieldsOfA["a"], null>, null>>,
  Assert<Equals<Extract<NullOrFieldsOfA["a"], undefined>, never>>,
  // Issues
  Assert<Equals<Parameters<typeof Issues.leaves>[0], SchemaIssue.Issue>>,
  Assert<Equals<ReturnType<typeof Issues.pathToJsonPointer>, string>>,
  Assert<Equals<Issues.PointedIssue["pointer"], string>>,
  Assert<Equals<Issues.Leaf["describedBy"], Option.Option<SchemaIssue.Filter>>>,
  Assert<Equals<ReturnType<typeof Issues.message>, string>>,
  // LiteralExact
  Assert<Equals<typeof statuses, readonly ["a", "b"]>>,
  // Ast
  Assert<Equals<ReturnType<typeof Ast.fieldTraits>, ReadonlyArray<Ast.FieldTraits>>>,
  // Layout
  Assert<Equals<Layout.Type<typeof Layout.u8>, number>>,
  Assert<Equals<Layout.Type<typeof Layout.u64>, bigint>>,
  Assert<Equals<Layout.Type<typeof Layout.bool>, boolean>>,
  Assert<Equals<Point, { x: number; y: number; alive: boolean }>>,
  Assert<Equals<Layout.Type<ReturnType<typeof Layout.array<typeof Layout.u8, 4>>>, Array<number>>>,
  // Vec
  Assert<Equals<Effect.Success<MakeVec>, Vec.Vec<number, typeof Layout.u16>>>,
  Assert<Equals<Effect.Error<MakeVec>, Allocator.AllocationError>>,
  Assert<Equals<Vec.Element<Effect.Success<MakeVec>>, number>>,
  Assert<Equals<typeof VecEntry.push, typeof Vec.push>>,
  // StructOfArrays
  Assert<Equals<Effect.Success<MakeSoa>, StructOfArrays.StructOfArrays<typeof Point.fields>>>,
  // BufferStruct
  Assert<Equals<BufferStruct.FieldType<typeof Layout.f32>, number>>,
  // Allocator
  Assert<Equals<Effect.Error<ReturnType<typeof Allocator.allocate>>, Allocator.AllocationError>>,
  Assert<Equals<Allocator.AllocationError["_tag"], "AllocationError">>,
  // Str
  Assert<Equals<ReturnType<typeof Str.len>, number>>,
  Assert<Equals<SplitOnce, Option.Option<readonly [Str.Str, Str.Str]>>>,
  Assert<Equals<Str.Utf8Error["_tag"], "Utf8Error">>,
  // String
  Assert<Equals<ReturnType<typeof String.make>, Effect.Effect<String.String>>>,
  Assert<Equals<Effect.Error<ReturnType<typeof String.from>>, Allocator.AllocationError>>,
  // Url
  Assert<
    Equals<
      typeof ApiUrl.Type,
      Url.Url<{ readonly scheme: "https"; readonly hostname: "api.example.com" }>
    >
  >,
  Assert<Equals<typeof ApiUrl.Encoded, string>>,
  // Nothing degraded to `any`
  Assert<Not<IsAny<typeof Url.resolve>>>,
  Assert<Not<IsAny<typeof Vec.push>>>,
  Assert<Not<IsAny<typeof StructOfArrays.column>>>,
  Assert<Not<IsAny<typeof BufferStruct.make>>>,
  Assert<Not<IsAny<typeof Str.split>>>,
  Assert<Not<IsAny<typeof String.pushStr>>>,
  Assert<Not<IsAny<Allocator.Allocator>>>,
  Assert<Not<IsAny<typeof TriState.read>>>,
  Assert<Not<IsAny<typeof Issues.pointers>>>,
  Assert<Not<IsAny<typeof Bounded.idList>>>,
  // The modules merged in from effect-web, through the barrel and subpaths
  Assert<Not<IsAny<LanguageTag>>>,
  Assert<Equals<ReturnType<typeof Langtag.LanguageTag.parse>, Option.Option<LanguageTag>>>,
  Assert<Not<IsAny<typeof Mime.MimeType.parse>>>,
  Assert<Not<IsAny<typeof UriTemplate.UriTemplate.expand>>>,
  Assert<Not<IsAny<typeof Web.appendVary>>>,
  Assert<Not<IsAny<typeof Sitemap.renderSitemap>>>,
  Assert<Not<IsAny<typeof Robots.isAllowed>>>,
  Assert<Not<IsAny<typeof Browser.Locks.withLock>>>,
  Assert<Not<IsAny<typeof Negotiate.negotiateRepresentation>>>,
  Assert<Equals<ReturnType<typeof Negotiate.negotiateRepresentation>, Negotiate.Negotiation>>,
  Assert<
    Equals<
      Negotiate.Negotiation["_tag"],
      "Selected" | "Fallback" | "NotAcceptable" | "UnsupportedMediaType"
    >
  >,
  // The modules merged in from effect-numeric and effect-time
  Assert<Not<IsAny<U8>>>,
  Assert<Equals<ReturnType<typeof U8.make>, U8>>,
  Assert<Equals<ReturnType<typeof U64.make>, U64>>,
  Assert<Not<Equals<U64, bigint>>>,
  Assert<Equals<ReturnType<typeof U8.checkedAdd>, Option.Option<U8>>>,
  Assert<Equals<ReturnType<typeof Ratio.make>, Ratio.Ratio>>,
  Assert<Equals<Effect.Success<ReturnType<typeof Rfc3339.parse>>, DateTime.DateTime>>,
  Assert<Equals<Effect.Success<ReturnType<typeof CronExpression.parse>>, Cron.Cron>>,
];
