/**
 * Unit tests for the content-negotiation verdict: which representation a
 * request selects (`Selected`), the fall-through (`Fallback`) and the two
 * refusals (`NotAcceptable` / `UnsupportedMediaType`), the path-match that
 * keeps a page-only URL out of the JSON API's namespace, and the Markdown
 * representation (DISC-009).
 *
 * The module carries no media type's rules, so the JSON:API-like
 * representation here is a local fixture: only `ext` / `profile` parameters,
 * every `ext` URI in a declared list (the rule effect-jsonapi supplies in
 * production). The route table a consuming application derives from its
 * `HttpApi` groups is a literal path list, and the Markdown segments are a
 * fixed fixture list.
 */
import { describe, expect, it } from "vite-plus/test";
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import type { MimeType } from "@thomasfosterau/effect-ext/Mime";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import {
  CROSS_ORIGIN_REJECTED,
  isMutatingMethod,
  JSONAPI_MEDIA_TYPE,
  jsonApiErrorResponseWeb,
  SERVICE_UNAVAILABLE,
} from "@thomasfosterau/effect-ext/Web";
import {
  chooseNegotiatedResponse,
  endpointPaths,
  makeApiPathMatcher,
  makeMarkdownPathMatcher,
  MARKDOWN_MEDIA_TYPE,
  Negotiation,
  negotiateRepresentation,
  negotiateWebRequest,
  type Representation,
  requestForRouter,
  requestForRouterWeb,
} from "@thomasfosterau/effect-ext/Negotiate";

const ORIGIN = "https://thomasfoster.au";
const UUID = "0b9aab8a-3d24-4b85-a3a6-046cba9856ce";

const groups = [
  { endpoints: { list: { path: "/posts" }, get: { path: "/posts/:id" } } },
  { endpoints: { list: { path: "/notes/" }, get: { path: "/notes/:id" } } },
  { endpoints: { search: { path: "/search" } } },
  {
    endpoints: {
      list: { path: "/consumption-log-entries" },
      get: { path: "/consumption-log-entries/:id" },
    },
  },
  { endpoints: { list: { path: "/comments" } } },
  { endpoints: { items: { path: "/lists/:id/items" }, list: { path: "/list-items/:id/list" } } },
  {
    endpoints: {
      list: { path: "/web-pages" },
      get: { path: "/web-pages/:id" },
      site: { path: "/web-pages/:id/site" },
    },
  },
  { endpoints: { root: { path: "/" } } },
];
const isApiPath = makeApiPathMatcher(endpointPaths(groups));
const isMarkdownPath = makeMarkdownPathMatcher([
  "posts",
  "notes",
  "questions",
  "books",
  "consumption-log",
]);

const EXTENSIONS = ["atomic"];

/** The JSON:API-like fixture: `ext` (every URI declared) and `profile` parameters only. */
const acceptsJsonApiParameters = (mediaType: MimeType.MimeType): boolean =>
  mediaType.parameters.every(
    ([name, value]) =>
      name === "profile" ||
      (name === "ext" && value.split(" ").every((uri) => EXTENSIONS.includes(uri))),
  );

const markdown: Representation = { mediaType: MARKDOWN_MEDIA_TYPE, servesPath: isMarkdownPath };
const jsonApi: Representation = {
  mediaType: JSONAPI_MEDIA_TYPE,
  servesPath: isApiPath,
  acceptsParameters: acceptsJsonApiParameters,
};
const options = { accept: [markdown, jsonApi], contentType: [jsonApi] };

const get = (path: string, accept?: string): Request =>
  new Request(`${ORIGIN}${path}`, {
    method: "GET",
    headers: accept === undefined ? {} : { accept },
  });

const write = (method: string, path: string, contentType?: string): Request =>
  new Request(`${ORIGIN}${path}`, {
    method,
    headers: contentType === undefined ? {} : { "content-type": contentType },
  });

const negotiate = (request: Request): Negotiation => negotiateWebRequest(request, options);

