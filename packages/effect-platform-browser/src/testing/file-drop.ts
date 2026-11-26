/**
 * A drop target for tests of code that uses `FileDrop`: {@link make} builds
 * an in-memory element and a {@link Control} that drops files and
 * directories from an in-memory disk onto it, as the browser would.
 *
 * @since 0.2.0
 */
import * as BrowserFileSystem from "@thomasfosterau/effect-platform-worker-shared/BrowserFileSystem";
import type {
  DirectoryHandleLike,
  FileHandleLike,
} from "@thomasfosterau/effect-platform-worker-shared/BrowserFileSystem";
import * as MemoryFileSystemHandle from "@thomasfosterau/effect-platform-worker-shared/MemoryFileSystemHandle";
import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import type { DataTransferItemLike, DragEventLike, DropTargetLike } from "../FileDrop.ts";

/**
 * The drop target's behaviour: `handles` (default `true`) gives each item
 * Chromium's `getAsFileSystemHandle`; `false` is every other browser,
 * where a drop yields only `File`s.
 *
 * @since 0.2.0
 * @category models
 */
export interface Options {
  readonly handles?: boolean;
}

/**
 * Drives the drop target.
 *
 * - `disk` — a `FileSystem` over the disk drops come from: seed it first.
 * - `listening` — waits until something listens for drops on the target.
 * - `drop` — drops these disk paths (files or directories) in one drop.
 * - `dropText` — drops dragged text: an item that is not a file.
 * - `prevented` — how many `dragover` and `drop` events had their default
 *   prevented, which is what makes the element a drop target.
 *
 * @since 0.2.0
 * @category models
 */
export interface Control {
  readonly disk: FileSystem.FileSystem;
  readonly listening: Effect.Effect<void>;
  readonly drop: (paths: Arr.NonEmptyReadonlyArray<string>) => Effect.Effect<void>;
  readonly dropText: Effect.Effect<void>;
  readonly prevented: Effect.Effect<number>;
}

/**
 * What {@link make} builds: the element to pass to `FileDrop.drops`, and
 * the {@link Control} that drops onto it.
 *
 * @since 0.2.0
 * @category models
 */
export interface Fixture {
  readonly target: DropTargetLike;
  readonly control: Control;
}

type Listener = (event: DragEventLike) => void;

/** An element that dispatches drag events to its listeners, and counts its `drop` listeners. */
class TestDropTarget implements DropTargetLike {
  #listeners: ReadonlyArray<{ readonly type: string; readonly listener: Listener }> = [];
  get dropListeners(): number {
    return Arr.filter(this.#listeners, (entry) => entry.type === "drop").length;
  }
  addEventListener(type: string, listener: Listener): void {
    this.#listeners = Arr.append(this.#listeners, { type, listener });
  }
  removeEventListener(type: string, listener: Listener): void {
    this.#listeners = Arr.filter(
      this.#listeners,
      (entry) => entry.type !== type || entry.listener !== listener,
    );
  }
  dispatch(type: string, event: DragEventLike): void {
    Arr.forEach(this.#listeners, (entry) => {
      if (entry.type === type) entry.listener(event);
    });
  }
}

/** A dropped disk entry: its handle, and its bytes for a file. */
interface Entry {
  readonly handle: FileHandleLike | DirectoryHandleLike;
  readonly file: Option.Option<File>;
}

const entryAt = (root: DirectoryHandleLike, path: string): Promise<Entry> => {
  const parts = BrowserFileSystem.segments(path);
  const name = Option.getOrElse(Arr.last(parts), () => "");
  const parent = Arr.reduce(Arr.dropRight(parts, 1), Promise.resolve(root), (directory, part) =>
    directory.then((self) => self.getDirectoryHandle(part)),
  );
  return parent.then((directory) =>
    directory.getFileHandle(name).then(
      (handle) =>
        handle
          .getFile()
          .then((stored) => stored.slice().arrayBuffer())
          .then((bytes) => ({ handle, file: Option.some(new File([bytes], handle.name)) })),
      () => directory.getDirectoryHandle(name).then((handle) => ({ handle, file: Option.none() })),
    ),
  );
};

/**
 * Builds an in-memory drop target over an empty disk, and its
 * {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Fiber from "effect/Fiber"
 * import * as Stream from "effect/Stream"
 * import { FileDrop } from "@thomasfosterau/effect-platform-browser"
 * import { TestFileDrop } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const { target, control } = TestFileDrop.make()
 * const program = Effect.gen(function* () {
 *   yield* control.disk.makeDirectory("/photos")
 *   const fiber = yield* Effect.forkChild(Stream.runHead(FileDrop.drops(target)))
 *   yield* control.listening
 *   yield* control.drop(["/photos"])
 *   return yield* Fiber.join(fiber)
 * })
 * Effect.runPromise(program).then(console.log) // Some([{ _tag: "Directory", handle: … }])
 * ```
 *
 * @since 0.2.0
 * @category constructors
 */
export const make = (options?: Options): Fixture => {
  const root = MemoryFileSystemHandle.make();
  const target = new TestDropTarget();
  const withHandles = options?.handles !== false;
  let prevented = 0;
  const dispatch = (type: string, items: ReadonlyArray<DataTransferItemLike>) =>
    target.dispatch(type, {
      preventDefault: () => {
        prevented += 1;
      },
      dataTransfer: { items },
    });
  /** Drops `items`; as in the browser, they read as empty once the drop's listeners return. */
  const dropItems = (build: (live: () => boolean) => ReadonlyArray<DataTransferItemLike>) => {
    let live = true;
    const items = build(() => live);
    dispatch("dragover", []);
    dispatch("drop", items);
    live = false;
  };
  const fileItem =
    (live: () => boolean) =>
    (entry: Entry): DataTransferItemLike => {
      const getAsFile = () => (live() ? Option.getOrNull(entry.file) : null);
      return withHandles
        ? {
            kind: "file",
            getAsFile,
            getAsFileSystemHandle: () => Promise.resolve(live() ? entry.handle : null),
          }
        : { kind: "file", getAsFile };
    };
  return {
    target,
    control: {
      disk: BrowserFileSystem.make(root),
      listening: Effect.asVoid(
        Effect.repeat(
          Effect.map(Effect.yieldNow, () => target.dropListeners),
          { until: (count) => count > 0 },
        ),
      ),
      drop: (paths) =>
        Effect.map(
          Effect.orDie(
            Effect.tryPromise({
              try: () => Promise.all(Arr.map(paths, (path) => entryAt(root, path))),
              catch: (cause) => new Cause.UnknownError(cause),
            }),
          ),
          (entries) => dropItems((live) => Arr.map(entries, fileItem(live))),
        ),
      dropText: Effect.sync(() =>
        dropItems(() => [
          {
            kind: "string",
            getAsFile: () => null,
            getAsFileSystemHandle: () => Promise.resolve(null),
          },
        ]),
      ),
      prevented: Effect.sync(() => prevented),
    },
  };
};
