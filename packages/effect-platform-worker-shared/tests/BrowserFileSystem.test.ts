import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import type { PlatformError } from "effect/PlatformError";
import * as Stream from "effect/Stream";
import * as BrowserFileSystem from "@thomasfosterau/effect-platform-worker-shared/BrowserFileSystem";
import * as MemoryFileSystemHandle from "@thomasfosterau/effect-platform-worker-shared/MemoryFileSystemHandle";

const text = new TextEncoder();
/** Builds the ambient layer and nothing else. */
const probe = Effect.service(FileSystem.FileSystem);

/** A `storage` whose `getDirectory` rejects with the DOMException `name`. */
const rejectingStorage = (name: string) => ({
  getDirectory: () => Promise.reject(new DOMException("x", name)),
});
const fresh = () => BrowserFileSystem.make(MemoryFileSystemHandle.make());

/** The `SystemError` / `BadArgument` tag an effect failed with. */
const reasonOf = <A, R>(effect: Effect.Effect<A, PlatformError, R>) =>
  Effect.map(Effect.flip(effect), (error) => error.reason._tag);

/** Runs `use` with `navigator` replaced, restoring it after. */
const withNavigator = <A, E, R>(value: unknown, use: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = Object.getOwnPropertyDescriptor(globalThis, "navigator");
      Object.defineProperty(globalThis, "navigator", { value, configurable: true, writable: true });
      return previous;
    }),
    () => use,
    (previous) =>
      Effect.sync(() => {
        if (previous === undefined) Reflect.deleteProperty(globalThis, "navigator");
        else Object.defineProperty(globalThis, "navigator", previous);
      }),
  );

describe("segments", () => {
  it("normalises a posix path below the root", () => {
    expect(BrowserFileSystem.segments("/a/./b/../c/")).toEqual(["a", "c"]);
    expect(BrowserFileSystem.segments("../../x")).toEqual(["x"]);
    expect(BrowserFileSystem.segments("/")).toEqual([]);
  });
});

