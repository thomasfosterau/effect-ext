import { type CoverageFloor, packageConfig } from "../../vite.package.ts";

// Coverage ratchet: the measured % at adoption (in the comments),
// rounded down to the integer. Raise a metric as coverage rises; never lower one.
export const coverageFloor: CoverageFloor = {
  lines: 100, // 100
  branches: 100, // 100
  functions: 100, // 100
  statements: 100, // 100
};

export default packageConfig({
  coverageFloor,
  entry: {
    index: "src/index.ts",
    Clients: "src/Clients.ts",
  },
});
