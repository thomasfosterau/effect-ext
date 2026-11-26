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
| `Performance` | High-resolution time, user timing and the performance timeline, the same in a window and every worker: a `Context.Reference` defaulting to the ambient `performance` and `PerformanceObserver`; `now`, `mark`, `measure` (`Option` of the entry), `observe(type, options?)` as a stream (buffered entries first), `timed(name)`, which records how long an effect ran as a measure, and `layerTracer(options?)`, which wraps the current `Tracer` so every span also shows as a measure. Every failure is a `PerformanceError`. |
| `TaskScheduler` | An `effect/Scheduler` that runs the Effect runtime's work as prioritised tasks through `scheduler.postTask` (falling back to a `MessageChannel`, then Effect's default), so long programs yield to input and rendering: `layer(options?)` at a program's root, `make(options?)`, `withPriority(priority)` to run an effect and its forks at `"user-blocking"`, `"user-visible"` or `"background"`, and `yieldToMain` (`scheduler.yield()` where the agent has it). |
| `AppBadge` | The Badging API, from a window or a service worker: `set(count?)` shows a count (or a plain dot without one; `0` clears it) on the installed app's icon, `clear` clears it. A count that is not a whole number from 0 up fails `InvalidCount` before the call. A `Context.Reference` defaulting to the ambient `navigator`; every failure is an `AppBadgeError` (`Unsupported`, `InvalidCount`, `NotAllowed`, `Failed`). |
| `Serial` | Web Serial, from a window or a dedicated worker: `request(options?)` opens the port picker (a window only; `supported.request` says whether it can), `ports` lists the granted ports, `connections` streams each `connect` and `disconnect`. `open(port, options)` opens a port for the scope and returns a `Connection`: `read` streams bytes (one read at a time; a recoverable line error such as `Parity` fails that read, and the next starts afresh), `write` and `writer` send bytes, `setSignals` and `signals` set and read the control lines. Closing the scope ends a running read, waits for a write to finish, then closes the port. A `Context.Reference` defaulting to the ambient `navigator.serial`; every failure is a `SerialError` carrying the `operation` and a `reason` (`Unsupported`, `NotFound`, `NotAllowed`, `InvalidState`, `Network` (unplugged), `Aborted`, `Closed`, `Break`, `Framing`, `Parity`, `BufferOverrun`, `Failed`). |
| `Usb` | WebUSB, from a window or a dedicated worker: `request({ filters })` opens the device picker (a window only; `supported.request` says whether it can), `devices` lists the granted devices, `connections` streams each `connect` and `disconnect`. `open(device, { configuration, interface, alternate? })` opens the device for the scope, selects the configuration and claims the interface, and returns a `Handle`: `transferIn(endpoint, length)` and `transferOut(endpoint, data)` for bulk and interrupt endpoints, `inbound(endpoint, length)` as a `Stream` of repeated reads, `controlTransferIn` and `controlTransferOut`, and `clearHalt`. A transfer that ends in `stall` or `babble` fails. Closing the scope releases the interface and closes the device, which aborts a transfer in flight. A `Context.Reference` defaulting to the ambient `navigator.usb`; every failure is a `UsbError` carrying the `operation` and a `reason` (`Unsupported`, `NotFound`, `NotAllowed`, `InvalidState`, `Network` (unplugged), `Aborted`, `Closed`, `Stall`, `Babble`, `Failed`). Isochronous transfers are not covered. |
| `Hid` | WebHID, from a window or a dedicated worker: `request({ filters })` opens the device picker (a window only; `supported.request` says whether it can) and returns the devices chosen (none when the user closes it), `devices` lists the granted devices, `connections` streams each `connect` and `disconnect`. `open(device)` opens the device for the scope and returns a `Handle`: `inputReports` streams each `{ reportId, data }`, `sendReport(reportId, data)` sends an output report, and `sendFeatureReport` and `receiveFeatureReport` move feature reports. Closing the scope ends `inputReports` after the reports it holds and closes the device. A `Context.Reference` defaulting to the ambient `navigator.hid`; every failure is a `HidError` carrying the `operation` and a `reason` (`Unsupported`, `NotFound`, `NotAllowed`, `InvalidState`, `Network` (unplugged), `Aborted`, `Closed`, `Failed`). |
| `CookieStore` | Cookies in a window and a service worker: `get`, `getAll`, `set` (`expires` as a `DateTime`), `remove` and a `changes` stream over the Cookie Store API, falling back to `document.cookie` (parsed and serialised with `effect/http/Cookies`; no `changes` there) where a window lacks it. `cookie(name, schema)` reads, writes and watches one cookie through a schema. A `Context.Reference` defaulting to the ambient `cookieStore`, else `document`; every failure is a `CookieStoreError`. |
| `EventSource` | Server-sent events in a window and in dedicated and shared workers: `connect(url, options?)` streams each event in `effect/encoding/Sse`'s `Event` shape (named `events`, `withCredentials`), through the browser's own reconnects with `Last-Event-ID`; `events(url, schema)` decodes each payload as JSON, dropping one that does not decode. A `Context.Reference` defaulting to the ambient `EventSource`; a fatal error fails with an `EventSourceError`. |
| `BrowserFileSystem` | Effect's `FileSystem` over the origin-private file system (`navigator.storage.getDirectory()`), in a window and every worker: `layer` (with `Path`), or `layerHandle(directory)` over any `FileSystemDirectoryHandle`, such as one a picker returned. A DOMException becomes the matching `SystemError` reason; what OPFS cannot do (permissions, links, times, `watch`) fails `Unknown`. Each write goes through its own writable, so it lands whole on close. |
| `MemoryFileSystemHandle` | An in-memory `FileSystemDirectoryHandle` that follows the platform's rules, for tests under Node and for the `FilePicker` double. |
| `WorkerMessaging` | Schema-typed `postMessage` endpoints over any port, collecting transferables through `effect/workers/Transferable`; a scoped `MessageChannel`. |
