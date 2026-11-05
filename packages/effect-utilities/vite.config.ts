import { type CoverageFloor, distExportsPackageConfig } from "../../vite.package.ts";

// Coverage ratchet: the measured % when the AI packages' ratchet reached it
// (in the comments), rounded down to the integer. Raise a metric as coverage
// rises; never lower one.
export const coverageFloor: CoverageFloor = {
  lines: 96, // 96.14
  branches: 87, // 87.09
  functions: 93, // 93.65
  statements: 94, // 94.45
};

export default distExportsPackageConfig({
  coverageFloor,
  url: import.meta.url,
  name: "@thomasfosterau/effect-utilities",
  entries: [
    "index",
    "Allocator",
    "Ast",
    "Bounded",
    "BufferStruct",
    "Ids",
    "Issues",
    "Layout",
    "LiteralExact",
    "Str",
    "String",
    "StructOfArrays",
    "TriState",
    "Url",
    "Vec",
  ],
});
