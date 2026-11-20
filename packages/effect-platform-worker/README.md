# @thomasfosterau/effect-platform-worker

[Effect](https://effect.website) utilities for dedicated and shared web workers: each one's own global, its name and lifecycle, and the pages it talks to as schema-typed endpoints. It builds on [`@thomasfosterau/effect-platform-worker-shared`](../effect-platform-worker-shared). For request / response work between a page and a worker, use `effect/workers` with `@effect/platform-browser`'s `BrowserWorker` and `BrowserWorkerRunner`; this package covers what they do not.

> [!CAUTION]
> Experimental and pre-1.0. APIs may change between minor versions; pin what you use.

## Install

```sh
pnpm add @thomasfosterau/effect-platform-worker effect
```

`effect` (`^4.0.0`) is a peer dependency: keep a single copy in your app. `@thomasfosterau/effect-platform-worker-shared` comes with it.

## Example

A shared worker that greets each page that connects:

```ts
import { Effect, Schema, Stream } from "effect";
import { WorkerRuntime } from "@thomasfosterau/effect-platform-worker-shared";
import { SharedWorker } from "@thomasfosterau/effect-platform-worker";

const Hello = Schema.Struct({ hello: Schema.String });

const program = SharedWorker.endpoints({ send: Hello, receive: Hello }).pipe(
  Stream.runForEach((page) => page.send({ hello: "from the shared worker" })),
);

WorkerRuntime.runMain(program);
```

## Modules

| Module | What it is |
| --- | --- |
| `DedicatedWorker` | The `DedicatedWorkerGlobalScope` as a stubbable reference: `name`, `close`, and the parent page as an endpoint. |
| `SharedWorker` | The `SharedWorkerGlobalScope` as a stubbable reference: `name`, `close`, and each `connect` as a port or an endpoint stream. |
