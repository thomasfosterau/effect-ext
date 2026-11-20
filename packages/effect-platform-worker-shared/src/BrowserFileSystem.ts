/**
 * Effect's own `FileSystem` over the Origin Private File System (OPFS), or
 * over any directory handle (one the user picked), so code written against
 * `effect/FileSystem` and posix `Path` runs unchanged in a window or a
 * worker.
 *
 * Paths are posix, rooted at the directory handle: `/notes/a.txt` and
 * `notes/a.txt` name the same file. What OPFS cannot express (permissions,
 * owners, links, access times, `watch`) fails `SystemError` `Unknown`.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as ByteSize from "effect/ByteSize";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { type PlatformError, badArgument, systemError } from "effect/PlatformError";
import type { SystemErrorTag } from "effect/PlatformError";
import * as P from "effect/Predicate";
import * as Random from "effect/Random";
import * as Ref from "effect/Ref";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

/**
 * A directory entry as a directory's `entries()` yields it: enough to tell
 * a file from a directory.
 *
 * @since 0.1.0
 * @category models
 */
export interface HandleEntryLike {
  readonly kind: "file" | "directory";
  readonly name: string;
}

/**
 * The slice of a `File` (a snapshot of a file's contents) this module
 * reads.
 *
 * @since 0.1.0
 * @category models
 */
export interface FileLike {
  readonly size: number;
  readonly lastModified: number;
  slice(start?: number, end?: number): { arrayBuffer(): Promise<ArrayBuffer> };
}

/**
 * The slice of a `FileSystemWritableFileStream` this module calls. Writes
 * land in a swap file the browser swaps in on `close`.
 *
 * @since 0.1.0
 * @category models
 */
export interface WritableLike {
  write(data: Uint8Array<ArrayBuffer>): Promise<void>;
  seek(position: number): Promise<void>;
  truncate(size: number): Promise<void>;
  close(): Promise<void>;
}

/**
 * The slice of a `FileSystemFileHandle` this module calls.
 *
 * @since 0.1.0
 * @category models
 */
export interface FileHandleLike {
  readonly kind: "file";
  readonly name: string;
  getFile(): Promise<FileLike>;
  createWritable(options?: { readonly keepExistingData?: boolean }): Promise<WritableLike>;
}

/**
 * The slice of a `FileSystemDirectoryHandle` this module calls. A real
 * handle satisfies it under the `dom.asynciterable` lib, which types
 * `entries()`.
 *
 * @since 0.1.0
 * @category models
 */
export interface DirectoryHandleLike {
  readonly kind: "directory";
  readonly name: string;
  getDirectoryHandle(
    name: string,
    options?: { readonly create?: boolean },
  ): Promise<DirectoryHandleLike>;
  getFileHandle(name: string, options?: { readonly create?: boolean }): Promise<FileHandleLike>;
  removeEntry(name: string, options?: { readonly recursive?: boolean }): Promise<void>;
  entries(): AsyncIterable<readonly [string, HandleEntryLike]>;
}

/** What a path resolves to. */
type Resolved =
  | { readonly kind: "file"; readonly handle: FileHandleLike }
  | { readonly kind: "directory"; readonly handle: DirectoryHandleLike };

const MODULE = "FileSystem";

/** DOMException names onto `SystemError` tags; anything else is `Unknown`. */
const REASONS: ReadonlyArray<readonly [string, SystemErrorTag]> = [
  ["NotFoundError", "NotFound"],
  ["TypeMismatchError", "BadResource"],
  ["NotAllowedError", "PermissionDenied"],
  ["SecurityError", "PermissionDenied"],
  ["NoModificationAllowedError", "Busy"],
  ["InvalidModificationError", "Busy"],
  ["InvalidStateError", "Busy"],
  ["TypeError", "InvalidData"],
];

const tagOf = (cause: unknown): SystemErrorTag => {
  const name = P.hasProperty(cause, "name") && P.isString(cause.name) ? cause.name : "";
  return Option.match(
    Arr.findFirst(REASONS, ([known]) => known === name),
    { onNone: () => "Unknown", onSome: ([, tag]) => tag },
  );
};

const failure =
  (method: string, path: string) =>
  (cause: unknown): PlatformError =>
    systemError({
      _tag: tagOf(cause),
      module: MODULE,
      method,
      pathOrDescriptor: path,
      description:
        P.hasProperty(cause, "message") && P.isString(cause.message) ? cause.message : "",
      cause,
    });

const fail = (method: string, path: string, tag: SystemErrorTag, description: string) =>
  Effect.fail(
    systemError({ _tag: tag, module: MODULE, method, pathOrDescriptor: path, description }),
  );

