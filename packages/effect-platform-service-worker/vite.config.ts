import { type CoverageFloor, packageConfig } from "../../vite.package.ts";

// Coverage ratchet: the measured % at adoption (in the comments),
// rounded down to the integer. Raise a metric as coverage rises; never lower one.
export const coverageFloor: CoverageFloor = {
  lines: 100, // 100
  branches: 96, // 96.66
  functions: 98, // 98.75
  statements: 99, // 99.19
};

export default packageConfig({
  coverageFloor,
  entry: {
    index: "src/index.ts",
    Clients: "src/Clients.ts",
    ServiceWorkerContainer: "src/ServiceWorkerContainer.ts",
  },
});
