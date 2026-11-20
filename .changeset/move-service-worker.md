---
"@thomasfosterau/effect-ext": minor
---

Breaking: the `ServiceWorker` subpath and barrel namespace are removed. They now live in `@thomasfosterau/effect-platform-service-worker`, split into `Caches`, `Fetch`, `Events` and `Notifications`; change the import to the module each name moved to. `fetchRequest` and the strategies fail with that package's `Fetch.FetchFailed` (same `_tag` and fields as `Net.FetchFailed`).