const unsupported = (method: string, path: string) =>
  fail(method, path, "Unknown", "not supported by the Origin Private File System");

const call = <A>(method: string, path: string, run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: failure(method, path) });

/**
 * The segments of a posix `path` below the root: `.` and empty segments
 * dropped, `..` climbing (never above the root).
 *
 * @example
 * ```ts
 * import { segments } from "@thomasfosterau/effect-platform-worker-shared/BrowserFileSystem"
 *
 * console.log(segments("/a/./b/../c/")) // ["a", "c"]
 * ```
 *
 * @since 0.1.0
 * @category utils
 */
export const segments = (path: string): ReadonlyArray<string> =>
  Arr.reduce(path.split("/"), Arr.empty<string>(), (parts, part) => {
    if (part === "" || part === ".") return parts;
    return part === ".." ? Arr.dropRight(parts, 1) : Arr.append(parts, part);
  });

const join = (parts: ReadonlyArray<string>): string => `/${parts.join("/")}`;

/** One write through a fresh writable: `edit` runs against it, then it closes. */
const edit = (
  method: string,
  path: string,
  handle: FileHandleLike,
  keepExistingData: boolean,
  run: (writable: WritableLike) => Promise<void>,
) =>
  call(method, path, async () => {
    const writable = await handle.createWritable({ keepExistingData });
    await run(writable);
    await writable.close();
  });

const tempName = (prefix: string | undefined, suffix: string | undefined) =>
  Effect.map(
    Random.nextIntBetween(0, 2 ** 31),
    (n) => `${prefix ?? "tmp-"}${n.toString(36)}${suffix ?? ""}`,
  );

