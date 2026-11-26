/**
 * A controllable file picker for tests of code that uses `FilePicker`:
 * {@link layer} provides the real adapter over in-memory pickers that pick
 * from an in-memory disk, plus {@link Control} to seed that disk, choose
 * what the user picks next, answer permission requests, and read what was
 * asked for.
 *
 * @since 0.1.0
 */
import * as BrowserFileSystem from "@thomasfosterau/effect-platform-worker-shared/BrowserFileSystem";
import type {
  DirectoryHandleLike,
  FileHandleLike,
} from "@thomasfosterau/effect-platform-worker-shared/BrowserFileSystem";
import * as MemoryFileSystemHandle from "@thomasfosterau/effect-platform-worker-shared/MemoryFileSystemHandle";
import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import {
  type DirectoryOptions,
  FilePicker,
  type FilePickerLike,
  type HandlePermission,
  type PermissionHandleLike,
  type PermissionMode,
  make as makeFilePicker,
  type OpenOptions,
  type SaveOptions,
} from "../FilePicker.ts";

/**
 * The in-memory pickers' starting behaviour: `supported` (default `true`)
 * builds the unsupported service when `false`.
 *
 * @since 0.1.0
 * @category models
 */
export interface Options {
  readonly supported?: boolean;
}

/**
 * What the user does at the next picker: pick these disk paths, close the
 * picker (`AbortError`), or have it refused (`NotAllowedError`, as without
 * a user gesture).
 *
 * @since 0.1.0
 * @category models
 */
export type Response =
  | { readonly kind: "pick"; readonly paths: Arr.NonEmptyReadonlyArray<string> }
  | { readonly kind: "cancel" }
  | { readonly kind: "deny" };

/**
 * What the user does when asked for a handle's permission: grant it, deny
 * it, dismiss the prompt (the permission stays `prompt`), or it is refused
 * without asking (`NotAllowedError`, as without a user gesture).
 *
 * @since 0.2.0
 * @category models
 */
export type PermissionResponse = "grant" | "deny" | "dismiss" | "refuse";

/**
 * One picker the code under test opened, with the options it passed.
 *
 * @since 0.1.0
 * @category models
 */
export type Request =
  | { readonly method: "open"; readonly options: Option.Option<OpenOptions> }
  | { readonly method: "save"; readonly options: Option.Option<SaveOptions> }
  | { readonly method: "directory"; readonly options: Option.Option<DirectoryOptions> };

/**
 * Drives the in-memory pickers.
 *
 * - `disk` — a `FileSystem` over the disk the pickers pick from: seed it,
 *   and read back what the code under test wrote.
 * - `pick` — the next picker returns these paths: every one for `open`,
 *   the first for `save` (created if missing) and `directory` (created,
 *   with its parents, if missing).
 * - `cancel` / `deny` — the next picker is closed / refused.
 * - `stored` — a handle to a disk directory (created if missing) as one
 *   read back from storage in a later session: its permission is `prompt`.
 * - `setPermission` — sets a handle's permission. A picked handle starts
 *   `granted`.
 * - `respondToRequest` — what the user does at the next permission prompt.
 * - `requests` — every picker opened so far.
 * - `permissionRequests` — the mode of each permission asked for so far.
 *
 * A picker with nothing queued is closed, and a permission prompt with
 * nothing queued is dismissed, as by a user who walks away. Asking for a
 * permission already `granted` or `denied` answers without a prompt.
 *
 * @since 0.1.0
 * @category services
 */
export class Control extends Context.Service<
  Control,
  {
    readonly disk: FileSystem.FileSystem;
    readonly pick: (paths: Arr.NonEmptyReadonlyArray<string>) => Effect.Effect<void>;
    readonly cancel: Effect.Effect<void>;
    readonly deny: Effect.Effect<void>;
    readonly stored: (path: string) => Effect.Effect<DirectoryHandleLike>;
    readonly setPermission: (
      handle: FileHandleLike | DirectoryHandleLike,
      state: HandlePermission,
    ) => Effect.Effect<void>;
    readonly respondToRequest: (response: PermissionResponse) => Effect.Effect<void>;
    readonly requests: Effect.Effect<ReadonlyArray<Request>>;
    readonly permissionRequests: Effect.Effect<ReadonlyArray<PermissionMode>>;
  }
>()("@thomasfosterau/effect-platform-browser/BrowserTesting/FilePickerControl") {}

/**
 * What {@link make} builds: the `FilePicker` service over the in-memory
 * pickers, and the {@link Control} that drives them.
 *
 * @since 0.1.0
 * @category models
 */
export interface Fixture {
  readonly filePicker: FilePicker["Service"];
  readonly control: Control["Service"];
}

const directoryAt = (root: DirectoryHandleLike, parts: ReadonlyArray<string>, create: boolean) =>
  Arr.reduce(parts, Promise.resolve(root), (parent, name) =>
    parent.then((directory) => directory.getDirectoryHandle(name, { create })),
  );

const fileAt = (root: DirectoryHandleLike, path: string, create: boolean) => {
  const parts = BrowserFileSystem.segments(path);
  return directoryAt(root, Arr.dropRight(parts, 1), create).then((parent) =>
    // The root has no name: `""` rejects as the platform does.
    parent.getFileHandle(
      Option.getOrElse(Arr.last(parts), () => ""),
      { create },
    ),
  );
};

