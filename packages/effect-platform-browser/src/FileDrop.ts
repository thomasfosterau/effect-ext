/**
 * Files and directories dropped onto an element, as handles: in Chromium
 * each dropped item becomes a file or directory handle
 * (`DataTransferItem.getAsFileSystemHandle`), the same handles the
 * `FilePicker` pickers return, so a dropped directory becomes an Effect
 * `FileSystem` through `effect-platform-worker-shared`'s
 * `BrowserFileSystem`. Where that API is missing, each dropped file is a
 * plain `File`.
 *
 * @since 0.2.0
 */
import type {
  DirectoryHandleLike,
  FileHandleLike,
} from "@thomasfosterau/effect-platform-worker-shared/BrowserFileSystem";
import * as Arr from "effect/Array";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

/**
 * One dropped item: a file or directory handle, or, where the agent has no
 * handles for drops (every browser but Chromium, or a handle it refused),
 * the dropped `File`.
 *
 * @since 0.2.0
 * @category models
 */
export type DroppedItem = Data.TaggedEnum<{
  File: { readonly handle: FileHandleLike };
  Directory: { readonly handle: DirectoryHandleLike };
  Blob: { readonly file: File };
}>;

/**
 * Constructors and matchers for {@link DroppedItem}.
 *
 * @example
 * ```ts
 * import { FileDrop } from "@thomasfosterau/effect-platform-browser"
 *
 * const item = FileDrop.DroppedItem.Blob({ file: new File(["hi"], "hi.txt") })
 * console.log(FileDrop.DroppedItem.$is("Blob")(item)) // true
 * ```
 *
 * @since 0.2.0
 * @category models
 */
export const DroppedItem = /*#__PURE__*/ Data.taggedEnum<DroppedItem>();

/**
 * The slice of a `DataTransferItem` this module calls.
 * `getAsFileSystemHandle` is Chromium's; `getAsFile` is `null` for an item
 * that is not a file.
 *
 * @since 0.2.0
 * @category models
 */
export interface DataTransferItemLike {
  readonly kind: string;
  getAsFile(): File | null;
  getAsFileSystemHandle?(): Promise<FileHandleLike | DirectoryHandleLike | null>;
}

/**
 * The slice of a `DragEvent` this module reads: its items (`dataTransfer`
 * is `null` for a synthetic event), and `preventDefault`, which marks the
 * element as a drop target and stops the browser opening the file.
 *
 * @since 0.2.0
 * @category models
 */
export interface DragEventLike {
  preventDefault(): void;
  readonly dataTransfer: { readonly items: Iterable<DataTransferItemLike> } | null;
}

/**
 * The element (or any event target) drops land on.
 *
 * @since 0.2.0
 * @category models
 */
export type DropTargetLike = Stream.EventListener<DragEventLike>;

/**
 * A file item, read while the `drop` event is dispatched: the browser
 * empties the items once the listener returns, so both readings start
 * then.
 */
const readItem = (item: DataTransferItemLike): Promise<Option.Option<DroppedItem>> => {
  const blob = Option.map(Option.fromNullishOr(item.getAsFile()), (file) =>
    DroppedItem.Blob({ file }),
  );
  if (item.getAsFileSystemHandle === undefined) return Promise.resolve(blob);
  return item.getAsFileSystemHandle().then(
    (handle) =>
      handle === null
        ? blob
        : Option.some(
            handle.kind === "file"
              ? DroppedItem.File({ handle })
              : DroppedItem.Directory({ handle }),
          ),
    () => blob,
  );
};

const onDragOver = (event: DragEventLike): void => event.preventDefault();

/**
 * Every drop onto `target`, as the items dropped, in order; a drop with no
 * file in it (dragged text, a link) is skipped. While the stream runs,
 * `target` accepts drops: its `dragover` and `drop` events have their
 * default prevented, so the browser does not open a dropped file itself.
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
 *   yield* control.disk.writeFileString("/notes.txt", "hi")
 *   const fiber = yield* Effect.forkChild(Stream.runHead(FileDrop.drops(target)))
 *   yield* control.listening
 *   yield* control.drop(["/notes.txt"])
 *   return yield* Fiber.join(fiber)
 * })
 * Effect.runPromise(program).then(console.log) // Some([{ _tag: "File", handle: … }])
 * ```
 *
 * @since 0.2.0
 * @category streams
 */
export const drops = (
  target: DropTargetLike,
): Stream.Stream<Arr.NonEmptyReadonlyArray<DroppedItem>> =>
  Stream.callback<Arr.NonEmptyReadonlyArray<DroppedItem>>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        let previous: Promise<void> = Promise.resolve();
        const onDrop = (event: DragEventLike) => {
          event.preventDefault();
          const files = Arr.filter(
            Arr.fromIterable(event.dataTransfer?.items ?? []),
            (item) => item.kind === "file",
          );
          const read = Promise.all(Arr.map(files, readItem));
          previous = previous
            .then(() => read)
            .then((settled) => {
              const dropped = Arr.getSomes(settled);
              return Arr.isReadonlyArrayNonEmpty(dropped)
                ? void Queue.offerUnsafe(queue, dropped)
                : undefined;
            });
        };
        target.addEventListener("dragover", onDragOver);
        target.addEventListener("drop", onDrop);
        return onDrop;
      }),
      (onDrop) =>
        Effect.sync(() => {
          target.removeEventListener("dragover", onDragOver);
          target.removeEventListener("drop", onDrop);
        }),
    ),
  );