describe("make", () => {
  it.effect("writes, reads and appends files", () =>
    Effect.gen(function* () {
      const fs = fresh();
      yield* fs.writeFileString("/a.txt", "hello");
      yield* fs.writeFileString("/a.txt", " world", { flag: "a" });
      expect(yield* fs.readFileString("/a.txt")).toBe("hello world");
      yield* fs.writeFileString("/a.txt", "new");
      expect(yield* fs.readFileString("/a.txt")).toBe("new");
      expect(yield* reasonOf(fs.writeFileString("/a.txt", "x", { flag: "wx" }))).toBe(
        "AlreadyExists",
      );
      expect(yield* reasonOf(fs.writeFileString("/b.txt", "x", { flag: "r+" }))).toBe("NotFound");
      expect(yield* reasonOf(fs.writeFileString("/", "x"))).toBe("BadArgument");
      expect(yield* reasonOf(fs.writeFileString("/missing/a.txt", "x"))).toBe("NotFound");
    }),
  );

  it.effect("stats files and directories", () =>
    Effect.gen(function* () {
      const fs = fresh();
      yield* fs.writeFileString("/a.txt", "abc");
      yield* fs.makeDirectory("/d");
      const file = yield* fs.stat("/a.txt");
      expect(file.type).toBe("File");
      expect(Number(file.size)).toBe(3);
      expect(Option.isSome(file.mtime)).toBe(true);
      expect(file.mode).toBe(0o644);
      const directory = yield* fs.lstat("/d");
      expect(directory.type).toBe("Directory");
      expect(directory.mode).toBe(0o755);
      expect((yield* fs.stat("/")).type).toBe("Directory");
      expect(yield* reasonOf(fs.stat("/nope"))).toBe("NotFound");
      expect(yield* reasonOf(fs.readFile("/d"))).toBe("BadResource");
      expect(yield* reasonOf(fs.stat("/a.txt/x"))).toBe("BadResource");
    }),
  );

  it.effect("checks existence and access, and resolves real paths", () =>
    Effect.gen(function* () {
      const fs = fresh();
      yield* fs.writeFileString("/a.txt", "");
      expect(yield* fs.exists("/a.txt")).toBe(true);
      expect(yield* fs.exists("/b.txt")).toBe(false);
      expect(yield* reasonOf(fs.exists("/a.txt/b"))).toBe("BadResource");
      yield* fs.access("/a.txt");
      expect(yield* fs.realPath("/./x/../a.txt")).toBe("/a.txt");
      expect(yield* reasonOf(fs.access("/b.txt"))).toBe("NotFound");
    }),
  );

  it.effect("makes directories, recursively or one level", () =>
    Effect.gen(function* () {
      const fs = fresh();
      yield* fs.makeDirectory("/a/b/c", { recursive: true });
      yield* fs.makeDirectory("/a/b/c", { recursive: true });
      yield* fs.makeDirectory("/a/x");
      expect(yield* reasonOf(fs.makeDirectory("/a/x"))).toBe("AlreadyExists");
      expect(yield* reasonOf(fs.makeDirectory("/q/r"))).toBe("NotFound");
      expect(yield* fs.readDirectory("/a", { recursive: true })).toEqual(["b", "b/c", "x"]);
      expect(yield* fs.readDirectory("/a")).toEqual(["b", "x"]);
      expect(yield* fs.readDirectoryEntries("/a")).toEqual([
        { name: "b", type: "Directory" },
        { name: "x", type: "Directory" },
      ]);
    }),
  );

  it.effect("refuses to list a file", () =>
    Effect.gen(function* () {
      const fs = fresh();
      yield* fs.writeFileString("/a.txt", "");
      expect(yield* reasonOf(fs.readDirectory("/a.txt"))).toBe("BadResource");
      expect(yield* reasonOf(fs.readDirectoryEntries("/a.txt"))).toBe("BadResource");
      expect(yield* fs.readDirectoryEntries("/")).toEqual([{ name: "a.txt", type: "File" }]);
    }),
  );

  it.effect("removes entries", () =>
    Effect.gen(function* () {
      const fs = fresh();
      yield* fs.makeDirectory("/d");
      yield* fs.writeFileString("/d/a.txt", "");
      expect(yield* reasonOf(fs.remove("/d"))).toBe("Busy");
      yield* fs.remove("/d", { recursive: true });
      expect(yield* fs.exists("/d")).toBe(false);
      expect(yield* reasonOf(fs.remove("/d"))).toBe("NotFound");
      yield* fs.remove("/d", { force: true });
      expect(yield* reasonOf(fs.remove("/", { force: true }))).toBe("BadArgument");
    }),
  );

  it.effect("copies files and trees, and renames", () =>
    Effect.gen(function* () {
      const fs = fresh();
      yield* fs.makeDirectory("/src/nested", { recursive: true });
      yield* fs.writeFileString("/src/a.txt", "a");
      yield* fs.writeFileString("/src/nested/b.txt", "b");
      yield* fs.copy("/src", "/dst");
      expect(yield* fs.readDirectory("/dst", { recursive: true })).toEqual([
        "nested",
        "nested/b.txt",
        "a.txt",
      ]);
      expect(yield* reasonOf(fs.copy("/src", "/dst"))).toBe("AlreadyExists");
      yield* fs.writeFileString("/src/a.txt", "changed");
      yield* fs.copy("/src", "/dst", { overwrite: true });
      expect(yield* fs.readFileString("/dst/a.txt")).toBe("changed");
      yield* fs.copyFile("/src/a.txt", "/copy.txt");
      expect(yield* fs.readFileString("/copy.txt")).toBe("changed");
      yield* fs.rename("/src", "/moved");
      expect(yield* fs.exists("/src")).toBe(false);
      expect(yield* fs.readFileString("/moved/nested/b.txt")).toBe("b");
    }),
  );

  it.effect("truncates a file", () =>
    Effect.gen(function* () {
      const fs = fresh();
      yield* fs.writeFileString("/a.txt", "abcdef");
      yield* fs.truncate("/a.txt", 3);
      expect(yield* fs.readFileString("/a.txt")).toBe("abc");
      yield* fs.truncate("/a.txt");
      expect(yield* fs.readFileString("/a.txt")).toBe("");
      expect(yield* reasonOf(fs.truncate("/nope"))).toBe("NotFound");
    }),
  );

  it.effect("makes temporary files and directories", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = fresh();
        const directory = yield* fs.makeTempDirectoryScoped();
        expect(directory).toMatch(/^\/tmp\/tmp-[0-9a-z]+$/);
        expect((yield* fs.stat(directory)).type).toBe("Directory");
        const file = yield* fs.makeTempFileScoped({
          directory: "/scratch",
          prefix: "x-",
          suffix: ".txt",
        });
        expect(file).toMatch(/^\/scratch\/x-[0-9a-z]+\.txt$/);
        expect(yield* fs.readFileString(file)).toBe("");
        const named = yield* fs.makeTempDirectoryScoped({ directory: "/scratch", prefix: "d-" });
        expect(named).toMatch(/^\/scratch\/d-/);
      }),
    ),
  );

  it.effect("removes scoped temporaries when the scope closes", () =>
    Effect.gen(function* () {
      const fs = fresh();
      const [directory, file] = yield* Effect.scoped(
        Effect.gen(function* () {
          const made = yield* fs.makeTempDirectoryScoped();
          yield* fs.writeFileString(`${made}/inner.txt`, "x");
          return [made, yield* fs.makeTempFileScoped()] as const;
        }),
      );
      expect(yield* fs.exists(directory)).toBe(false);
      expect(yield* fs.exists(file)).toBe(false);
    }),
  );

  it.effect("fails what OPFS cannot do", () =>
    Effect.gen(function* () {
      const fs = fresh();
      const unsupported = [
        fs.chmod("/a", 0o600),
        fs.chown("/a", 1, 1),
        fs.link("/a", "/b"),
        fs.symlink("/a", "/b"),
        fs.readLink("/a"),
        fs.utimes("/a", 0, 0),
        Stream.runDrain(fs.watch("/a")),
      ];
      const reasons = yield* Effect.forEach(unsupported, reasonOf, { concurrency: 1 });
      expect(reasons).toEqual(Array.from({ length: 7 }, () => "Unknown"));
    }),
  );

  it.effect("streams and sinks through the derived methods", () =>
    Effect.gen(function* () {
      const fs = fresh();
      yield* fs.writeFileString("/a.txt", "0123456789");
      const chunks = yield* Stream.runCollect(fs.stream("/a.txt", { chunkSize: 4 }));
      expect(chunks.map((chunk) => chunk.length)).toEqual([4, 4, 2]);
      yield* Stream.run(Stream.make(text.encode("ab"), text.encode("cd")), fs.sink("/b.txt"));
      expect(yield* fs.readFileString("/b.txt")).toBe("abcd");
    }),
  );
});

