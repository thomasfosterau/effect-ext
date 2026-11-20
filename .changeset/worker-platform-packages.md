---
"@thomasfosterau/effect-platform-worker-shared": minor
"@thomasfosterau/effect-platform-worker": minor
"@thomasfosterau/effect-platform-service-worker": minor
---

New packages. `effect-platform-worker-shared`: the worker global as a context reference, a worker `runMain`, and schema-typed `postMessage` endpoints. `effect-platform-worker`: dedicated and shared worker globals, their names and lifecycle, and their pages as endpoints. `effect-platform-service-worker`: Cache Storage, the caching strategies and `fetch` routes, extendable-event listeners, persistent notifications and the worker's clients, all from inside the worker. Its `Caches`, `Fetch`, `Events` and `Notifications` modules are effect-ext's former `ServiceWorker` subpath.