/**
 * Builds a `FileSystem` rooted at `root`.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { make } from "@thomasfosterau/effect-platform-worker-shared/BrowserFileSystem"
 * import { make as makeDirectory } from "@thomasfosterau/effect-platform-worker-shared/MemoryFileSystemHandle"
 *
 * const fs = make(makeDirectory())
 * const program = Effect.andThen(fs.writeFileString("/hello.txt", "hi"), fs.readFileString("/hello.txt"))
 * Effect.runPromise(program).then(console.log) // "hi"
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = (root: DirectoryHandleLike): FileSystem.FileSystem => {
  const directoryAt = (method: string, parts: ReadonlyArray<string>, create = false) =>
    Effect.reduce(
      parts,
      (): DirectoryHandleLike => root,
      (directory, name) =>
        call(method, join(parts), () => directory.getDirectoryHandle(name, { create })),
    );

  /** The parent directory and the last segment; the root has no name to split off. */
  const split = (method: string, path: string) =>
    Option.match(Arr.last(segments(path)), {
      onNone: () =>
        Effect.fail(badArgument({ module: MODULE, method, description: `${path} names the root` })),
      onSome: (name) =>
        Effect.map(directoryAt(method, Arr.dropRight(segments(path), 1)), (parent) => ({
          parent,
          name,
        })),
    });

  const resolve = (method: string, path: string): Effect.Effect<Resolved, PlatformError> =>
    Arr.isReadonlyArrayEmpty(segments(path))
      ? Effect.succeed({ kind: "directory", handle: root })
      : Effect.flatMap(split(method, path), ({ parent, name }) =>
          call(method, path, () => parent.getFileHandle(name)).pipe(
            Effect.map((handle): Resolved => ({ kind: "file", handle })),
            Effect.catchIf(
              (error) => error.reason._tag === "BadResource",
              () =>
                Effect.map(
                  call(method, path, () => parent.getDirectoryHandle(name)),
                  (handle): Resolved => ({ kind: "directory", handle }),
                ),
            ),
          ),
        );

  const listing = (method: string, path: string, directory: DirectoryHandleLike) =>
    Stream.runCollect(Stream.fromAsyncIterable(directory.entries(), failure(method, path))).pipe(
      Effect.map((entries) => Arr.map(entries, ([, entry]) => entry)),
    );

  const fileOf = (method: string, path: string) =>
    Effect.flatMap(resolve(method, path), (resolved) =>
      resolved.kind === "file"
        ? Effect.succeed(resolved.handle)
        : fail(method, path, "BadResource", `${path} is a directory`),
    );

  const info = (method: string, path: string) =>
    Effect.flatMap(resolve(method, path), (resolved) =>
      resolved.kind === "directory"
        ? Effect.succeed(fileInfo("Directory", 0, Option.none()))
        : Effect.map(
            call(method, path, () => resolved.handle.getFile()),
            (file) =>
              // oxlint-disable-next-line effect/use-clock-service -- the file's own stamp, not the time
              fileInfo("File", file.size, Option.some(new Date(file.lastModified))),
          ),
    );

  const read = (method: string, path: string) =>
    Effect.flatMap(fileOf(method, path), (handle) =>
      call(method, path, async () => {
        const file = await handle.getFile();
        return new Uint8Array(await file.slice().arrayBuffer());
      }),
    );

  /** Opens the file at `path` for writing as `flag` says, creating it where allowed. */
  const fileForWrite = (method: string, path: string, flag: FileSystem.OpenFlag) =>
    Effect.flatMap(split(method, path), ({ parent, name }) =>
      Effect.gen(function* () {
        const existing = yield* Effect.option(call(method, path, () => parent.getFileHandle(name)));
        if (Option.isSome(existing) && flag.includes("x")) {
          return yield* fail(method, path, "AlreadyExists", `${path} already exists`);
        }
        if (Option.isNone(existing) && flag.startsWith("r")) {
          return yield* fail(method, path, "NotFound", `${path} does not exist`);
        }
        return yield* Option.match(existing, {
          onSome: Effect.succeed,
          onNone: () => call(method, path, () => parent.getFileHandle(name, { create: true })),
        });
      }),
    );

  const writeFile = (path: string, data: Uint8Array, flag: FileSystem.OpenFlag) =>
    Effect.flatMap(fileForWrite("writeFile", path, flag), (handle) =>
      edit("writeFile", path, handle, flag.startsWith("a"), async (writable) => {
        if (flag.startsWith("a")) await writable.seek((await handle.getFile()).size);
        await writable.write(Uint8Array.from(data));
      }),
    );

  const remove = (
    path: string,
    options?: { readonly recursive?: boolean | undefined; readonly force?: boolean | undefined },
  ) =>
    Effect.flatMap(split("remove", path), ({ parent, name }) =>
      call("remove", path, () =>
        parent.removeEntry(name, { recursive: options?.recursive === true }),
      ),
    ).pipe(
      Effect.catchIf(
        (error) => options?.force === true && error.reason._tag === "NotFound",
        () => Effect.void,
      ),
    );

  const copyTo = (from: string, to: string): Effect.Effect<void, PlatformError> =>
    Effect.flatMap(resolve("copy", from), (resolved) =>
      resolved.kind === "file"
        ? Effect.flatMap(read("copy", from), (bytes) => writeFile(to, bytes, "w"))
        : Effect.gen(function* () {
            yield* Effect.flatMap(split("copy", to), ({ parent, name }) =>
              call("copy", to, () => parent.getDirectoryHandle(name, { create: true })),
            );
            const entries = yield* listing("copy", from, resolved.handle);
            yield* Effect.forEach(
              entries,
              (entry) => copyTo(`${from}/${entry.name}`, `${to}/${entry.name}`),
              { concurrency: 1, discard: true },
            );
          }),
    );

  const exists = (path: string) =>
    resolve("exists", path).pipe(
      Effect.as(true),
      Effect.catchIf(
        (error) => error.reason._tag === "NotFound",
        () => Effect.succeed(false),
      ),
    );

  const copy = (from: string, to: string, options?: { readonly overwrite?: boolean | undefined }) =>
    Effect.flatMap(exists(to), (taken) =>
      taken && options?.overwrite !== true
        ? fail("copy", to, "AlreadyExists", `${to} already exists`)
        : copyTo(from, to),
    );

  const readDirectory = (
    path: string,
    recursive: boolean,
    prefix: string,
  ): Effect.Effect<Array<string>, PlatformError> =>
    Effect.flatMap(resolve("readDirectory", path), (resolved) =>
      resolved.kind === "file"
        ? fail("readDirectory", path, "BadResource", `${path} is a file`)
        : Effect.flatMap(listing("readDirectory", path, resolved.handle), (entries) =>
            Effect.map(
              Effect.forEach(
                entries,
                (entry) =>
                  recursive && entry.kind === "directory"
                    ? Effect.map(
                        readDirectory(`${path}/${entry.name}`, true, `${prefix}${entry.name}/`),
                        (nested) => [`${prefix}${entry.name}`, ...nested],
                      )
                    : Effect.succeed([`${prefix}${entry.name}`]),
                { concurrency: 1 },
              ),
              Arr.flatten,
            ),
          ),
    );

  const makeTempDirectory = (options?: {
    readonly directory?: string | undefined;
    readonly prefix?: string | undefined;
  }) =>
    Effect.gen(function* () {
      const parent = segments(options?.directory ?? "/tmp");
      const name = yield* tempName(options?.prefix, undefined);
      yield* directoryAt("makeTempDirectory", [...parent, name], true);
      return join([...parent, name]);
    });

  const makeTempFile = (options?: {
    readonly directory?: string | undefined;
    readonly prefix?: string | undefined;
    readonly suffix?: string | undefined;
  }) =>
    Effect.gen(function* () {
      const parent = segments(options?.directory ?? "/tmp");
      yield* directoryAt("makeTempFile", parent, true);
      const path = join([...parent, yield* tempName(options?.prefix, options?.suffix)]);
      yield* writeFile(path, new Uint8Array(), "wx");
      return path;
    });

  const scoped = (path: Effect.Effect<string, PlatformError>) =>
    Effect.acquireRelease(path, (made) => Effect.ignore(remove(made, { recursive: true })));

  return FileSystem.make({
    access: (path) => Effect.asVoid(resolve("access", path)),
    copy,
    copyFile: (from, to) =>
      Effect.flatMap(read("copyFile", from), (bytes) => writeFile(to, bytes, "w")),
    chmod: (path) => unsupported("chmod", path),
    chown: (path) => unsupported("chown", path),
    link: (from) => unsupported("link", from),
    symlink: (from) => unsupported("symlink", from),
    readLink: (path) => unsupported("readLink", path),
    utimes: (path) => unsupported("utimes", path),
    watch: (path) => Stream.fromEffect(unsupported("watch", path)),
    stat: (path) => info("stat", path),
    lstat: (path) => info("lstat", path),
    realPath: (path) => Effect.as(resolve("realPath", path), join(segments(path))),
    makeDirectory: (path, options) =>
      options?.recursive === true
        ? Effect.asVoid(directoryAt("makeDirectory", segments(path), true))
        : Effect.flatMap(split("makeDirectory", path), ({ parent, name }) =>
            Effect.flatMap(exists(path), (taken) =>
              taken
                ? fail("makeDirectory", path, "AlreadyExists", `${path} already exists`)
                : Effect.asVoid(
                    call("makeDirectory", path, () =>
                      parent.getDirectoryHandle(name, { create: true }),
                    ),
                  ),
            ),
          ),
    makeTempDirectory,
    makeTempDirectoryScoped: (options) => scoped(makeTempDirectory(options)),
    makeTempFile,
    makeTempFileScoped: (options) => scoped(makeTempFile(options)),
    open: (path, options) => open(path, options?.flag ?? "r"),
    readDirectory: (path, options) => readDirectory(path, options?.recursive === true, ""),
    readDirectoryEntries: (path) =>
      Effect.flatMap(resolve("readDirectoryEntries", path), (resolved) =>
        resolved.kind === "file"
          ? fail("readDirectoryEntries", path, "BadResource", `${path} is a file`)
          : Effect.map(listing("readDirectoryEntries", path, resolved.handle), (entries) =>
              Arr.map(entries, (entry): FileSystem.DirectoryEntry => ({
                name: entry.name,
                type: entry.kind === "file" ? "File" : "Directory",
              })),
            ),
      ),
    readFile: (path) => read("readFile", path),
    remove,
    rename: (from, to) =>
      Effect.andThen(copy(from, to, { overwrite: true }), remove(from, { recursive: true })),
    truncate: (path, length) =>
      Effect.flatMap(fileOf("truncate", path), (handle) =>
        edit("truncate", path, handle, true, (writable) => writable.truncate(length ?? 0)),
      ),
    writeFile: (path, data, options) => writeFile(path, data, options?.flag ?? "w"),
  });

  function open(
    path: string,
    flag: FileSystem.OpenFlag,
  ): Effect.Effect<FileSystem.File, PlatformError, Scope.Scope> {
    return Effect.gen(function* () {
      const handle = yield* fileForWrite("open", path, flag);
      if (flag.startsWith("w")) yield* edit("open", path, handle, false, async () => {});
      const position = yield* Ref.make(0);
      const size = call("open", path, async () => (await handle.getFile()).size);
      const readAt = (buffer: Uint8Array, at: number) =>
        call("read", path, async () => {
          const file = await handle.getFile();
          const bytes = new Uint8Array(await file.slice(at, at + buffer.length).arrayBuffer());
          buffer.set(bytes);
          return bytes.length;
        });
      const readInto = (buffer: Uint8Array, options?: FileSystem.File.ReadOptions) =>
        options?.position === undefined
          ? Effect.flatMap(Ref.get(position), (at) =>
              Effect.tap(readAt(buffer, at), (count) => Ref.update(position, (p) => p + count)),
            )
          : readAt(buffer, Number(options.position));
      const write = (buffer: Uint8Array) =>
        Effect.gen(function* () {
          const at = flag.startsWith("a") ? yield* size : yield* Ref.get(position);
          yield* edit("write", path, handle, true, async (writable) => {
            await writable.seek(at);
            await writable.write(Uint8Array.from(buffer));
          });
          yield* Ref.set(position, at + buffer.length);
          return buffer.length;
        });
      return {
        [FileSystem.FileTypeId]: FileSystem.FileTypeId,
        stat: info("stat", path),
        seek: (offset, from) =>
          Effect.map(
            Ref.updateAndGet(position, (at) => (from === "start" ? 0 : at) + Number(offset)),
            BigInt,
          ),
        sync: Effect.void,
        read: readInto,
        readAlloc: (count, options) =>
          Effect.suspend(() => {
            const buffer = new Uint8Array(count);
            return Effect.map(readInto(buffer, options), (n) =>
              n === 0 ? Option.none() : Option.some(buffer.subarray(0, n)),
            );
          }),
        truncate: (length) =>
          edit("truncate", path, handle, true, (writable) => writable.truncate(length ?? 0)),
        write,
        writeAll: (buffer) => Effect.asVoid(write(buffer)),
      };
    });
  }
};

