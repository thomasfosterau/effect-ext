/**
 * Absolute URLs whose components are part of their type. A {@link Url} is a
 * string in WHATWG URL serialisation (what `new URL(input).href` returns),
 * branded with the type of each component it was checked against: a
 * `Url<{ scheme: "https"; hostname: "example.com" }>` can only have been
 * built by a check that its scheme is `https` and its hostname
 * `example.com`.
 *
 * The brand is covariant and per component, so a narrower URL is assignable
 * wherever a wider one is expected — `Url<{ scheme: "https" }>` where a
 * `Url<{ scheme: "http" | "https" }>` is asked for, a URL on
 * `api.example.com` where one in the `example.com` domain is, and every
 * `Url` where a `string` is — while a plain `string`, or a URL on another
 * scheme, is not.
 *
 * Restrictions are written as a {@link Spec}, a value read at runtime and at
 * the type level alike: {@link schema} turns one into a `Schema` that
 * decodes, normalises and checks a string, and {@link FromSpec} names the
 * constraints it guarantees.
 *
 * @example
 * ```ts
 * import * as Schema from "effect/Schema"
 * import * as Url from "@thomasfosterau/effect-ext/Url"
 *
 * const ApiUrl = Url.schema({ scheme: "https", domain: "example.com", credentials: false })
 *
 * const url = Schema.decodeSync(ApiUrl)("HTTPS://API.Example.com/v1")
 * console.log(url, Schema.is(ApiUrl)("https://example.com.evil.test/"))
 * // → https://api.example.com/v1 false
 *
 * // Narrower constraints are assignable to wider ones; a plain string is not.
 * const hostOf = (target: Url.Url<{ scheme: "https" }>) => Url.components(target).hostname
 * console.log(hostOf(url))
 * // → api.example.com
 * ```
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import { dual } from "effect/Function";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import * as SchemaIssue from "effect/SchemaIssue";

/**
 * @since 0.1.0
 * @category type ids
 */
export const TypeId = "~effect-ext/Url" as const;

/**
 * @since 0.1.0
 * @category type ids
 */
export type TypeId = typeof TypeId;

/**
 * The components a {@link Url} can be constrained on, each as the WHATWG URL
 * API serialises it: `scheme` without its `:` (`url.protocol` is
 * `"https:"`, the scheme `"https"`), `hostname` ASCII lower-case (an
 * internationalised name in its `xn--` form, IPv6 in brackets), `port` the
 * empty string for the scheme's default port, `pathname` with its leading
 * `/` for a hierarchical URL.
 *
 * @since 0.1.0
 * @category models
 */
export interface Components {
  readonly scheme: string;
  readonly username: string;
  readonly password: string;
  readonly hostname: string;
  readonly port: string;
  readonly pathname: string;
}

/**
 * The constraints a {@link Url} carries: a type for each component it was
 * checked against, and no entry for the rest. Width and depth subtyping do
 * the work — a record with more entries, or narrower ones, is assignable to
 * one with fewer or wider entries.
 *
 * @since 0.1.0
 * @category models
 */
export type Constraints = Partial<Components>;

/**
 * The phantom half of a {@link Url}: the constraints it was checked against.
 * Never present at runtime; it exists so that the constraints take part in
 * assignability, covariantly (`out`).
 *
 * The record must hold only the constrained components. Routing it through a
 * generic mapped or conditional type that fills the others with `string`
 * breaks subtyping: TypeScript's variance measurement of such an alias is
 * unreliable, and was observed both contravariant and bivariant.
 *
 * @since 0.1.0
 * @category models
 */
export interface Constrained<out C extends Constraints> {
  readonly [TypeId]: C;
}

/**
 * An absolute URL in WHATWG serialisation whose components are known to
 * have the types in `C`. `Url` alone is any valid URL; `Url<{ scheme:
 * "https" }>` one whose scheme is `https`. Built by {@link schema},
 * {@link parse} or {@link resolve}, and narrowed by {@link is}.
 *
 * It is a string, not a `URL` object, because a `URL` is mutable: assigning
 * `url.hostname` would leave its type claiming a host it no longer has. As a
 * string it is also serialisable, comparable with `===` and usable as a key.
 *
 * @since 0.1.0
 * @category models
 */
