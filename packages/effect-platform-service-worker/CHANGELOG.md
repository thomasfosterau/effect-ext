# @thomasfosterau/effect-platform-service-worker

## 0.1.0

### Minor Changes

- [#197](https://github.com/thomasfosterau/effect-ext/pull/197) [`41de55f`](https://github.com/thomasfosterau/effect-ext/commit/41de55fb03e247a2bafd2e53d847d58ce8d84259) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Peer on `effect` `^4.1.0` (and `@effect/platform-browser` `^4.1.0` for the browser package). They use `FileSystem.DirectoryEntry`, `FileSystem.lstat` and `Semaphore.takeScoped`, which first shipped in Effect 4.1.0, so the old `^4.0.0` range was never met.

- [#171](https://github.com/thomasfosterau/effect-ext/pull/171) [`f29bb3a`](https://github.com/thomasfosterau/effect-ext/commit/f29bb3a9265b2daf3fb5f94009fb3d73955b02ce) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - `Events.pushListener`, `syncListener` and `periodicSyncListener`; the `NavigationPreload` module and `Fetch.withNavigationPreload`; and `ServiceWorkerRunner`, an `effect/workers` runner platform whose clients are pages, each connected over its own `MessagePort`.

- [#165](https://github.com/thomasfosterau/effect-ext/pull/165) [`36f1784`](https://github.com/thomasfosterau/effect-ext/commit/36f1784a83a61c7a122fc670b627461c89335b2f) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - New packages. `effect-platform-worker-shared`: the worker global as a context reference, a worker `runMain`, and schema-typed `postMessage` endpoints. `effect-platform-worker`: dedicated and shared worker globals, their names and lifecycle, and their pages as endpoints. `effect-platform-service-worker`: Cache Storage, the caching strategies and `fetch` routes, extendable-event listeners, persistent notifications and the worker's clients, all from inside the worker. Its `Caches`, `Fetch`, `Events` and `Notifications` modules are effect-ext's former `ServiceWorker` subpath.

### Patch Changes

- Updated dependencies [[`a69b6e8`](https://github.com/thomasfosterau/effect-ext/commit/a69b6e8f38252134fbf2759f402bddf9ea385538), [`36a0426`](https://github.com/thomasfosterau/effect-ext/commit/36a04261a50ddffc5a3644253608d0646f279e1b), [`3819ce1`](https://github.com/thomasfosterau/effect-ext/commit/3819ce16c7aac48abee4dab6a5fa7aa6d5f3e589), [`7d93aac`](https://github.com/thomasfosterau/effect-ext/commit/7d93aac4d55404268eb9220ce51aa25f137ad460), [`bc03884`](https://github.com/thomasfosterau/effect-ext/commit/bc03884599326079978301f98d922b4031156280), [`147be83`](https://github.com/thomasfosterau/effect-ext/commit/147be83ee06f5ad000bcf418cfafa0871ab3d1da), [`41de55f`](https://github.com/thomasfosterau/effect-ext/commit/41de55fb03e247a2bafd2e53d847d58ce8d84259), [`32689b6`](https://github.com/thomasfosterau/effect-ext/commit/32689b608ab4a6425ada98d6e53c4a98a1ad6cd8), [`6516e9a`](https://github.com/thomasfosterau/effect-ext/commit/6516e9a3532092b296755cf33ff82cb86e823cf2), [`2b05221`](https://github.com/thomasfosterau/effect-ext/commit/2b05221d425df5597537142f436b59413589a3f9), [`36f1784`](https://github.com/thomasfosterau/effect-ext/commit/36f1784a83a61c7a122fc670b627461c89335b2f)]:
  - @thomasfosterau/effect-platform-worker-shared@0.1.0
