/**
 * The 495-shape negotiation matrix gardeneria pins as its golden
 * (`packages/api/tests/__golden__/negotiate-matrix.txt`, gardeneria#1764),
 * replayed against the library: five paths × (two reads × 22 `Accept`
 * values + five writes × 11 `Content-Type` values).
 *
 * One verdict character per header value, in index order:
 *
 * - `H` — `Fallback` (serve HTML)
 * - `D` — `Selected` the JSON:API representation (dispatch)
 * - `N` — `NotAcceptable` (406)
 * - `U` — `UnsupportedMediaType` (415)
 * - `M` — `Selected` the Markdown representation (unused: gardeneria serves
 *   no Markdown pages)
 *
 * Gardeneria's golden differs from this table in one place: its writes to
 * `/operations` must also declare the Atomic extension, an application rule
 * it keeps as a wrapper around this verdict, so its golden reads
 * `HUUUDDUUUHH` where the library alone answers `HDDDDDUUUHH`. The table
 * holds #103's two cases: `Accept` index 8 (one clean instance among
 * parameterised ones) dispatches, and index 12 (HTML ranked above JSON:API by
 * `q`) falls through.
 */
import { describe, expect, it } from "vite-plus/test";
import * as Option from "effect/Option";
import type { MimeType } from "@thomasfosterau/effect-ext/Mime";
import { JSONAPI_MEDIA_TYPE } from "@thomasfosterau/effect-ext/Web";
import {
  makeApiPathMatcher,
  makeMarkdownPathMatcher,
  MARKDOWN_MEDIA_TYPE,
  Negotiation,
  negotiateWebRequest,
  type Representation,
} from "@thomasfosterau/effect-ext/Negotiate";

const ORIGIN = "https://thomasfoster.au";
const ATOMIC = "https://jsonapi.org/ext/atomic";
const EXTENSIONS = [ATOMIC];

/** JSON:API §5: `profile`, and `ext` naming only declared extensions. */
const acceptsJsonApiParameters = (mediaType: MimeType.MimeType): boolean =>
  mediaType.parameters.every(
    ([name, value]) =>
      name === "profile" ||
      (name === "ext" && value.split(" ").every((uri) => EXTENSIONS.includes(uri))),
  );

const jsonApi: Representation = {
  mediaType: JSONAPI_MEDIA_TYPE,
  servesPath: makeApiPathMatcher(["/comments", "/comments/:uuid", "/operations"]),
  acceptsParameters: acceptsJsonApiParameters,
};
const markdown: Representation = {
  mediaType: MARKDOWN_MEDIA_TYPE,
  servesPath: makeMarkdownPathMatcher([]),
};
const options = { accept: [markdown, jsonApi], contentType: [jsonApi] };

const ACCEPT = [
  Option.none(),
  ...[
    "application/vnd.api+json",
    "APPLICATION/VND.API+JSON",
    "application/vnd.api+json;profile=https://x",
    `application/vnd.api+json;ext="${ATOMIC}"`,
    `application/vnd.api+json;ext=${ATOMIC}`,
    'application/vnd.api+json;ext="https://other"',
    "application/vnd.api+json;version=1",
    "application/vnd.api+json;version=1, application/vnd.api+json",
    "application/vnd.api+json;q=0",
    "application/vnd.api+json;q=abc",
    "application/vnd.api+json;q, text/html;q=0.5",
    "application/vnd.api+json;q=0.5, text/html;q=0.9",
    "application/vnd.api+json, text/html",
    "application/vnd.api+json, text/markdown",
    "text/html",
    "text/html,*/*;q=0.8",
    "application/json",
    "*/*",
    "text/markdown",
    "text/markdown;charset=utf-8",
    "text/markdown;q=xyz",
  ].map(Option.some),
];

const CONTENT_TYPE = [
  Option.none(),
  ...[
    "application/vnd.api+json",
    "APPLICATION/VND.API+JSON",
    "application/vnd.api+json;profile=https://x",
    `application/vnd.api+json;ext="${ATOMIC}"`,
    `application/vnd.api+json;ext=${ATOMIC}`,
    'application/vnd.api+json;ext="https://other"',
    "application/vnd.api+json;version=1",
    "application/vnd.api+json;charset=utf-8",
    "application/json",
    "text/markdown",
  ].map(Option.some),
];

const READS = ["GET", "HEAD"];
const WRITES = ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

const API_READ = "HDDDDDNNDHDDHDDHHHHHHH";
const API_WRITE = "HDDDDDUUUHH";
const PAGE_READ = "HHHHHHHHHHHHHHHHHHHHHH";
const PAGE_WRITE = "HHHHHHHHHHH";

/** Each path's expected read and write rows (`OPTIONS` never negotiates). */
const PATHS: ReadonlyArray<readonly [path: string, read: string, write: string]> = [
  ["/comments", API_READ, API_WRITE],
  ["/comments/0b9aab8a-3d24-4b85-a3a6-046cba9856ce", API_READ, API_WRITE],
  ["/about", PAGE_READ, PAGE_WRITE],
  ["/operations", API_READ, API_WRITE],
  ["/operations/", API_READ, API_WRITE],
];

const code = (verdict: Negotiation): string =>
  Negotiation.$match(verdict, {
    Selected: ({ representation }) =>
      representation === jsonApi ? "D" : representation === markdown ? "M" : "?",
    Fallback: () => "H",
    NotAcceptable: () => "N",
    UnsupportedMediaType: () => "U",
  });

const row = (
  method: string,
  path: string,
  header: string,
  values: ReadonlyArray<Option.Option<string>>,
): string =>
  values
    .map((value) =>
      code(
        negotiateWebRequest(
          new Request(`${ORIGIN}${path}`, {
            method,
            headers: Option.match(value, { onNone: () => ({}), onSome: (v) => ({ [header]: v }) }),
          }),
          options,
        ),
      ),
    )
    .join("");

describe("negotiate matrix (gardeneria's 495-shape golden)", () => {
  PATHS.forEach(([path, read, write]) => {
    READS.forEach((method) => {
      it(`${method} ${path}`, () => {
        expect(row(method, path, "accept", ACCEPT)).toBe(read);
      });
    });
    WRITES.forEach((method) => {
      it(`${method} ${path}`, () => {
        expect(row(method, path, "content-type", CONTENT_TYPE)).toBe(
          method === "OPTIONS" ? PAGE_WRITE : write,
        );
      });
    });
  });

  it("covers 495 shapes", () => {
    expect(
      PATHS.length * (READS.length * ACCEPT.length + WRITES.length * CONTENT_TYPE.length),
    ).toBe(495);
  });
});