export type Url<C extends Constraints = Constraints> = string & Constrained<C>;

type OneOrMore<A> = A | Arr.NonEmptyReadonlyArray<A>;

/**
 * A prefix a component must start with, as opposed to a string it must
 * equal.
 *
 * @since 0.1.0
 * @category models
 */
export interface Prefix {
  readonly prefix: string;
}

/**
 * What a restricted URL must satisfy. Every field is optional and every
 * field given must hold; a field given a list accepts any one of its
 * members. Values are in the serialised form {@link Components} describes,
 * which for `scheme`, `hostname` and `domain` is enforced at the type level:
 * a value with an upper-case letter does not compile.
 *
 * - `scheme` — the scheme, without `:` (`"https"`, `["http", "https"]`).
 * - `hostname` — the exact hostname.
 * - `domain` — the hostname is this domain or a subdomain of it, at a label
 *   boundary: `"example.com"` admits `example.com` and `api.example.com`,
 *   never `badexample.com`. An IP-address host matches only exactly.
 * - `port` — the port, `""` meaning the scheme's default.
 * - `pathname` — the exact path, or `{ prefix }` for a path that starts with
 *   it. A prefix is compared as a string: `{ prefix: "/api" }` admits
 *   `/apiary`; end it with `/` to mean a directory.
 * - `credentials` — `false` for a URL with no username and no password.
 *   `true` and absence both leave them unconstrained.
 *
 * The WHATWG parser decides every component, so
 * `https://example.com@evil.test/` has hostname `evil.test` (and username
 * `example.com`), and fails `{ hostname: "example.com" }`.
 *
 * @since 0.1.0
 * @category models
 */
export interface Spec {
  readonly scheme?: OneOrMore<Lowercase<string>>;
  readonly hostname?: OneOrMore<Lowercase<string>>;
  readonly domain?: OneOrMore<Lowercase<string>>;
  readonly port?: OneOrMore<string>;
  readonly pathname?: OneOrMore<string | Prefix>;
  readonly credentials?: boolean;
}

/** The type of a field the spec gives, `never` for one it leaves out (or leaves optional). */
type Field<S, K extends keyof Spec> = S extends { readonly [P in K]: infer V } ? V : never;
type Members<V> = V extends ReadonlyArray<infer E> ? E : V;
type InDomain<D> = D extends string ? D | `${string}.${D}` : never;
type PathMatch<P> = P extends Prefix ? `${P["prefix"]}${string}` : P;
/** `{ K: T }`, or nothing (`unknown`, the identity of `&`) when `T` is `never`. */
type Entry<K extends keyof Components, T> = [T] extends [never]
  ? unknown
  : { readonly [P in K]: T };
type Both<A, B> = [A] extends [never] ? B : [B] extends [never] ? A : A & B;
type NoCredentials<S> = [Field<S, "credentials">] extends [never]
  ? unknown
  : [Field<S, "credentials">] extends [false]
    ? { readonly username: ""; readonly password: "" }
    : unknown;
type Simplify<A> = { readonly [K in keyof A]: A[K] };

/**
 * The constraints a URL satisfying the spec `S` is known to have: an entry
 * for each component the spec restricts, none for the rest. `hostname` and
 * `domain` together intersect; `credentials: false` makes `username` and
 * `password` both `""`.
 *
 * @since 0.1.0
 * @category models
 */
export type FromSpec<S extends Spec> = Simplify<
  Entry<"scheme", Members<Field<S, "scheme">>> &
    Entry<"hostname", Both<Members<Field<S, "hostname">>, InDomain<Members<Field<S, "domain">>>>> &
    Entry<"port", Members<Field<S, "port">>> &
    Entry<"pathname", PathMatch<Members<Field<S, "pathname">>>> &
    NoCredentials<S>
