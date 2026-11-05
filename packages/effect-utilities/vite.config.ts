import { packageConfig } from "../../vite.package.ts";

export default packageConfig({
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
