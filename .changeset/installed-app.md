---
"@thomasfosterau/effect-platform-worker-shared": minor
"@thomasfosterau/effect-platform-browser": minor
---

Add `AppBadge` to effect-platform-worker-shared: the Badging API (`set(count?)`, `clear`) from a window or a service worker, as a context reference over the ambient `navigator`.

Add `InstalledApp` to effect-platform-browser: the deferred install prompt (`installPrompt`, `installable`, `prompt`), `installed`, the launch queue's `launches` (with file handles), `relatedApps`, and `displayMode` / `displayModeChanges` over `MediaQuery`. `Browser.layer` includes it. `BrowserTesting` adds `TestInstalledApp` and `TestAppBadge`.
