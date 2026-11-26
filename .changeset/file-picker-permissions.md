---
"@thomasfosterau/effect-platform-browser": minor
---

Adds handle permissions to `FilePicker`: `permission(handle, mode)` reads a file or directory handle's permission (`granted`, `denied` or `prompt`) and `requestPermission(handle, mode)` asks the user for it, failing `NotAllowed` without a user gesture. `fileSystem` takes a stored directory `handle` in place of the picker, asking for the permission it lacks first. `TestFilePicker`'s `Control` gains `stored`, `setPermission`, `respondToRequest` and `permissionRequests`, and the handles it picks answer permission calls.
