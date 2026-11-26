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
 * A picked handle keeps its permission for the session only. A handle
 * stored (in IndexedDB) and read back later asks again: {@link permission}
 * reads its state, {@link requestPermission} asks the user, and
 * {@link fileSystem} does both for a stored directory.
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
import * as P from "effect/Predicate";
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
  readonly mode?: PermissionMode;
}

/**
 * The access a handle's permission covers.
 *
 * @since 0.2.0
 * @category models
 */
export type PermissionMode = "read" | "readwrite";

/**
 * A handle's permission: `granted`, `denied`, or `prompt` (the next
 * {@link requestPermission} asks the user).
 *
 * @since 0.2.0
 * @category models
 */
export type HandlePermission = "granted" | "denied" | "prompt";

/**
 * Options for {@link fileSystem}: a stored directory `handle` to use instead
 * of opening the picker, with `mode` the access to make sure of first.
 *
 * @since 0.2.0
 * @category models
 */
export interface FileSystemOptions extends DirectoryOptions {
  readonly handle?: DirectoryHandleLike;
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
 * - `Unsupported` — the agent has no pickers (every browser but Chromium),
 *   or a handle without the permission methods.
 * - `Aborted` — the user closed the picker.
 * - `NotAllowed` — no user gesture, a cross-origin frame, or a blocked
 *   location; for {@link fileSystem} over a stored handle, a permission the
 *   user denied.
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
export class FilePickerError extends Schema.TaggedError<
  FilePickerError,
  { readonly brand: unique symbol }
>()("FilePickerError", {
  reason: Schema.Literals(["Unsupported", "Aborted", "NotAllowed", "Failed"]),
  method: Schema.Literals(["open", "save", "directory", "permission", "requestPermission"]),
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
      call("open", () => pickers.showOpenFilePicker(options)).pipe(
        Effect.filterOrFail(Arr.isReadonlyArrayNonEmpty, () =>
          pickerError("open", "Aborted", undefined),
        ),
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
 * The permission methods a Chromium file or directory handle adds. A
 * handle without them (another browser's, an OPFS handle) reports no
 * permission of its own.
 *
 * @since 0.2.0
 * @category models
 */
export interface PermissionHandleLike {
  queryPermission(descriptor: { readonly mode: PermissionMode }): Promise<HandlePermission>;
  requestPermission(descriptor: { readonly mode: PermissionMode }): Promise<HandlePermission>;
}

type Handle = FileHandleLike | DirectoryHandleLike;

const hasPermissionMethods = (handle: Handle): handle is Handle & PermissionHandleLike =>
  P.hasProperty(handle, "queryPermission") &&
  P.isFunction(handle.queryPermission) &&
  P.hasProperty(handle, "requestPermission") &&
  P.isFunction(handle.requestPermission);

const askHandle = (
  handle: Handle,
  method: "permission" | "requestPermission",
  ask: (handle: PermissionHandleLike) => Promise<HandlePermission>,
): Effect.Effect<HandlePermission, FilePickerError> =>
  hasPermissionMethods(handle)
    ? call(method, () => ask(handle))
    : Effect.fail(pickerError(method, "Unsupported", undefined));

/**
 * A handle's permission for `mode` (default `"read"`), without asking the
 * user. Fails `Unsupported` for a handle without `queryPermission`.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { FilePicker } from "@thomasfosterau/effect-platform-browser"
 * import { TestFilePicker } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.gen(function* () {
 *   const control = yield* TestFilePicker.Control
 *   const stored = yield* control.stored("/project")
 *   return yield* FilePicker.permission(stored, "readwrite")
 * })
 * Effect.runPromise(Effect.provide(program, TestFilePicker.layer())).then(console.log) // "prompt"
 * ```
 *
 * @since 0.2.0
 * @category permissions
 */
export const permission = (
  handle: FileHandleLike | DirectoryHandleLike,
  mode: PermissionMode = "read",
): Effect.Effect<HandlePermission, FilePickerError> =>
  askHandle(handle, "permission", (self) => self.queryPermission({ mode }));

/**
 * Asks the user for `mode` (default `"read"`) on a handle, and returns the
 * permission that results; one already granted is returned without asking.
 * The browser asks only from a user gesture: without one it fails
 * `NotAllowed`. Fails `Unsupported` for a handle without
 * `requestPermission`.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { FilePicker } from "@thomasfosterau/effect-platform-browser"
 * import { TestFilePicker } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.gen(function* () {
 *   const control = yield* TestFilePicker.Control
 *   const stored = yield* control.stored("/project")
 *   yield* control.respondToRequest("grant")
 *   return yield* FilePicker.requestPermission(stored, "readwrite")
 * })
 * Effect.runPromise(Effect.provide(program, TestFilePicker.layer())).then(console.log) // "granted"
 * ```
 *
 * @since 0.2.0
 * @category permissions
 */
export const requestPermission = (
  handle: FileHandleLike | DirectoryHandleLike,
  mode: PermissionMode = "read",
): Effect.Effect<HandlePermission, FilePickerError> =>
  askHandle(handle, "requestPermission", (self) => self.requestPermission({ mode }));

/**
 * Makes sure of `mode` on a stored directory: granted already, or granted
 * when asked. A handle without the permission methods (an OPFS handle, or
 * a browser that grants for good) is used as it is.
 */
const ensurePermission = (
  handle: DirectoryHandleLike,
  mode: PermissionMode,
): Effect.Effect<void, FilePickerError> =>
  !hasPermissionMethods(handle)
    ? Effect.void
    : Effect.flatMap(permission(handle, mode), (state) => {
        if (state === "granted") return Effect.void;
        const asked = state === "prompt" ? requestPermission(handle, mode) : Effect.succeed(state);
        return Effect.flatMap(asked, (granted) =>
          granted === "granted"
            ? Effect.void
            : Effect.fail(pickerError("requestPermission", "NotAllowed", granted)),
        );
      });

/**
 * An Effect `FileSystem` rooted at a directory (paths are relative to it,
 * `/` its root): the one the user picks, or a stored `handle`, after
 * making sure of `mode` (asking the user when its permission is `prompt`,
 * which needs a user gesture; a permission the user denies fails
 * `NotAllowed`).
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
  options?: FileSystemOptions,
): Effect.Effect<FileSystem.FileSystem, FilePickerError, FilePicker> => {
  const handle = options?.handle;
  return handle === undefined
    ? Effect.flatMap(FilePicker, (picker) =>
        Effect.map(picker.directory(options), BrowserFileSystem.make),
      )
    : Effect.as(ensurePermission(handle, options?.mode ?? "read"), BrowserFileSystem.make(handle));
};
