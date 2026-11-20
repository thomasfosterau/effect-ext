# @thomasfosterau/effect-platform-worker

Dedicated and shared web workers: the parts of `DedicatedWorkerGlobalScope` and `SharedWorkerGlobalScope` that `@effect/platform-browser` leaves out.

## Boundary

Peer: `effect`. Dependency: `@thomasfosterau/effect-platform-worker-shared` (`.fallowrc.json` zone `worker`, allowed into `worker-shared` only). Never imports `@effect/platform-browser`: its `BrowserWorkerRunner` assigns `self.onconnect` at import, which a consumer opts into by importing it themselves.

## Invariants

- The shared package's invariants hold here: no global read at import, structural `*Like` types under the `dom` lib, each scope a `Context.Reference` of an `Option` defaulting to `globalThis` only when it is that kind of worker.
- **A `connect` event without a port is skipped**, never a failure.
- **Messaging goes through `WorkerMessaging`**: `parent` and `endpoints` are its `endpoint` over the right port, never a second implementation.
