/**
 * `Url` at runtime: decoding normalises and checks each spec field, the
 * guard requires the serialised form, and `resolve` refuses a reference
 * that leaves the base's authority.
 */
import { describe, expect, it } from "@effect/vitest";
import { pipe } from "effect/Function";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Url from "@thomasfosterau/effect-ext/Url";

const decodes = (spec: Url.Spec, input: string): Option.Option<string> =>
  Result.getSuccess(Schema.decodeResult(Url.schema(spec))(input));

describe("schema", () => {
  it("decodes to the WHATWG serialisation", () => {
    expect(decodes({}, " HTTPS://Example.COM:443/a/../b?q#f")).toStrictEqual(
      Option.some("https://example.com/b?q#f"),
    );
    expect(decodes({}, "mailto:someone@example.com")).toStrictEqual(
      Option.some("mailto:someone@example.com"),
    );
  });

  it("refuses what is not an absolute URL", () => {
    expect(decodes({}, "/relative")).toStrictEqual(Option.none());
    expect(decodes({}, "https://exa mple.com/")).toStrictEqual(Option.none());
    expect(Schema.decodeUnknownResult(Url.UrlFromString)(42)).toSatisfy(Result.isFailure);
  });

  it("checks the scheme against one or several", () => {
    expect(decodes({ scheme: "https" }, "https://a.test/")).toSatisfy(Option.isSome);
    expect(decodes({ scheme: "https" }, "http://a.test/")).toStrictEqual(Option.none());
    expect(decodes({ scheme: ["http", "https"] }, "http://a.test/")).toSatisfy(Option.isSome);
    expect(decodes({ scheme: "http" }, "https://a.test/")).toStrictEqual(Option.none());
  });

  it("checks the hostname exactly, after the parser decides it", () => {
    expect(decodes({ hostname: "example.com" }, "https://EXAMPLE.com/")).toSatisfy(Option.isSome);
    expect(decodes({ hostname: "example.com" }, "https://api.example.com/")).toStrictEqual(
      Option.none(),
    );
    expect(decodes({ hostname: "example.com" }, "https://example.com@evil.test/")).toStrictEqual(
      Option.none(),
    );
    expect(decodes({ hostname: "xn--bcher-kva.example" }, "https://bücher.example/")).toSatisfy(
      Option.isSome,
    );
  });

  it("checks the domain at a label boundary", () => {
    const spec = { domain: "example.com" } as const;
    expect(decodes(spec, "https://example.com/")).toSatisfy(Option.isSome);
    expect(decodes(spec, "https://a.b.example.com/")).toSatisfy(Option.isSome);
    expect(decodes(spec, "https://badexample.com/")).toStrictEqual(Option.none());
    expect(decodes(spec, "https://example.com.evil.test/")).toStrictEqual(Option.none());
    expect(decodes({ domain: ["a.test", "b.test"] }, "https://x.b.test/")).toSatisfy(Option.isSome);
  });

  it("matches an IP-address host only exactly", () => {
    expect(decodes({ domain: "0.1" }, "http://10.0.0.1/")).toStrictEqual(Option.none());
    expect(decodes({ domain: "10.0.0.1" }, "http://10.0.0.1/")).toSatisfy(Option.isSome);
    expect(decodes({ domain: "1]" }, "http://[::1]/")).toStrictEqual(Option.none());
  });

  it("checks the port, the default as empty", () => {
    expect(decodes({ port: "" }, "https://a.test:443/")).toSatisfy(Option.isSome);
    expect(decodes({ port: "" }, "https://a.test:8443/")).toStrictEqual(Option.none());
    expect(decodes({ port: ["", "8443"] }, "https://a.test:8443/")).toSatisfy(Option.isSome);
  });

  it("checks the path exactly or by prefix", () => {
    expect(decodes({ pathname: "/" }, "https://a.test")).toSatisfy(Option.isSome);
    expect(decodes({ pathname: "/" }, "https://a.test/x")).toStrictEqual(Option.none());
    expect(decodes({ pathname: { prefix: "/api/" } }, "https://a.test/api/v1")).toSatisfy(
      Option.isSome,
    );
    expect(decodes({ pathname: { prefix: "/api/" } }, "https://a.test/api/../admin")).toStrictEqual(
      Option.none(),
    );
    expect(decodes({ pathname: ["/a", { prefix: "/b/" }] }, "https://a.test/b/c")).toSatisfy(
      Option.isSome,
    );
  });

  it("refuses credentials when they are forbidden", () => {
    expect(decodes({ credentials: false }, "https://a.test/")).toSatisfy(Option.isSome);
    expect(decodes({ credentials: false }, "https://u@a.test/")).toStrictEqual(Option.none());
    expect(decodes({ credentials: false }, "https://:p@a.test/")).toStrictEqual(Option.none());
    expect(decodes({ credentials: true }, "https://u:p@a.test/")).toSatisfy(Option.isSome);
  });

  it("says what it expected", () => {
    const result = Schema.decodeResult(
      Url.schema({
        scheme: "https",
        domain: "example.com",
        pathname: { prefix: "/a/" },
        credentials: false,
      }),
    )("http://example.com/");
    expect(Result.isFailure(result) && String(result.failure)).toContain(
      'a URL with scheme "https", domain "example.com", pathname "/a/"…, no credentials',
    );
    const unparsable = Schema.decodeResult(Url.UrlFromString)("nope");
    expect(Result.isFailure(unparsable) && String(unparsable.failure)).toContain("not a URL");
  });

  it("encodes as the identity", () => {
    const Https = Url.schema({ scheme: "https" });
    const url = Schema.decodeSync(Https)("https://a.test/x");
    expect(Schema.encodeSync(Https)(url)).toBe("https://a.test/x");
  });
});