function fileInfo(
  type: FileSystem.File.Type,
  size: number,
  mtime: Option.Option<Date>,
): FileSystem.File.Info {
  return {
    type,
    mtime,
    atime: Option.none(),
    birthtime: Option.none(),
    dev: 0n,
    ino: Option.none(),
    mode: type === "Directory" ? 0o755 : 0o644,
    nlink: Option.none(),
    uid: Option.none(),
    gid: Option.none(),
    rdev: Option.none(),
    size: ByteSize.bytes(size),
    blksize: Option.none(),
    blocks: Option.none(),
  };
}

/**
 * `FileSystem` and posix `Path` rooted at `root`: a directory the user
 * picked, or any handle.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as FileSystem from "effect/FileSystem"
 * import { layerHandle } from "@thomasfosterau/effect-platform-worker-shared/BrowserFileSystem"
 * import { make as makeDirectory } from "@thomasfosterau/effect-platform-worker-shared/MemoryFileSystemHandle"
 *
 * const program = Effect.gen(function* () {
 *   const fs = yield* FileSystem.FileSystem
 *   yield* fs.makeDirectory("/notes")
 *   return yield* fs.readDirectory("/")
 * })
 * Effect.runPromise(Effect.provide(program, layerHandle(makeDirectory()))).then(console.log) // ["notes"]
 * ```
 *
 * @since 0.1.0
 * @category layers
 */
