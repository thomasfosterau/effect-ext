---
"@thomasfosterau/effect-platform-worker-shared": minor
---

Adds sync access handles to `BrowserFileSystem`: `make(root, { syncAccess: true })`, `layerHandle(root, { syncAccess: true })` and the new `layerWorker` (OPFS in a dedicated worker) make `open` hold a `FileSystemSyncAccessHandle` for the file's scope, so reads and writes go in place under an exclusive lock instead of through a swap file each; a file already locked fails `Busy`, and a handle without sync access falls back to writables. `MemoryFileSystemHandle` gains in-memory sync access handles that lock the file as the platform does.