describe("is", () => {
  it("requires the serialised form and the spec", () => {
    const isHttps = Url.is({ scheme: "https" });
    expect(isHttps("https://a.test/")).toBe(true);
    expect(isHttps("https://a.test")).toBe(false);
    expect(isHttps("HTTPS://a.test/")).toBe(false);
    expect(isHttps("http://a.test/")).toBe(false);
    expect(isHttps("not a url")).toBe(false);
    expect(isHttps(new URL("https://a.test/"))).toBe(false);
  });

  it("is what Schema.is sees", () => {
    expect(Schema.is(Url.schema({ scheme: "https" }))("https://a.test/")).toBe(true);
    expect(Schema.is(Url.schema({ scheme: "https" }))("https://a.test")).toBe(false);
  });
});

describe("parse", () => {
  it("parses against a base", () => {
    expect(Url.parse("HTTPS://a.test")).toStrictEqual(Option.some("https://a.test/"));
    expect(Url.parse("../b", "https://a.test/a/c")).toStrictEqual(Option.some("https://a.test/b"));
    expect(Url.parse("/relative")).toStrictEqual(Option.none());
  });
});

describe("resolve", () => {
  const base = Schema.decodeSync(Url.schema({ scheme: "https", hostname: "a.test" }))(
    "https://a.test/posts/",
  );

  it("resolves within the base's authority", () => {
    expect(Url.resolve(base, "1")).toStrictEqual(Option.some("https://a.test/posts/1"));
    expect(Url.resolve(base, "/x?y")).toStrictEqual(Option.some("https://a.test/x?y"));
    expect(Url.resolve(base, "https://a.test/z")).toStrictEqual(Option.some("https://a.test/z"));
    expect(pipe(base, Url.resolve("2"))).toStrictEqual(Option.some("https://a.test/posts/2"));
  });

  it("refuses a reference that leaves it", () => {
    expect(Url.resolve(base, "//evil.test/")).toStrictEqual(Option.none());
    expect(Url.resolve(base, "\\\\evil.test/")).toStrictEqual(Option.none());
    expect(Url.resolve(base, "http://a.test/")).toStrictEqual(Option.none());
    expect(Url.resolve(base, "https://a.test:8443/")).toStrictEqual(Option.none());
    expect(Url.resolve(base, "https://u@a.test/")).toStrictEqual(Option.none());
    expect(Url.resolve(base, "https://[")).toStrictEqual(Option.none());
  });
});

describe("components", () => {
  const url = Schema.decodeSync(Url.UrlFromString)("https://u:p@api.example.com:8443/v1/x?q#f");

  it("reads each component in its serialised form", () => {
    expect(Url.components(url)).toStrictEqual({
      scheme: "https",
      username: "u",
      password: "p",
      hostname: "api.example.com",
      port: "8443",
      pathname: "/v1/x",
    });
    expect(Url.components(Schema.decodeSync(Url.UrlFromString)("https://a.test")).port).toBe("");
  });

  it("hands out a URL the Url does not share", () => {
    const copy = Url.toURL(url);
    copy.hostname = "evil.test";
    expect(Url.components(url).hostname).toBe("api.example.com");
  });
});

describe("satisfies", () => {
  it("checks a parsed URL", () => {
    expect(Url.satisfies({ scheme: "https" })(new URL("https://a.test"))).toBe(true);
    expect(Url.satisfies({})(new URL("ftp://a.test"))).toBe(true);
    expect(Url.satisfies(new URL("http://a.test"), { scheme: "https" })).toBe(false);
  });
});
