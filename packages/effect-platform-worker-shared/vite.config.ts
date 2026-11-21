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
    AppBadge: "src/AppBadge.ts",
    Serial: "src/Serial.ts",
    Usb: "src/Usb.ts",
    WorkerScope: "src/WorkerScope.ts",
    WorkerRuntime: "src/WorkerRuntime.ts",
    WorkerMessaging: "src/WorkerMessaging.ts",
    CookieStore: "src/CookieStore.ts",
    EventSource: "src/EventSource.ts",
    Performance: "src/Performance.ts",
    TaskScheduler: "src/TaskScheduler.ts",
    BrowserFileSystem: "src/BrowserFileSystem.ts",
    MemoryFileSystemHandle: "src/MemoryFileSystemHandle.ts",
  },
});
