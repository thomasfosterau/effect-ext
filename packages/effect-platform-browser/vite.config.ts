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
    Battery: "src/Battery.ts",
    Broadcast: "src/Broadcast.ts",
    Browser: "src/Browser.ts",
    BrowserTesting: "src/BrowserTesting.ts",
    Credentials: "src/Credentials.ts",
    DomObservers: "src/DomObservers.ts",
    Fullscreen: "src/Fullscreen.ts",
    IdleDetection: "src/IdleDetection.ts",
    Locks: "src/Locks.ts",
    MediaQuery: "src/MediaQuery.ts",
    Navigation: "src/Navigation.ts",
    Navigator: "src/Navigator.ts",
    Notifications: "src/Notifications.ts",
    PageVisibility: "src/PageVisibility.ts",
    PermissionStatus: "src/PermissionStatus.ts",
    PushManager: "src/PushManager.ts",
    ScreenOrientation: "src/ScreenOrientation.ts",
    ServiceWorkerContainer: "src/ServiceWorkerContainer.ts",
    FilePicker: "src/FilePicker.ts",
    MediaDevices: "src/MediaDevices.ts",
    SpeechRecognition: "src/SpeechRecognition.ts",
    SpeechSynthesis: "src/SpeechSynthesis.ts",
    WakeLock: "src/WakeLock.ts",
    WebVitals: "src/WebVitals.ts",
  },
});
