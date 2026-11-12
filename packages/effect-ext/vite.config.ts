import { type CoverageFloor, distExportsPackageConfig } from "../../vite.package.ts";

// Coverage ratchet: the measured % (in the comments) when effect-numeric's
// and effect-time's modules were merged in, rounded down to the integer.
// It binds the whole package. Raise a metric as coverage rises; never lower one.
export const coverageFloor: CoverageFloor = {
  lines: 98, // 98.75
  branches: 93, // 93.61
  functions: 97, // 97.75
  statements: 98, // 98.03
};

/** The AI service abstractions (merged in from `@thomasfosterau/effect-ai-ext`). */
const aiModules = [
  "ClassifierModel",
  "ImageModel",
  "ModerationModel",
  "RerankerModel",
  "SpeechModel",
  "TranscriptionModel",
  "VoiceConversionModel",
];

/**
 * The evaluation toolkit (merged in from `@thomasfosterau/effect-evals`), one
 * subpath per module under `./evals/`, beside the `./evals` barrel.
 */
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

/**
 * The floors the two merged-in families arrived with (#100), each measured
 * over its own files and kept on them, on top of `coverageFloor`. Never lower
 * one.
 */
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
    "Browser",
    "BrowserTesting",
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
    "ServiceWorker",
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