/**
 * Builds in-memory pickers over an empty disk: the `FilePicker` service
 * over them, and its {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { TestFilePicker } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const { filePicker, control } = TestFilePicker.make()
 * const program = Effect.gen(function* () {
 *   yield* control.pick(["/report.csv"])
 *   const file = yield* filePicker.save({ suggestedName: "report.csv" })
 *   return file.name
 * })
 * Effect.runPromise(program).then(console.log) // "report.csv"
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = (options?: Options): Fixture => {
  const root = MemoryFileSystemHandle.make();
  const queue: Array<Response> = [];
  const requests: Array<Request> = [];
  const permissions = new WeakMap<object, HandlePermission>();
  const permissionResponses: Array<PermissionResponse> = [];
  const permissionRequests: Array<PermissionMode> = [];
  /** The permission methods of the handle `self` returns, starting at `initial`. */
  const permissionMethods = (
    self: () => object,
    initial: HandlePermission,
  ): PermissionHandleLike => {
    const state = (): HandlePermission => permissions.get(self()) ?? initial;
    return {
      queryPermission: () => Promise.resolve(state()),
      requestPermission: ({ mode }) => {
        permissionRequests.push(mode);
        if (state() !== "prompt") return Promise.resolve(state());
        const response = permissionResponses.shift() ?? "dismiss";
        if (response === "refuse") {
          return Promise.reject(
            new DOMException("Must be handling a user gesture.", "NotAllowedError"),
          );
        }
        if (response !== "dismiss") {
          permissions.set(self(), response === "grant" ? "granted" : "denied");
        }
        return Promise.resolve(state());
      },
    };
  };
  const permittedFile = (file: FileHandleLike): FileHandleLike => {
    const wrapped: FileHandleLike & PermissionHandleLike = {
      kind: "file",
      name: file.name,
      getFile: () => file.getFile(),
      createWritable: (writable) => file.createWritable(writable),
      ...permissionMethods(() => wrapped, "granted"),
    };
    return wrapped;
  };
  const permittedDirectory = (
    handle: DirectoryHandleLike,
    initial: HandlePermission,
  ): DirectoryHandleLike => {
    const wrapped: DirectoryHandleLike & PermissionHandleLike = {
      kind: "directory",
      name: handle.name,
      getDirectoryHandle: (name, create) => handle.getDirectoryHandle(name, create),
      getFileHandle: (name, create) => handle.getFileHandle(name, create),
      removeEntry: (name, recursive) => handle.removeEntry(name, recursive),
      entries: () => handle.entries(),
      ...permissionMethods(() => wrapped, initial),
    };
    return wrapped;
  };
  /** The next response, as a promise of the paths picked. */
  const respond = (request: Request): Promise<Arr.NonEmptyReadonlyArray<string>> => {
    requests.push(request);
    const response = queue.shift() ?? { kind: "cancel" };
    if (response.kind === "pick") return Promise.resolve(response.paths);
    return Promise.reject(
      response.kind === "cancel"
        ? new DOMException("The user aborted a request.", "AbortError")
        : new DOMException("Must be handling a user gesture.", "NotAllowedError"),
    );
  };
  const pickers: FilePickerLike = {
    showOpenFilePicker: (open) =>
      respond({ method: "open", options: Option.fromUndefinedOr(open) }).then(
        (paths): Promise<ReadonlyArray<FileHandleLike>> =>
          Promise.all(Arr.map(paths, (path) => fileAt(root, path, false).then(permittedFile))),
      ),
    showSaveFilePicker: (save) =>
      respond({ method: "save", options: Option.fromUndefinedOr(save) }).then((paths) =>
        fileAt(root, Arr.headNonEmpty(paths), true).then(permittedFile),
      ),
    showDirectoryPicker: (directory) =>
      respond({ method: "directory", options: Option.fromUndefinedOr(directory) }).then((paths) =>
        directoryAt(root, BrowserFileSystem.segments(Arr.headNonEmpty(paths)), true).then(
          (picked) => permittedDirectory(picked, "granted"),
        ),
      ),
  };
  return {
    filePicker: makeFilePicker(options?.supported === false ? undefined : pickers),
    control: Control.of({
      disk: BrowserFileSystem.make(root),
      pick: (paths) => Effect.sync(() => void queue.push({ kind: "pick", paths })),
      cancel: Effect.sync(() => void queue.push({ kind: "cancel" })),
      deny: Effect.sync(() => void queue.push({ kind: "deny" })),
      stored: (path) =>
        Effect.orDie(
          Effect.tryPromise({
            try: () =>
              directoryAt(root, BrowserFileSystem.segments(path), true).then((directory) =>
                permittedDirectory(directory, "prompt"),
              ),
            catch: (cause) => new Cause.UnknownError(cause),
          }),
        ),
      setPermission: (handle, state) => Effect.sync(() => void permissions.set(handle, state)),
      respondToRequest: (response) => Effect.sync(() => void permissionResponses.push(response)),
      requests: Effect.sync(() => [...requests]),
      permissionRequests: Effect.sync(() => [...permissionRequests]),
    }),
  };
};

/**
 * Provides `FilePicker` over fresh in-memory pickers, and its
 * {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { FilePicker } from "@thomasfosterau/effect-platform-browser"
 * import { TestFilePicker } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.gen(function* () {
 *   const control = yield* TestFilePicker.Control
 *   yield* control.disk.writeFileString("/notes.txt", "hello")
 *   yield* control.pick(["/notes.txt"])
 *   const picker = yield* FilePicker.FilePicker
 *   const [file] = yield* picker.open()
 *   return file.name
 * })
 * Effect.runPromise(Effect.provide(program, TestFilePicker.layer())).then(console.log) // "notes.txt"
 * ```
 *
 * @since 0.1.0
 * @category layers
 */
export const layer = (options?: Options): Layer.Layer<FilePicker | Control> =>
  Layer.syncContext(() => {
    const { filePicker, control } = make(options);
    return Context.make(FilePicker, filePicker).pipe(Context.add(Control, control));
  });