/** Assert a verdict is the fall-through (serve the default, HTML). */
const expectFallthrough = (n: Negotiation): void => {
  expect(n._tag).toBe("Fallback");
};

const expectHtmlFallthrough = expectFallthrough;

/** Assert a verdict selects exactly this representation. */
const expectSelected = (n: Negotiation, representation: Representation): void => {
  expect(n._tag).toBe("Selected");
  expect(Negotiation.$is("Selected")(n) && n.representation === representation).toBe(true);
};

/** Assert a verdict dispatches to the JSON API. */
const expectWriteDispatch = (n: Negotiation): void => expectSelected(n, jsonApi);
const expectDispatch = expectWriteDispatch;

/** Assert a verdict serves the Markdown representation. */
const expectMarkdown = (n: Negotiation): void => expectSelected(n, markdown);

/** Assert a verdict is the given refusal, carrying the JSON API representation. */
const expectRefusal = (n: Negotiation, tag: "NotAcceptable" | "UnsupportedMediaType"): void => {
  expect(n._tag).toBe(tag);
  expect(
    (Negotiation.$is("NotAcceptable")(n) || Negotiation.$is("UnsupportedMediaType")(n)) &&
      n.representation === jsonApi,
  ).toBe(true);
};
const expectWriteRefusal = expectRefusal;

describe("makeApiPathMatcher / endpointPaths", () => {
  it("matches known endpoint paths", () => {
    expect(isApiPath("/posts")).toBe(true);
    expect(isApiPath("/posts/")).toBe(true);
    expect(isApiPath(`/posts/${UUID}`)).toBe(true);
    expect(isApiPath(`/notes/${UUID}`)).toBe(true);
    expect(isApiPath("/search")).toBe(true);
    // Every served endpoint family must match: a family the matcher misses
    // never dispatches, so its JSON:API requests fall through to HTML.
    expect(isApiPath("/consumption-log-entries")).toBe(true);
    expect(isApiPath(`/consumption-log-entries/${UUID}`)).toBe(true);
    expect(isApiPath("/comments")).toBe(true);
  });

  it("matches the §7.4 related-resource fetch paths", () => {
    expect(isApiPath(`/lists/${UUID}/items`)).toBe(true);
    expect(isApiPath(`/list-items/${UUID}/list`)).toBe(true);
  });

  it("matches a family under its advertised segment only", () => {
    expect(isApiPath("/web-pages")).toBe(true);
    expect(isApiPath(`/web-pages/${UUID}`)).toBe(true);
    expect(isApiPath(`/web-pages/${UUID}/site`)).toBe(true);
    expect(isApiPath("/webpages")).toBe(false);
    expect(isApiPath(`/webpages/${UUID}`)).toBe(false);
  });

  it("rejects page-only and non-endpoint paths", () => {
    expect(isApiPath("/about")).toBe(false);
    // A root endpoint path would over-match every URL and is ignored.
    expect(isApiPath("/")).toBe(false);
    // An edit page under an API segment is not itself an endpoint.
    expect(isApiPath(`/posts/${UUID}/edit`)).toBe(false);
    // An auth namespace is not part of this surface.
    expect(isApiPath("/api/auth/session")).toBe(false);
  });

  it("reads every group's endpoint paths structurally", () => {
    expect(endpointPaths(groups.slice(0, 1))).toStrictEqual(["/posts", "/posts/:id"]);
  });
});