>;

/**
 * The components a reference resolved by {@link resolve} keeps from its
 * base: everything but the path.
 *
 * @since 0.1.0
 * @category models
 */
export type SameAuthority<C extends Constraints> = Omit<C, "pathname"> & Constraints;

const parseURL = Option.liftThrowable(
  (input: string, base?: string) => new globalThis.URL(input, base),
);

const isIpAddress = (hostname: string): boolean =>
  hostname.startsWith("[") || /^\d+\.\d+\.\d+\.\d+$/.test(hostname);

const inDomain = (hostname: string, domain: string): boolean =>
  hostname === domain || (!isIpAddress(hostname) && hostname.endsWith(`.${domain}`));

const pathMatches = (pathname: string, pattern: string | Prefix): boolean =>
  P.isString(pattern) ? pathname === pattern : pathname.startsWith(pattern.prefix);

/** Whether any allowed value matches; no allowed values means no constraint. */
const anyOf = <A>(allowed: Option.Option<OneOrMore<A>>, matches: (value: A) => boolean): boolean =>
  Option.match(allowed, {
    onNone: () => true,
    onSome: (values) => Arr.ensure(values).some(matches),
  });

const check = (spec: Spec, url: globalThis.URL): boolean =>
  anyOf(Option.fromUndefinedOr(spec.scheme), (scheme) => url.protocol === `${scheme}:`) &&
  anyOf(Option.fromUndefinedOr(spec.hostname), (hostname) => url.hostname === hostname) &&
  anyOf(Option.fromUndefinedOr(spec.domain), (domain) => inDomain(url.hostname, domain)) &&
  anyOf(Option.fromUndefinedOr(spec.port), (port) => url.port === port) &&
  anyOf(Option.fromUndefinedOr(spec.pathname), (pattern) => pathMatches(url.pathname, pattern)) &&
  (spec.credentials !== false || (url.username === "" && url.password === ""));

/**
 * Whether a parsed `URL` satisfies a spec; see {@link Spec} for each field.
 *
 * @example
 * ```ts
 * import * as Url from "@thomasfosterau/effect-ext/Url"
 *
 * const isApi = Url.satisfies({ scheme: "https", domain: "example.com" })
 * console.log(isApi(new URL("https://api.example.com/v1")), isApi(new URL("https://example.com.evil.test/")))
 * // → true false
 * ```
 *
 * @since 0.1.0
 * @category predicates
 */
export const satisfies: {
  (spec: Spec): (self: globalThis.URL) => boolean;
  (self: globalThis.URL, spec: Spec): boolean;
} = dual(2, (self: globalThis.URL, spec: Spec): boolean => check(spec, self));

const quote = (value: string | Prefix): string =>
  P.isString(value) ? `"${value}"` : `"${value.prefix}"…`;

const clause = <A extends string | Prefix>(
  name: string,
  allowed: Option.Option<OneOrMore<A>>,
): ReadonlyArray<string> =>
  Arr.fromOption(
    Option.map(allowed, (values) => `${name} ${Arr.ensure(values).map(quote).join(" or ")}`),
  );

/** The spec in words, for a failed check's `expected`. */
const describe = (spec: Spec): string =>
  Arr.match(
    [
      ...clause("scheme", Option.fromUndefinedOr(spec.scheme)),
      ...clause("hostname", Option.fromUndefinedOr(spec.hostname)),
      ...clause("domain", Option.fromUndefinedOr(spec.domain)),
      ...clause("port", Option.fromUndefinedOr(spec.port)),
      ...clause("pathname", Option.fromUndefinedOr(spec.pathname)),
      ...(spec.credentials === false ? ["no credentials"] : []),
    ],
    {
      onEmpty: () => "a URL",
      onNonEmpty: (clauses) => `a URL with ${clauses.join(", ")}`,
    },
  );