describe("open", () => {
  it.effect("reads and writes at a position it keeps", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = fresh();
        yield* fs.writeFileString("/a.txt", "abcdef");
        const file = yield* fs.open("/a.txt", { flag: "r+" });
        const head = yield* file.readAlloc(2);
        expect(Option.map(head, (bytes) => new TextDecoder().decode(bytes))).toEqual(
          Option.some("ab"),
        );
        yield* file.write(text.encode("XY"));
        expect(yield* fs.readFileString("/a.txt")).toBe("abXYef");
        expect(yield* file.seek(1n, "start")).toBe(1n);
        expect(yield* file.seek(1n, "current")).toBe(2n);
        const buffer = new Uint8Array(3);
        expect(yield* file.read(buffer)).toBe(3);
        expect(new TextDecoder().decode(buffer)).toBe("XYe");
        expect(yield* file.read(buffer, { position: 0n })).toBe(3);
        expect(new TextDecoder().decode(buffer)).toBe("abX");
        yield* file.seek(10n, "start");
        expect(yield* file.readAlloc(4)).toEqual(Option.none());
        yield* file.truncate(2);
        expect(yield* fs.readFileString("/a.txt")).toBe("ab");
        yield* file.truncate();
        expect(Number((yield* file.stat).size)).toBe(0);
        yield* file.sync;
      }),
    ),
  );

  it.effect("truncates on w, appends on a, and refuses x over an existing file", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = fresh();
        yield* fs.writeFileString("/a.txt", "abc");
        const appender = yield* fs.open("/a.txt", { flag: "a" });
        yield* appender.writeAll(text.encode("d"));
        yield* appender.writeAll(text.encode("e"));
        expect(yield* fs.readFileString("/a.txt")).toBe("abcde");
        yield* fs.open("/a.txt", { flag: "w" });
        expect(yield* fs.readFileString("/a.txt")).toBe("");
        expect(yield* reasonOf(fs.open("/a.txt", { flag: "wx" }))).toBe("AlreadyExists");
        expect(yield* reasonOf(fs.open("/b.txt"))).toBe("NotFound");
        const reader = yield* fs.open("/a.txt");
        expect(yield* reader.readAlloc(1)).toEqual(Option.none());
      }),
    ),
  );
});

