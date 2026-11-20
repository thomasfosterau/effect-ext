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
| `Performance` | High-resolution time, user timing and the performance timeline, the same in a window and every worker: a `Context.Reference` defaulting to the ambient `performance` and `PerformanceObserver`; `now`, `mark`, `measure` (`Option` of the entry), `observe(type, options?)` as a stream (buffered entries first), and `timed(name)`, which records how long an effect ran as a measure. Every failure is a `PerformanceError`. |
| `BrowserFileSystem` | Effect's `FileSystem` over the origin-private file system (`navigator.storage.getDirectory()`), in a window and every worker: `layer` (with `Path`), or `layerHandle(directory)` over any `FileSystemDirectoryHandle`, such as one a picker returned. A DOMException becomes the matching `SystemError` reason; what OPFS cannot do (permissions, links, times, `watch`) fails `Unknown`. Each write goes through its own writable, so it lands whole on close. |
| `MemoryFileSystemHandle` | An in-memory `FileSystemDirectoryHandle` that follows the platform's rules, for tests under Node and for the `FilePicker` double. |
| `WorkerMessaging` | Schema-typed `postMessage` endpoints over any port, collecting transferables through `effect/workers/Transferable`; a scoped `MessageChannel`. |
