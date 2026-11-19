import { type CoverageFloor, packageConfig } from "../../vite.package.ts";

// Coverage ratchet: the last measured % (in the comments),
// rounded down to the integer. Raise a metric as coverage rises; never lower one.
export const coverageFloor: CoverageFloor = {
  lines: 95, // 95.44
  branches: 81, // 81.41
  functions: 93, // 93.84
  statements: 95, // 95.53
};

export default packageConfig({
  coverageFloor,
  entry: {
    index: "src/index.ts",
    CohereClassifierModel: "src/CohereClassifierModel.ts",
    CohereClient: "src/CohereClient.ts",
    CohereEmbeddingModel: "src/CohereEmbeddingModel.ts",
    CohereLanguageModel: "src/CohereLanguageModel.ts",
    CohereRerankerModel: "src/CohereRerankerModel.ts",
  },
});
