import { type CoverageFloor, distExportsPackageConfig } from "../../vite.package.ts";

// Coverage ratchet: the last measured % (in the comments), rounded down.
// Raise a metric as coverage rises; never lower one.
export const coverageFloor: CoverageFloor = {
  lines: 99, // 99.01
  branches: 93, // 93.88
  functions: 98, // 98.14
  statements: 98, // 98.23
};

/** The AI service abstractions. */
const aiModules = [
  "ClassifierModel",
  "ImageModel",
  "ModerationModel",
  "RerankerModel",
  "SpeechModel",
  "TranscriptionModel",
  "VoiceConversionModel",
];

/** The evals toolkit: one subpath per module under `./evals/`, beside the barrel. */
const evalsModules = [
  "Cache",
  "Dataset",
  "EvalCase",
  "EvalFile",
  "Golden",
  "Metadata",
  "Metric",
  "Reporter",
  "Result",
  "Runner",
  "Score",
  "Scorer",
  "Threshold",
  "metrics/GEval",
  "metrics/Ranking",
  "metrics/rag/AnswerRelevancy",
  "metrics/rag/ContextualPrecision",
  "metrics/rag/ContextualRecall",
  "metrics/rag/ContextualRelevancy",
  "metrics/rag/ExtractThenClassify",
  "metrics/rag/Faithfulness",
  "metrics/rag/RagCase",
  "scorers/EmbeddingSimilarity",
  "scorers/ExactMatch",
  "scorers/JsonValidity",
  "scorers/Levenshtein",
  "scorers/SchemaMatch",
  "scorers/ToolCallCorrectness",
];

/** Stricter floors for two families, on top of `coverageFloor`. Never lower one. */
export const coverageGlobFloors = {
  [`src/{${aiModules.join(",")}}.ts`]: {
    lines: 100, // 100
    branches: 98, // 98.78
    functions: 100, // 100
    statements: 100, // 100
  },
  "src/evals/**": {
    lines: 99, // 99.07
    branches: 94, // 94.05
    functions: 99, // 99.68
    statements: 98, // 98.68
  },
} satisfies Readonly<Record<string, CoverageFloor>>;

export default distExportsPackageConfig({
  coverageFloor,
  coverageGlobFloors,
  // The CLI's entry point: a thin, side-effecting launcher whose parts are
  // covered directly.
  coverageExclude: ["src/evals/cli/main.ts"],
  url: import.meta.url,
  name: "@thomasfosterau/effect-ext",
  entries: [
    "index",
    "Allocator",
    "ArithmeticError",
    "Ast",
    "AtomFeed",
    "Bounded",
    "BufferStruct",
    "Checked",
    "Clamped",
    "Complex",
    "CronExpression",
    "Css",
    "Encoding",
    "EncodingBig5",
    "EncodingEucKr",
    "EncodingGb18030",
    "EncodingJapanese",
    "F32",
    "FixedInt",
    "Float",
    "I8",
    "I16",
    "I32",
    "I64",
    "I128",
    "IanaTimeZone",
    "Ids",
    "Integer",
    "IsoDuration",
    "Issues",
    "JsonFeed",
    "Langtag",
    "LangtagRegistry",
    "Layout",
    "LiteralExact",
    "Mime",
    "Negotiate",
    "Net",
    "Num",
    "Observability",
    "OptionalKey",
    "Overflowing",
    "PosixTz",
    "Range",
    "Ratio",
    "Rfc3339",
    "Rfc9557",
    "Robots",
    "RRule",
    "RssFeed",
    "Saturating",
    "Sitemap",
    "Str",
    "String",
    "StructOfArrays",
    "TriState",
    "Tzif",
    "U8",
    "U16",
    "U32",
    "U64",
    "U128",
    "UriTemplate",
    "Url",
    "Vec",
    "Web",
    "Wrapping",
    ...aiModules,
    "evals/index",
    ...evalsModules.map((module) => `evals/${module}`),
    // Built, not exported: the `effect-evals` bin runs `dist/evals/cli/main.js`
    // (`bin/effect-evals.js`), because Node refuses to type-strip anything
    // under `node_modules`.
    "evals/cli/main",
  ],
});