export const layerHandle = (
  root: DirectoryHandleLike,
): Layer.Layer<FileSystem.FileSystem | Path.Path> =>
  Layer.merge(Layer.succeed(FileSystem.FileSystem, make(root)), Path.layer);

/**
 * `FileSystem` and posix `Path` rooted at this origin's private file
 * system (`navigator.storage.getDirectory()`). Fails `NotFound` where the
 * context has none (Node, an insecure context, an old browser).
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as FileSystem from "effect/FileSystem"
 * import { layer } from "@thomasfosterau/effect-platform-worker-shared/BrowserFileSystem"
 *
 * const program = Effect.gen(function* () {
 *   const fs = yield* FileSystem.FileSystem
 *   return yield* fs.exists("/config.json")
 * })
 * // Under Node there is no OPFS: the layer fails.
 * Effect.runPromise(Effect.flip(Effect.provide(program, layer))).then((error) =>
 *   console.log(error.reason._tag), // "NotFound"
 * )
 * ```
 *
 * @since 0.1.0
 * @category layers
 */
export const layer: Layer.Layer<FileSystem.FileSystem | Path.Path, PlatformError> = Layer.unwrap(
  Effect.gen(function* () {
    const scope: {
      readonly navigator?: {
        readonly storage?: { getDirectory?: () => Promise<DirectoryHandleLike> };
      };
    } = globalThis;
    const getDirectory = Option.fromUndefinedOr(scope.navigator?.storage?.getDirectory);
    if (Option.isNone(getDirectory)) {
      return yield* fail("layer", "/", "NotFound", "no Origin Private File System here");
    }
    const storage = scope.navigator?.storage;
    const root = yield* call("layer", "/", () => getDirectory.value.call(storage));
    return layerHandle(root);
  }),
);
