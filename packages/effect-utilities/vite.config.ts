import { type CoverageFloor, distExportsPackageConfig } from "../../vite.package.ts";

// Coverage ratchet: the measured % (in the comments) when effect-web's
// modules were merged in, rounded down to the integer. Raise a metric as
// coverage rises; never lower one.
export const coverageFloor: CoverageFloor = {
  lines: 98, // 98.43
  branches: 92, // 92.28
  functions: 97, // 97.12
  statements: 97, // 97.57
};

export default distExportsPackageConfig({
  coverageFloor,
  url: import.meta.url,
  name: "@thomasfosterau/effect-utilities",
  entries: [
    "index",
    "Allocator",
    "Ast",
    "AtomFeed",
    "Bounded",
    "Browser",
    "BrowserTesting",
    "BufferStruct",
    "Css",
    "Encoding",
    "EncodingBig5",
    "EncodingEucKr",
    "EncodingGb18030",
    "EncodingJapanese",
    "Ids",
    "Issues",
    "JsonFeed",
    "Langtag",
    "LangtagRegistry",
    "Layout",
    "LiteralExact",
    "Mime",
    "Negotiate",
    "Net",
    "Observability",
    "Robots",
    "RssFeed",
    "ServiceWorker",
    "Sitemap",
    "Str",
    "String",
    "StructOfArrays",
    "TriState",
    "UriTemplate",
    "Url",
    "Vec",
    "Web",
  ],
});
