# @thomasfosterau/effect-platform-worker-shared

[Effect](https://effect.website) utilities every web worker scope shares: dedicated, shared and service workers alike. It is to [`@thomasfosterau/effect-platform-worker`](../effect-platform-worker) and [`@thomasfosterau/effect-platform-service-worker`](../effect-platform-service-worker) what `@effect/platform-node-shared` is to `@effect/platform-node` and `@effect/platform-bun`. It adds what `@effect/platform-browser`'s `BrowserWorker` / `BrowserWorkerRunner` (the `effect/workers` plumbing) do not.

> [!CAUTION]
> Experimental and pre-1.0. APIs may change between minor versions; pin what you use.

## Install

```sh
pnpm add @thomasfosterau/effect-platform-worker-shared effect
```

`effect` (`^4.0.0`) is a peer dependency: keep a single copy in your app.

## Example

```ts
import { Effect, Schema, Stream } from "effect";
import { WorkerMessaging, WorkerRuntime } from "@thomasfosterau/effect-platform-worker-shared";

const Job = Schema.Struct({ id: Schema.Number });
const Done = Schema.Struct({ id: Schema.Number, ms: Schema.Number });

const program = Effect.gen(function* () {
  const page = WorkerMessaging.endpoint(self, { send: Done, receive: Job });
  yield* page.messages.pipe(Stream.runForEach((job) => page.send({ id: job.id, ms: 0 })));
});

WorkerRuntime.runMain(program);
```

## Modules

| Module | What it is |
| --- | --- |
| `WorkerScope` | The worker global as a `Context.Reference` (stubbable), `location`, `isSecureContext`, `crossOriginIsolated`, and uncaught exceptions / unhandled rejections as a `Stream`. |
| `WorkerRuntime` | `runMain` for a worker: logs uncaught errors through the main fiber's logger; `closeOnExit` ends the worker with its program. |
| `WorkerMessaging` | Schema-typed `postMessage` endpoints over any port, collecting transferables through `effect/workers/Transferable`; a scoped `MessageChannel`. |
