/**
 * Type-level behaviour of `Url`: what a spec derives, which restricted URLs
 * are assignable to which, and what `resolve` keeps. `expectTypeOf` does
 * nothing at runtime; `vp run check` is what fails when an assertion does.
 */
import { describe, expectTypeOf, it } from "@effect/vitest";
import type * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Url from "@thomasfosterau/effect-ext/Url";

const Https = Url.schema({ scheme: "https" });
const Web = Url.schema({ scheme: ["http", "https"] });
const Api = Url.schema({ scheme: "https", hostname: "api.example.com", credentials: false });
const InDomain = Url.schema({ domain: "example.com" });
const UnderApi = Url.schema({ pathname: { prefix: "/api/" } });

type Https = typeof Https.Type;
type Web = typeof Web.Type;
type Api = typeof Api.Type;
type InDomain = typeof InDomain.Type;

describe("Url types", () => {
  it("derives constraints from a spec", () => {
    expectTypeOf<Https>().toEqualTypeOf<Url.Url<{ readonly scheme: "https" }>>();
    expectTypeOf<Web>().toEqualTypeOf<Url.Url<{ readonly scheme: "http" | "https" }>>();
    expectTypeOf<Api>().toEqualTypeOf<
      Url.Url<{
        readonly scheme: "https";
        readonly hostname: "api.example.com";
        readonly username: "";
        readonly password: "";
      }>
    >();
    expectTypeOf<InDomain>().toEqualTypeOf<
      Url.Url<{ readonly hostname: "example.com" | `${string}.example.com` }>
    >();
    expectTypeOf<typeof UnderApi.Type>().toEqualTypeOf<
      Url.Url<{ readonly pathname: `/api/${string}` }>
    >();
    expectTypeOf<typeof Url.UrlFromString.Type>().toEqualTypeOf<Url.Url>();
  });

  it("makes a narrower URL assignable to a wider one", () => {
    expectTypeOf<Https>().toExtend<Web>();
    expectTypeOf<Api>().toExtend<InDomain>();
    expectTypeOf<Api>().toExtend<Https>();
    expectTypeOf<Api>().toExtend<Url.Url>();
    expectTypeOf<Api>().toExtend<string>();
  });

  it("never makes a wider URL assignable to a narrower one", () => {
    expectTypeOf<Web>().not.toExtend<Https>();
    expectTypeOf<InDomain>().not.toExtend<Api>();
    expectTypeOf<Https>().not.toExtend<Url.Url<{ username: "" }>>();
    expectTypeOf<Url.Url>().not.toExtend<Https>();
    expectTypeOf<string>().not.toExtend<Url.Url>();
  });

  it("matches a domain at a label boundary", () => {
    type Host = "example.com" | `${string}.example.com`;
    expectTypeOf<"api.example.com">().toExtend<Host>();
    expectTypeOf<"badexample.com">().not.toExtend<Host>();
  });

  it("keeps the authority through resolve and forgets the path", () => {
    const Posts = Url.schema({ scheme: "https", hostname: "example.com", pathname: "/posts/" });
    const resolved = Url.resolve(Schema.decodeSync(Posts)("https://example.com/posts/"), "1");
    expectTypeOf(resolved).toExtend<
      Option.Option<Url.Url<{ scheme: "https"; hostname: "example.com" }>>
    >();
    expectTypeOf(resolved).not.toExtend<Option.Option<Url.Url<{ pathname: "/posts/" }>>>();
  });

  it("loses the literals of a spec widened to Spec", () => {
    const widened: Url.Spec = { scheme: "https" };
    const loose = Schema.decodeSync(Url.schema(widened))("https://a.test/");
    expectTypeOf(loose).toExtend<Url.Url>();
    expectTypeOf(loose).not.toExtend<Https>();
  });

  it("accepts spec values only in serialised form", () => {
    expectTypeOf<{ scheme: "HTTPS" }>().not.toExtend<Url.Spec>();
    expectTypeOf<{ hostname: "Example.com" }>().not.toExtend<Url.Spec>();
    expectTypeOf<{ scheme: readonly [] }>().not.toExtend<Url.Spec>();
    expectTypeOf<{ scheme: readonly ["http", "https"] }>().toExtend<Url.Spec>();
  });

  it("narrows through is", () => {
    const secure = ["https://a.test/", "http://a.test/"].filter(Url.is({ scheme: "https" }));
    expectTypeOf(secure).toEqualTypeOf<Array<Url.Url<{ readonly scheme: "https" }>>>();
  });
});