describe("layers", () => {
  it.effect("layerHandle provides a FileSystem and Path over a handle", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      yield* fs.makeDirectory("/notes");
      expect(yield* fs.readDirectory("/")).toEqual(["notes"]);
    }).pipe(Effect.provide(BrowserFileSystem.layerHandle(MemoryFileSystemHandle.make()))),
  );

  it.effect("layer fails NotFound where there is no OPFS", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(Effect.provide(probe, BrowserFileSystem.layer));
      expect(Exit.isFailure(exit)).toBe(true);
      expect(
        yield* withNavigator(undefined, reasonOf(Effect.provide(probe, BrowserFileSystem.layer))),
      ).toBe("NotFound");
      expect(
        yield* withNavigator({}, reasonOf(Effect.provide(probe, BrowserFileSystem.layer))),
      ).toBe("NotFound");
    }),
  );

  it.effect("layer roots at navigator.storage.getDirectory()", () =>
    Effect.gen(function* () {
      const root = MemoryFileSystemHandle.make();
      const storage = {
        getDirectory(this: unknown) {
          return this === storage
            ? Promise.resolve(root)
            : Promise.reject(new DOMException("unbound", "InvalidStateError"));
        },
      };
      const listing = yield* withNavigator(
        { storage },
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          yield* fs.writeFileString("/a.txt", "");
          return yield* fs.readDirectory("/");
        }).pipe(Effect.provide(BrowserFileSystem.layer)),
      );
      expect(listing).toEqual(["a.txt"]);
    }),
  );

  it.effect("layer maps a rejection with no DOMException name to Unknown", () =>
    Effect.gen(function* () {
      const storage = { getDirectory: () => Promise.reject("denied") };
      expect(
        yield* withNavigator({ storage }, reasonOf(Effect.provide(probe, BrowserFileSystem.layer))),
      ).toBe("Unknown");
    }),
  );

  it.effect("maps DOMException names onto reasons", () =>
    Effect.gen(function* () {
      const names = [
        ["SecurityError", "PermissionDenied"],
        ["NotAllowedError", "PermissionDenied"],
        ["InvalidStateError", "Busy"],
        ["TypeError", "InvalidData"],
      ] as const;
      const reasons = yield* Effect.forEach(
        names,
        ([name]) =>
          withNavigator(
            { storage: rejectingStorage(name) },
            reasonOf(Effect.provide(probe, BrowserFileSystem.layer)),
          ),
        { concurrency: 1 },
      );
      expect(reasons).toEqual(names.map(([, reason]) => reason));
    }),
  );
});