/**
 * A type guard for a {@link Url} satisfying `spec`: the value is a string,
 * already in WHATWG serialisation (so `"HTTPS://Example.com"` is not, though
 * {@link schema} decodes it), and satisfies the spec. The same check as
 * `Schema.is(schema(spec))`.
 *
 * @example
 * ```ts
 * import * as Url from "@thomasfosterau/effect-ext/Url"
 *
 * const isSecure = Url.is({ scheme: "https" })
 * console.log(isSecure("https://example.com/"), isSecure("http://example.com/"))
 * // → true false
 *
 * // Only the serialised form passes: no trailing "/" here.
 * console.log(isSecure("https://example.com"))
 * // → false
 * ```
 *
 * @since 0.1.0
 * @category predicates
 */
export const is =
  <const S extends Spec>(spec: S) =>
  (value: unknown): value is Url<FromSpec<S>> =>
    P.isString(value) &&
    Option.match(parseURL(value), {
      onNone: () => false,
      onSome: (url) => url.href === value && check(spec, url),
    });

const isUrl = is({});

const serialise = SchemaGetter.transformEffect((input: string) =>
  Option.match(parseURL(input), {
    onSome: (url) => Effect.succeed(url.href),
    onNone: () => Effect.fail(new SchemaIssue.InvalidValue({ message: "not a URL" }, input)),
  }),
);

/**
 * The codec for a {@link Url} restricted by `spec`. Decoding parses the
 * string as an absolute URL (failing with "not a URL" otherwise), serialises
 * it, and checks the result against the spec (failing with what it
 * expected); encoding is the identity.
 *
 * Declare the spec inline or `as const` so its literals survive into the
 * type: a spec typed as `Spec` constrains at runtime but not in the type.
 *
 * @example
 * ```ts
 * import * as Schema from "effect/Schema"
 * import * as Url from "@thomasfosterau/effect-ext/Url"
 *
 * // Schema.Codec<Url.Url<{ scheme: "https"; hostname: "example.com" | `${string}.example.com` }>, string>
 * const ApiUrl = Url.schema({ scheme: "https", domain: "example.com" })
 *
 * console.log(Schema.decodeSync(ApiUrl)("HTTPS://API.Example.com/v1"), Schema.is(ApiUrl)("https://example.org/"))
 * // → https://api.example.com/v1 false
 * ```
 *
 * @since 0.1.0
 * @category schemas
 */
export const schema = <const S extends Spec>(spec: S): Schema.Codec<Url<FromSpec<S>>, string> =>
  Schema.String.pipe(
    Schema.decodeTo(Schema.String.pipe(Schema.refine(is(spec), { expected: describe(spec) })), {
      decode: serialise,
      encode: SchemaGetter.passthrough(),
    }),
  );

/**
 * The codec for any absolute {@link Url}: {@link schema} with an empty spec.
 *
 * @example
 * ```ts
 * import * as Schema from "effect/Schema"
 * import * as Url from "@thomasfosterau/effect-ext/Url"
 *
 * console.log(Schema.decodeSync(Url.UrlFromString)("mailto:someone@example.com"))
 * // → mailto:someone@example.com
 * ```
 *
 * @since 0.1.0
 * @category schemas
 */
export const UrlFromString: Schema.Codec<Url, string> = schema({});

/**
 * Parses `input` as a URL, against `base` when it is relative, and
 * serialises it. `None` when it is not a valid URL (a relative reference
 * without a base, a malformed host). Unconstrained; narrow the result with
 * {@link is}.
 *
 * @example
 * ```ts
 * import { Option } from "effect"
 * import * as Url from "@thomasfosterau/effect-ext/Url"
 *
 * console.log(Option.getOrUndefined(Url.parse("HTTPS://Example.com")))
 * // → https://example.com/
 * console.log(Option.getOrUndefined(Url.parse("../b", "https://example.com/a/c")))
 * // → https://example.com/b
 * console.log(Option.isNone(Url.parse("/relative")))
 * // → true
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const parse = (input: string, base?: string): Option.Option<Url> =>
  Option.flatMap(parseURL(input, base), (url) => Option.liftPredicate(url.href, isUrl));

/**
 * Whether `href` is a serialised URL on the same scheme, credentials,
 * hostname and port as `base`: the check behind {@link resolve}'s type.
 */
