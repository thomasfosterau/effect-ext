/**
 * The File System Access pickers (`showOpenFilePicker`, `showSaveFilePicker`,
 * `showDirectoryPicker`) as an Effect service. A picked directory becomes an
 * Effect `FileSystem` through {@link fileSystem}, the same adapter
 * `BrowserFileSystem` runs over the origin-private file system.
 *
 * The pickers are Chromium-only and need a user gesture: call them from an
 * input handler. A user who closes the picker fails the call with reason
 * `Aborted`, which {@link optional} turns into `Option.none()`.
 *
 * @since 0.1.0
 */
import * as BrowserFileSystem from "@thomasfosterau/effect-platform-worker-shared/BrowserFileSystem";
import type {
  DirectoryHandleLike,
  FileHandleLike,
} from "@thomasfosterau/effect-platform-worker-shared/BrowserFileSystem";
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { reasonOf } from "./internal/dom.ts";
import { ambientFilePicker } from "./internal/globals.ts";

/**
 * A file type a picker offers: a label, and MIME types mapped to the
 * extensions they cover (`{ "text/plain": [".txt"] }`).
 *
 * @since 0.1.0
 * @category models
 */
export interface FileType {
  readonly description?: string;
  readonly accept: Readonly<Record<string, ReadonlyArray<string>>>;
}

/**
 * Where a picker opens: a well-known directory, or next to a handle the
 * page already holds.
 *
 * @since 0.1.0
 * @category models
 */
export type StartIn =
  | "desktop"
  | "documents"
  | "downloads"
  | "music"
  | "pictures"
  | "videos"
  | FileHandleLike
  | DirectoryHandleLike;

/**
 * What every picker takes: `id` remembers the last directory per purpose,
 * `startIn` sets where it opens.
 *
 * @since 0.1.0
 * @category models
 */
export interface PickerOptions {
  readonly id?: string;
  readonly startIn?: StartIn;
}

/**
 * Options for {@link FilePicker}'s `open`: `multiple` lets the user pick
 * more than one file, `types` limits what is offered, and
 * `excludeAcceptAllOption` drops the "All files" choice.
 *
 * @since 0.1.0
 * @category models
 */
export interface OpenOptions extends PickerOptions {
  readonly multiple?: boolean;
  readonly types?: ReadonlyArray<FileType>;
  readonly excludeAcceptAllOption?: boolean;
}

/**
 * Options for {@link FilePicker}'s `save`: `suggestedName` pre-fills the
 * name, and `types` / `excludeAcceptAllOption` as for {@link OpenOptions}.
 *
 * @since 0.1.0
 * @category models
 */
export interface SaveOptions extends PickerOptions {
  readonly suggestedName?: string;
  readonly types?: ReadonlyArray<FileType>;
  readonly excludeAcceptAllOption?: boolean;
}

/**
 * Options for {@link FilePicker}'s `directory`: `mode: "readwrite"` asks
 * for write access up front (the default is `"read"`).
 *
 * @since 0.1.0
 * @category models
 */
export interface DirectoryOptions extends PickerOptions {
  readonly mode?: "read" | "readwrite";
}

/**
 * The structural slice of `window` this module calls: the three pickers.
 *
 * @since 0.1.0
 * @category models
 */
export interface FilePickerLike {
  showOpenFilePicker(options?: OpenOptions): Promise<ReadonlyArray<FileHandleLike>>;
  showSaveFilePicker(options?: SaveOptions): Promise<FileHandleLike>;
  showDirectoryPicker(options?: DirectoryOptions): Promise<DirectoryHandleLike>;
}

/**
 * Why a picker returned nothing.
 *
 * - `Unsupported` — the agent has no pickers (every browser but Chromium).
 * - `Aborted` — the user closed the picker.
 * - `NotAllowed` — no user gesture, a cross-origin frame, or a blocked
 *   location.
 * - `Failed` — any other rejection; `cause` carries it.
 *
 * @since 0.1.0
 * @category errors
 */
export type FilePickerErrorReason = "Unsupported" | "Aborted" | "NotAllowed" | "Failed";

/**
 * A picker that returned nothing. `cause` carries the browser's rejection,
 * where there was one.
 *
 * @example
 * ```ts
 * import { FilePicker } from "@thomasfosterau/effect-platform-browser"
 *
 * const error = new FilePicker.FilePickerError({
 *   reason: "Aborted",
 *   method: "open",
 *   message: "file picker: Aborted",
 *   cause: undefined,
 * })
 * console.log(error.reason) // "Aborted"
 * ```
 *
 * @since 0.1.0
 * @category errors
 */
export class FilePickerError extends Schema.TaggedError<FilePickerError>()("FilePickerError", {
  reason: Schema.Literals(["Unsupported", "Aborted", "NotAllowed", "Failed"]),
  method: Schema.Literals(["open", "save", "directory"]),
  message: Schema.String,
  cause: Schema.Unknown,
}) {}

type Method = FilePickerError["method"];

const pickerError = (method: Method, reason: FilePickerErrorReason, cause: unknown) =>
  new FilePickerError({ reason, method, cause, message: `file picker: ${reason}` });

const REJECTION_REASONS = {
  AbortError: "Aborted",
  NotAllowedError: "NotAllowed",
  SecurityError: "NotAllowed",
} satisfies Readonly<Record<string, FilePickerErrorReason>>;