describe("negotiateRepresentation — reads (Accept)", () => {
  // #103 (gardeneria#1459's differential test): JSON:API §6.3.2 answers 406
  // only when EVERY instance carries a disallowed parameter, and RFC 9110
  // §12.5.1 ranks the clean instance against every other media type by q.
  it("dispatches when one JSON:API instance is parameterised but another is clean (#103)", () => {
    expectDispatch(
      negotiate(get("/posts", `${JSONAPI_MEDIA_TYPE};version=1, ${JSONAPI_MEDIA_TYPE}`)),
    );
  });

  it("falls through to HTML when the client ranks HTML above JSON:API by q (#103)", () => {
    expectHtmlFallthrough(negotiate(get("/posts", `${JSONAPI_MEDIA_TYPE};q=0.5, text/html;q=0.9`)));
  });

  it("answers NotAcceptable only when every JSON:API instance is parameterised (#103)", () => {
    expect(
      negotiate(get("/posts", `${JSONAPI_MEDIA_TYPE};version=1, ${JSONAPI_MEDIA_TYPE};foo=bar`))
        ._tag,
    ).toBe("NotAcceptable");
  });

  it("dispatches when the JSON:API media type wins on an API path", () => {
    expectDispatch(negotiate(get("/posts", JSONAPI_MEDIA_TYPE)));
  });

  it("dispatches a vnd.api+json request to a resource's self URL under its advertised segment", () => {
    expectDispatch(negotiate(get(`/web-pages/${UUID}`, JSONAPI_MEDIA_TYPE)));
  });

  it("falls through to HTML for a browser navigation Accept", () => {
    expectHtmlFallthrough(
      negotiate(get("/posts", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")),
    );
  });

  it("normalizes distinct browser Accept strings to one cache-key token", () => {
    const a = negotiate(get("/posts", "text/html,*/*;q=0.8"));
    const b = negotiate(get("/posts", "text/html,application/xml;q=0.9"));
    expectHtmlFallthrough(a);
    expectHtmlFallthrough(b);
    expect(b._tag).toBe(a._tag);
  });

  it("never matches application/json or the wildcard range", () => {
    // Neither names the JSON:API media type, so neither is a §6 refusal.
    expectHtmlFallthrough(negotiate(get("/posts", "application/json")));
    expectHtmlFallthrough(negotiate(get("/posts", "*/*")));
  });

  it("falls through to HTML when the path is not an API resource", () => {
    expectHtmlFallthrough(negotiate(get("/about", JSONAPI_MEDIA_TYPE)));
  });

  it("treats no Accept header as HTML", () => {
    expectHtmlFallthrough(negotiate(get("/posts")));
  });

  it("allows profile and a supported ext parameter (clean instance)", () => {
    expectDispatch(negotiate(get("/posts", `${JSONAPI_MEDIA_TYPE};profile="https://x"`)));
    expectDispatch(negotiate(get("/posts", `${JSONAPI_MEDIA_TYPE};ext="atomic"`)));
  });

  it("§5: an ext the api does not declare is not a clean instance", () => {
    // The fixture checks the `ext` URIs against its declared list, per the
    // spec, so an undeclared extension is refused rather than accepted.
    expectRefusal(
      negotiate(get("/posts", `${JSONAPI_MEDIA_TYPE};ext="https://example.com/unknown"`)),
      "NotAcceptable",
    );
  });

  it("§6: NotAcceptable when every JSON:API instance is parameterised", () => {
    expectRefusal(negotiate(get("/posts", `${JSONAPI_MEDIA_TYPE};version=1`)), "NotAcceptable");
  });

  it("does not 406 on a page-only path even if parameterised", () => {
    expectHtmlFallthrough(negotiate(get("/about", `${JSONAPI_MEDIA_TYPE};version=1`)));
  });

  it("loses to a higher-q competitor, wins on a tie", () => {
    expectHtmlFallthrough(negotiate(get("/posts", `${JSONAPI_MEDIA_TYPE};q=0.5, text/html;q=0.9`)));
    expectDispatch(negotiate(get("/posts", `${JSONAPI_MEDIA_TYPE}, text/html`)));
  });

  it("treats a q=0 clean instance as a refusal (HTML), not a §6 parameterisation (406)", () => {
    const n = negotiate(get("/posts", `${JSONAPI_MEDIA_TYPE};q=0, text/html`));
    expectHtmlFallthrough(n);
  });
});

describe("negotiateRepresentation — writes (Content-Type)", () => {
  it("dispatches a JSON:API write on an API path", () => {
    expectWriteDispatch(negotiate(write("POST", "/posts", JSONAPI_MEDIA_TYPE)));
  });

  it("dispatches a bodyless DELETE carrying the media type", () => {
    expectWriteDispatch(negotiate(write("DELETE", `/posts/${UUID}`, JSONAPI_MEDIA_TYPE)));
  });

  it("falls through for an application/json write (no 415)", () => {
    // The surface is selected by its media type (JSONAPI-NEG-001): a write
    // that does not carry it is outside the JSON:API, not refused by it. The
    // 415 is only for a JSON:API Content-Type with a disallowed parameter.
    expectFallthrough(negotiate(write("POST", "/posts", "application/json")));
  });

  it("§6: UnsupportedMediaType when the write Content-Type carries a disallowed parameter", () => {
    expectWriteRefusal(
      negotiate(write("PATCH", `/posts/${UUID}`, `${JSONAPI_MEDIA_TYPE};charset=utf-8`)),
      "UnsupportedMediaType",
    );
  });

  it("allows profile and a supported ext on a write Content-Type", () => {
    expectWriteDispatch(negotiate(write("POST", "/posts", `${JSONAPI_MEDIA_TYPE};ext="atomic"`)));
    expectWriteDispatch(
      negotiate(write("POST", "/posts", `${JSONAPI_MEDIA_TYPE};profile="https://x"`)),
    );
  });

  it("falls through for a JSON:API write to a non-API path", () => {
    expectFallthrough(negotiate(write("POST", "/about", JSONAPI_MEDIA_TYPE)));
  });
});

describe("isMutatingMethod", () => {
  it("classifies mutating methods", () => {
    expect(Arr.map(["POST", "put", "Patch", "DELETE"], isMutatingMethod)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(Arr.map(["GET", "HEAD", "OPTIONS"], isMutatingMethod)).toEqual([false, false, false]);
  });
});

describe("requestForRouter", () => {
  it("relabels a JSON:API write Content-Type to application/json (Web)", () => {
    const router = requestForRouterWeb(write("POST", "/posts", JSONAPI_MEDIA_TYPE));
    expect(router.headers.get("content-type")).toBe("application/json");
  });

  it("leaves reads unchanged (Web)", () => {
    const original = get("/posts", JSONAPI_MEDIA_TYPE);
    expect(requestForRouterWeb(original)).toBe(original);
  });

  it("does the same over an HttpServerRequest", () => {
    const router = requestForRouter(
      HttpServerRequest.fromWeb(write("POST", "/posts", JSONAPI_MEDIA_TYPE)),
    );
    expect(router.headers["content-type"]).toBe("application/json");
    const read = HttpServerRequest.fromWeb(get("/posts", JSONAPI_MEDIA_TYPE));
    expect(requestForRouter(read)).toBe(read);
    expectDispatch(negotiateRepresentation(read, options));
  });
});

describe("jsonApiErrorResponseWeb", () => {
  it("serialises a JSON:API error document with the media type", async () => {
    const response = jsonApiErrorResponseWeb({
      status: 415,
      code: "unsupported-media-type",
      title: "Unsupported Media Type",
      detail: "nope",
    });
    expect(response.status).toBe(415);
    expect(response.headers.get("content-type")).toBe(JSONAPI_MEDIA_TYPE);
    // SAFETY: `jsonApiErrorResponseWeb` serialises `jsonApiErrorDocument`, whose shape this names.
    const body = (await response.json()) as {
      errors: ReadonlyArray<{ status: string; code: string }>;
      jsonapi: { version: string };
    };
    expect(body.jsonapi.version).toBe("1.1");
    expect(body.errors[0]?.status).toBe("415");
    expect(body.errors[0]?.code).toBe("unsupported-media-type");
  });
});

describe("makeMarkdownPathMatcher", () => {
  it("matches content detail pages", () => {
    expect(isMarkdownPath(`/posts/${UUID}`)).toBe(true);
    expect(isMarkdownPath(`/notes/${UUID}`)).toBe(true);
    expect(isMarkdownPath(`/posts/${UUID}/`)).toBe(true);
    expect(isMarkdownPath(`/books/${UUID}`)).toBe(true);
  });

  it("matches a hand-built route segment that diverges from the JSON:API type", () => {
    expect(isMarkdownPath(`/consumption-log/${UUID}`)).toBe(true);
    expect(isMarkdownPath(`/consumption-log-entries/${UUID}`)).toBe(false);
  });

  it("does not match collections, non-content routes, or pages", () => {
    expect(isMarkdownPath("/posts")).toBe(false);
    expect(isMarkdownPath("/posts/")).toBe(false);
    expect(isMarkdownPath("/about")).toBe(false);
    expect(isMarkdownPath(`/posts/${UUID}/edit`)).toBe(false);
  });

  it("matches nothing while the segment list is empty (no Markdown routes yet)", () => {
    expect(makeMarkdownPathMatcher([])(`/posts/${UUID}`)).toBe(false);
  });
});

describe("Markdown negotiation (DISC-009)", () => {
  it("serves Markdown when text/markdown wins on a content detail page", () => {
    expectMarkdown(negotiate(get(`/posts/${UUID}`, MARKDOWN_MEDIA_TYPE)));
  });

  it("selects Markdown, JSON:API and the fall-through apart", () => {
    const html = negotiate(get(`/posts/${UUID}`, "text/html"));
    const md = negotiate(get(`/posts/${UUID}`, MARKDOWN_MEDIA_TYPE));
    const api = negotiate(get(`/posts/${UUID}`, JSONAPI_MEDIA_TYPE));
    expectHtmlFallthrough(html);
    expectMarkdown(md);
    expectDispatch(api);
    expect(Arr.dedupe([html._tag, md._tag, api._tag])).toHaveLength(2);
  });

  it("falls through to HTML for a browser Accept (html outranks markdown)", () => {
    const n = negotiate(get(`/posts/${UUID}`, "text/html,application/xhtml+xml,*/*;q=0.8"));
    expectHtmlFallthrough(n);
  });

  it("falls through to HTML when markdown is offered below html", () => {
    expectHtmlFallthrough(negotiate(get(`/posts/${UUID}`, "text/html, text/markdown;q=0.5")));
  });

  it("does not serve Markdown on a non-content route even when requested", () => {
    expectHtmlFallthrough(negotiate(get("/about", MARKDOWN_MEDIA_TYPE)));
  });

  it("does not serve Markdown when it is not among the representations", () => {
    expectHtmlFallthrough(
      negotiateWebRequest(get(`/posts/${UUID}`, MARKDOWN_MEDIA_TYPE), { accept: [jsonApi] }),
    );
  });

  it("ignores text/markdown on writes (negotiates on Content-Type only)", () => {
    expectFallthrough(negotiate(write("POST", `/posts/${UUID}`, "text/markdown")));
  });
});

describe("negotiateRepresentation — non-read, non-write methods", () => {
  it("falls through for OPTIONS even on an API path", () => {
    expectFallthrough(negotiate(new Request(`${ORIGIN}/posts`, { method: "OPTIONS" })));
  });
});

describe("quality parsing — malformed q values", () => {
  it("treats an unparseable Accept q= as the default 1 (still wins on a tie)", () => {
    expectDispatch(negotiate(get("/posts", `${JSONAPI_MEDIA_TYPE};q=abc`)));
  });

  it("treats an unparseable markdown q= as the default 1", () => {
    expectMarkdown(negotiate(get(`/posts/${UUID}`, "text/markdown;q=xyz")));
  });
});

describe("the Accept q split is positional (RFC 9110 §12.4.2)", () => {
  it("ignores accept-extension parameters after q (;q=…;foo=bar is clean)", () => {
    expectDispatch(negotiate(get("/posts", `${JSONAPI_MEDIA_TYPE};q=0.8;foo=bar`)));
    expectDispatch(
      negotiate(
        get("/posts", `${JSONAPI_MEDIA_TYPE};profile="https://x";q=0.9;foo=bar, text/html;q=0.5`),
      ),
    );
  });

  it("still 406s a disallowed media-type parameter positioned before q", () => {
    expectRefusal(
      negotiate(get("/posts", `${JSONAPI_MEDIA_TYPE};version=1;q=0.9`)),
      "NotAcceptable",
    );
  });

  it("reads the weight from the first q, not from what follows it", () => {
    expectHtmlFallthrough(
      negotiate(get("/posts", `${JSONAPI_MEDIA_TYPE};q=0.5;foo=bar, text/html;q=0.9`)),
    );
    expectHtmlFallthrough(negotiate(get("/posts", `${JSONAPI_MEDIA_TYPE};q=0;foo=bar, text/html`)));
    expectHtmlFallthrough(negotiate(get("/posts", `${JSONAPI_MEDIA_TYPE};q=0;q=1, text/html`)));
    expectHtmlFallthrough(
      negotiate(get("/posts", `${JSONAPI_MEDIA_TYPE};q=0.5;q=1, text/html;q=0.9`)),
    );
  });

  it("tolerates whitespace and empty parts around the parameters", () => {
    expectDispatch(negotiate(get("/posts", `${JSONAPI_MEDIA_TYPE};`)));
    expectDispatch(negotiate(get("/posts", ` ${JSONAPI_MEDIA_TYPE} ; ; q=0.8 ; foo=bar`)));
  });
});

describe("media types are compared as WHATWG MIME types (effect-mime)", () => {
  it("matches the JSON:API media type by its essence, whatever the case or whitespace", () => {
    expectDispatch(negotiate(get("/posts", "Application/VND.API+JSON")));
    expectWriteDispatch(negotiate(write("POST", "/posts", " Application/Vnd.Api+Json ")));
    expectWriteDispatch(negotiate(write("POST", "/posts", `${JSONAPI_MEDIA_TYPE} ;ext="atomic"`)));
  });

  it("matches text/markdown by its essence", () => {
    expectMarkdown(negotiate(get(`/posts/${UUID}`, "Text/Markdown;charset=utf-8")));
  });

  it("falls through for a write Content-Type that is not a MIME type (no 415)", () => {
    // `application/vnd.api+json, application/json` has no valid subtype, so it
    // does not carry the JSON:API media type at all (JSONAPI-NEG-001).
    expectFallthrough(
      negotiate(write("POST", "/posts", `${JSONAPI_MEDIA_TYPE}, application/json`)),
    );
    expectFallthrough(negotiate(write("POST", "/posts", "application")));
  });

  it("an Accept entry that is not a MIME type matches nothing but still competes", () => {
    expectHtmlFallthrough(negotiate(get("/posts", `${JSONAPI_MEDIA_TYPE};q=0.5, garbage`)));
    expectDispatch(negotiate(get("/posts", `${JSONAPI_MEDIA_TYPE}, garbage;q=0.5`)));
  });
});

const anywhere = (accept: string): Negotiation =>
  negotiateWebRequest(get("/anywhere", accept), { accept: [{ mediaType: "text/markdown" }] });

describe("Representation defaults and priority", () => {
  it("serves every path when servesPath is omitted", () => {
    expect(anywhere("text/markdown")._tag).toBe("Selected");
    expect(
      negotiateWebRequest(get("/", "text/markdown"), { accept: [{ mediaType: "text/markdown" }] })
        ._tag,
    ).toBe("Selected");
  });

  it("accepts any parameters when acceptsParameters is omitted", () => {
    expect(anywhere("text/markdown;variant=GFM;charset=utf-8")._tag).toBe("Selected");
  });

  it("passes the parameters before q to acceptsParameters, and none after it", () => {
    const seen: Array<ReadonlyArray<readonly [string, string]>> = [];
    const spy: Representation = {
      mediaType: "text/markdown",
      acceptsParameters: (mediaType) => {
        seen.push(mediaType.parameters);
        return true;
      },
    };
    negotiateWebRequest(get("/", "text/markdown;variant=gfm;q=0.5;ext=1"), { accept: [spy] });
    expect(seen.length).toBeGreaterThan(0);
    seen.forEach((parameters) => expect(parameters).toStrictEqual([["variant", "gfm"]]));
  });

  it("selects nothing on a write when contentType is omitted", () => {
    expectFallthrough(
      negotiateWebRequest(write("POST", "/posts", JSONAPI_MEDIA_TYPE), { accept: [jsonApi] }),
    );
  });

  it("tries the representations in priority order, and the verdict carries the given value", () => {
    const first: Representation = { mediaType: "application/json" };
    const second: Representation = { mediaType: "text/csv" };
    const accept = "application/json, text/csv";
    expectSelected(negotiateWebRequest(get("/", accept), { accept: [first, second] }), first);
    expectSelected(negotiateWebRequest(get("/", accept), { accept: [second, first] }), second);
  });

  it("falls through to the next representation when a higher-priority one loses the ranking", () => {
    const json: Representation = { mediaType: "application/json" };
    const csv: Representation = { mediaType: "text/csv" };
    expectSelected(
      negotiateWebRequest(get("/", "application/json;q=0.2, text/csv"), { accept: [json, csv] }),
      csv,
    );
  });

  it("picks the first write representation whose media type and path match", () => {
    const a: Representation = { mediaType: "application/json", servesPath: () => false };
    const b: Representation = { mediaType: "application/json" };
    expectSelected(
      negotiateWebRequest(write("PUT", "/x", "application/json"), {
        accept: [],
        contentType: [a, b],
      }),
      b,
    );
  });

  it("is Negotiation.$match-able", () => {
    const label = Negotiation.$match(negotiate(get("/posts", JSONAPI_MEDIA_TYPE)), {
      Selected: ({ representation }) => representation.mediaType,
      Fallback: () => "fallback",
      NotAcceptable: () => "406",
      UnsupportedMediaType: () => "415",
    });
    expect(label).toBe(JSONAPI_MEDIA_TYPE);
  });
});

describe("exported seam guard errors", () => {
  it("serialises the cross-origin rejection as a 403 JSON:API document", async () => {
    const response = jsonApiErrorResponseWeb(CROSS_ORIGIN_REJECTED);
    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toBe(JSONAPI_MEDIA_TYPE);
    // SAFETY: the JSON:API error document `jsonApiErrorDocument` emits.
    const body = (await response.json()) as { errors: ReadonlyArray<{ code: string }> };
    expect(body.errors[0]?.code).toBe("auth.forbidden");
  });

  it("serialises the service-unavailable guard as a 503 JSON:API document", async () => {
    const response = jsonApiErrorResponseWeb(SERVICE_UNAVAILABLE);
    expect(response.status).toBe(503);
    // SAFETY: the JSON:API error document `jsonApiErrorDocument` emits.
    const body = (await response.json()) as { errors: ReadonlyArray<{ code: string }> };
    expect(body.errors[0]?.code).toBe("unavailable");
  });
});

describe("chooseNegotiatedResponse", () => {
  it("picks the Markdown response and never calls the HTML thunk", () => {
    let rendered = 0;
    expect(
      chooseNegotiatedResponse(Option.some("# md"), () => {
        rendered += 1;
        return "<html>";
      }),
    ).toBe("# md");
    expect(rendered).toBe(0);
  });

  it("falls through to the HTML thunk on None", () => {
    expect(chooseNegotiatedResponse(Option.none(), () => "<html>")).toBe("<html>");
  });
});