const onAuthorityOf =
  <C extends Constraints>(base: Url<C>) =>
  (href: string): href is Url<SameAuthority<C>> => {
    const from = new globalThis.URL(base);
    return Option.match(parseURL(href), {
      onNone: () => false,
      onSome: (to) =>
        to.href === href &&
        to.protocol === from.protocol &&
        to.username === from.username &&
        to.password === from.password &&
        to.hostname === from.hostname &&
        to.port === from.port,
    });
  };

/**
 * Resolves a reference against `base`, keeping the base's scheme,
 * credentials, hostname and port — and their types. `None` when the result
 * is not a URL or leaves the base's authority, which a reference that looks
 * like a path can still do: `//evil.test/` (and, on a special scheme,
 * `\\evil.test/`) is a network-path reference, and an absolute URL replaces
 * the base outright; both are refused unless they land on the base's own
 * authority. The path is unconstrained in the result, since the reference
 * chose it.
 *
 * @example
 * ```ts
 * import { Option } from "effect"
 * import * as Schema from "effect/Schema"
 * import * as Url from "@thomasfosterau/effect-ext/Url"
 *
 * const base = Schema.decodeSync(Url.schema({ scheme: "https", hostname: "example.com" }))(
 *   "https://example.com/posts/",
 * )
 *
 * console.log(Option.getOrUndefined(Url.resolve(base, "1")))
 * // → https://example.com/posts/1
 * console.log(Option.isNone(Url.resolve(base, "//evil.test/")))
 * // → true
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const resolve: {
  (
    reference: string,
  ): <C extends Constraints>(self: Url<C>) => Option.Option<Url<SameAuthority<C>>>;
  <C extends Constraints>(self: Url<C>, reference: string): Option.Option<Url<SameAuthority<C>>>;
} = dual(
  2,
  <C extends Constraints>(self: Url<C>, reference: string): Option.Option<Url<SameAuthority<C>>> =>
    Option.flatMap(parseURL(reference, self), (url) =>
      Option.liftPredicate(url.href, onAuthorityOf(self)),
    ),
);

/**
 * A fresh, mutable `URL` for the platform APIs that take one, and for
 * reading components. Changing it does not change the `Url` it came from.
 *
 * @example
 * ```ts
 * import * as Schema from "effect/Schema"
 * import * as Url from "@thomasfosterau/effect-ext/Url"
 *
 * const url = Schema.decodeSync(Url.UrlFromString)("https://example.com/?q=1")
 * console.log(Url.toURL(url).searchParams.get("q"))
 * // → 1
 * ```
 *
 * @since 0.1.0
 * @category conversions
 */
export const toURL = (self: Url): globalThis.URL => new globalThis.URL(self);

/**
 * Every component of a URL, in the serialised form {@link Components}
 * describes. The values are plain strings: narrow one with the spec it was
 * checked against (`is`), not with a cast.
 *
 * @example
 * ```ts
 * import * as Schema from "effect/Schema"
 * import * as Url from "@thomasfosterau/effect-ext/Url"
 *
 * const url = Schema.decodeSync(Url.UrlFromString)("https://u:p@api.example.com:8443/v1")
 * console.log(Url.components(url))
 * // → {
 * //   scheme: 'https',
 * //   username: 'u',
 * //   password: 'p',
 * //   hostname: 'api.example.com',
 * //   port: '8443',
 * //   pathname: '/v1'
 * // }
 * ```
 *
 * @since 0.1.0
 * @category getters
 */
export const components = (self: Url): Components => {
  const url = new globalThis.URL(self);
  return {
    scheme: url.protocol.slice(0, -1),
    username: url.username,
    password: url.password,
    hostname: url.hostname,
    port: url.port,
    pathname: url.pathname,
  };
};