const call = <A>(method: Method, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => pickerError(method, reasonOf(cause, REJECTION_REASONS, "Failed"), cause),
  });

/**
 * The file-picker service. Provide {@link layer} in a page, or
 * `TestFilePicker.layer` from `@thomasfosterau/effect-platform-browser/BrowserTesting` in tests.
 *
 * - `supported` — whether the agent has the pickers.
 * - `open` — the files the user picked (at least one).
 * - `save` — the file the user chose to save to, created if new.
 * - `directory` — the directory the user picked.
 *
 * @since 0.1.0
 * @category services
 */
export class FilePicker extends Context.Service<
  FilePicker,
  {
    readonly supported: boolean;
    readonly open: (
      options?: OpenOptions,
    ) => Effect.Effect<Arr.NonEmptyReadonlyArray<FileHandleLike>, FilePickerError>;
    readonly save: (options?: SaveOptions) => Effect.Effect<FileHandleLike, FilePickerError>;
    readonly directory: (
      options?: DirectoryOptions,
    ) => Effect.Effect<DirectoryHandleLike, FilePickerError>;
  }
>()("@thomasfosterau/effect-platform-browser/FilePicker") {}

/**
 * Builds the {@link FilePicker} service over the pickers; `undefined`
 * builds the unsupported service. {@link layer} passes `window`'s.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { FilePicker } from "@thomasfosterau/effect-platform-browser"
 *
 * const picker = FilePicker.make()
 * Effect.runPromise(Effect.flip(picker.open())).then((error) => console.log(error.reason)) // "Unsupported"
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = (pickers?: FilePickerLike): FilePicker["Service"] => {
  if (pickers === undefined) {
    return FilePicker.of({
      supported: false,
      open: () => Effect.fail(pickerError("open", "Unsupported", undefined)),
      save: () => Effect.fail(pickerError("save", "Unsupported", undefined)),
      directory: () => Effect.fail(pickerError("directory", "Unsupported", undefined)),
    });
  }
  return FilePicker.of({
    supported: true,
    open: (options) =>
      Effect.flatMap(
        call("open", () => pickers.showOpenFilePicker(options)),
        (handles) =>
          Arr.isReadonlyArrayNonEmpty(handles)
            ? Effect.succeed(handles)
            : Effect.fail(pickerError("open", "Aborted", undefined)),
      ),
    save: (options) => call("save", () => pickers.showSaveFilePicker(options)),
    directory: (options) => call("directory", () => pickers.showDirectoryPicker(options)),
  });
};

/**
 * The {@link FilePicker} service over `window`'s pickers; reports
 * `supported: false` where there are none.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { FilePicker } from "@thomasfosterau/effect-platform-browser"
 *
 * const program = Effect.map(FilePicker.FilePicker, (picker) => picker.supported)
 * Effect.runPromise(Effect.provide(program, FilePicker.layer)).then(console.log) // false under Node
 * ```
 *
 * @since 0.1.0
 * @category layers
 */
export const layer: Layer.Layer<FilePicker> = Layer.sync(FilePicker, () =>
  make(Option.getOrUndefined(ambientFilePicker())),
);

/**
 * Turns a closed picker into `Option.none()`, keeping every other failure.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { FilePicker } from "@thomasfosterau/effect-platform-browser"
 * import { TestFilePicker } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * // Nothing queued: the double's user closes the picker.
 * const program = FilePicker.optional(Effect.flatMap(FilePicker.FilePicker, (picker) => picker.open()))
 * Effect.runPromise(Effect.provide(program, TestFilePicker.layer())).then(console.log) // { _tag: "None" }
 * ```
 *
 * @since 0.1.0
 * @category combinators
 */
export const optional = <A, E, R>(
  self: Effect.Effect<A, E | FilePickerError, R>,
): Effect.Effect<Option.Option<A>, E | FilePickerError, R> =>
  Effect.catchIf(
    Effect.asSome(self),
    (error): error is FilePickerError =>
      error instanceof FilePickerError && error.reason === "Aborted",
    () => Effect.succeedNone,
  );

/**
 * Asks the user for a directory and returns an Effect `FileSystem` rooted
 * at it (paths are relative to the picked directory, `/` its root).
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { FilePicker } from "@thomasfosterau/effect-platform-browser"
 * import { TestFilePicker } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.gen(function* () {
 *   const control = yield* TestFilePicker.Control
 *   yield* control.disk.makeDirectory("/project")
 *   yield* control.disk.writeFileString("/project/README.md", "# Hi")
 *   yield* control.pick(["/project"])
 *   const fs = yield* FilePicker.fileSystem({ mode: "readwrite" })
 *   return yield* fs.readDirectory("/")
 * })
 * Effect.runPromise(Effect.provide(program, TestFilePicker.layer())).then(console.log) // ["README.md"]
 * ```
 *
 * @since 0.1.0
 * @category combinators
 */
export const fileSystem = (
  options?: DirectoryOptions,
): Effect.Effect<FileSystem.FileSystem, FilePickerError, FilePicker> =>
  Effect.flatMap(FilePicker, (picker) =>
    Effect.map(picker.directory(options), BrowserFileSystem.make),
  );
