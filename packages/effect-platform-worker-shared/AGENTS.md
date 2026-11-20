# @thomasfosterau/effect-platform-worker-shared

What every worker global shares (`WorkerGlobalScope`, and what it has in common with a window, such as `performance`), for `effect-platform-worker` and `effect-platform-service-worker` to build on, as `@effect/platform-node-shared` serves `@effect/platform-node` and `@effect/platform-bun`.

## Boundary

Peer: `effect` only. Imports nothing from this workspace (`.fallowrc.json` zone `worker-shared`, no outbound rule). The two platform packages depend on it (`workspace:*`, a regular dependency) and may import any of its subpaths.

## Invariants

- **No global is read at import, and none in a constructor.** The worker global is a `Context.Reference` of an `Option`, defaulting to `globalThis` only when it is an instance of the realm's own scope constructor (`isInstanceOfGlobal`); `WorkerRuntime.runMain` reads `globalThis` when called. A page or Node sees `Option.none()` and every accessor fails with a tagged error. `Performance` is a `Context.Reference` too, built over the ambient `performance` on first read (a window, a worker and Node all have one).
- **`BrowserFileSystem` is Effect's `FileSystem`, not a new API.** It implements `effect/FileSystem` over a `DirectoryHandleLike` (OPFS, or a handle a page's picker returned), mapping each `DOMException` name onto a `SystemError` tag; what OPFS cannot do fails `Unknown`. `MemoryFileSystemHandle` follows the platform's rules (swap-file writables, the same rejections), so a test of it is a test of the adapter.
- **Structural types, `dom` lib.** Each platform object is a `*Like` interface (the slice the code calls), so the package compiles without the `webworker` lib and a test hands in an `EventTarget`.
- **A received message is untrusted.** `WorkerMessaging.endpoint` decodes each against its schema and drops, with a warning log, one that does not decode or deserialise; a long-lived stream never fails over one bad message.
- **Encoding collects transferables.** `endpoint`'s `send` encodes with a fresh `Transferable.Collector` in context and transfers what it collected; `raw`'s `sendTransfer` takes the list itself.
- **`subscribe` attaches the listener before returning** (the race-free form), and closing its scope ends the stream.
- **Uncaught errors are logged through the main fiber's context**, so a logger provided at the program's root sees them, and the listeners come off when the fiber ends.

## Terms

- **Endpoint** — one side of a `postMessage` conversation: `send`, `subscribe`, `messages`.
- **Protocol** — the `send` and `receive` schemas an endpoint speaks.
