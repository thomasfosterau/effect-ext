---
"@thomasfosterau/effect-platform-browser": minor
---

Adds `FileDrop` to effect-platform-browser: `drops(target)` streams each drop onto an element as its items, each a `File` or `Directory` handle (Chromium's `getAsFileSystemHandle`, the same handles `FilePicker` returns, so a dropped directory becomes a `FileSystem` through `BrowserFileSystem`) or, where the agent has none, a `Blob` with the dropped `File`. `BrowserTesting` gains `TestFileDrop`, a drop target whose `Control` drops paths from an in-memory disk.
