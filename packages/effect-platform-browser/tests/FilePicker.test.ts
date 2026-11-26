import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as MemoryFileSystemHandle from "@thomasfosterau/effect-platform-worker-shared/MemoryFileSystemHandle";
import { FilePicker } from "@thomasfosterau/effect-platform-browser";
import { TestFilePicker } from "@thomasfosterau/effect-platform-browser/BrowserTesting";

const picker = Effect.service(FilePicker.FilePicker);
const control = Effect.service(TestFilePicker.Control);

/** A platform promise, its rejection as a string. */
const attempt = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: String });

/** Pickers that reject every call with `cause`. */
const rejecting = (cause: unknown): FilePicker.FilePickerLike => ({
  showOpenFilePicker: () => Promise.reject(cause),
  showSaveFilePicker: () => Promise.reject(cause),
  showDirectoryPicker: () => Promise.reject(cause),
});

describe("FilePicker.make", () => {
  it.effect("fails every picker Unsupported without the API", () =>
    Effect.gen(function* () {
      const unsupported = FilePicker.make();
      expect(unsupported.supported).toBe(false);
      const errors = yield* Effect.forEach(
        [
          Effect.asVoid(unsupported.open()),
          Effect.asVoid(unsupported.save()),
          Effect.asVoid(unsupported.directory()),
        ],
        Effect.flip,
        { concurrency: 1 },
      );
      expect(errors.map((error) => [error.method, error.reason])).toEqual([
        ["open", "Unsupported"],
        ["save", "Unsupported"],
        ["directory", "Unsupported"],
      ]);
    }),
  );

  it.effect("maps rejections onto reasons by DOMException name", () =>
    Effect.gen(function* () {
      const reasons = yield* Effect.forEach(
        [
          new DOMException("closed", "AbortError"),
          new DOMException("no gesture", "NotAllowedError"),
          new DOMException("cross-origin", "SecurityError"),
          new DOMException("odd", "TypeError"),
          "not an error",
        ],
        (cause) =>
          Effect.map(Effect.flip(FilePicker.make(rejecting(cause)).save()), (error) => ({
            reason: error.reason,
            kept: error.cause === cause,
          })),
        { concurrency: 1 },
      );
      expect(reasons.map((entry) => entry.reason)).toEqual([
        "Aborted",
        "NotAllowed",
        "NotAllowed",
        "Failed",
        "Failed",
      ]);
      expect(reasons.every((entry) => entry.kept)).toBe(true);
    }),
  );

  it.effect("treats an empty pick as a closed picker", () =>
    Effect.gen(function* () {
      const empty = FilePicker.make({
        ...rejecting(undefined),
        showOpenFilePicker: () => Promise.resolve([]),
      });
      expect((yield* Effect.flip(empty.open())).reason).toBe("Aborted");
    }),
  );
});

describe("FilePicker.optional", () => {
  it.effect("keeps a pick, turns a close into None, and keeps other failures", () =>
    Effect.gen(function* () {
      const { filePicker, control: drive } = TestFilePicker.make();
      yield* drive.pick(["/a.txt"]);
      const saved = yield* FilePicker.optional(filePicker.save());
      expect(Option.map(saved, (file) => file.name)).toEqual(Option.some("a.txt"));
      expect(yield* FilePicker.optional(filePicker.save())).toEqual(Option.none());
      yield* drive.deny;
      const denied = yield* Effect.flip(FilePicker.optional(filePicker.save()));
      expect(denied.reason).toBe("NotAllowed");
    }),
  );
});

describe("FilePicker.fileSystem", () => {
  it.effect("roots a FileSystem at the picked directory", () =>
    Effect.gen(function* () {
      const drive = yield* control;
      yield* drive.disk.makeDirectory("/projects/site", { recursive: true });
      yield* drive.disk.writeFileString("/projects/site/index.html", "<h1>hi</h1>");
      yield* drive.pick(["/projects/site"]);
      const fs = yield* FilePicker.fileSystem({ mode: "readwrite", id: "site" });
      expect(yield* fs.readFileString("/index.html")).toBe("<h1>hi</h1>");
      yield* fs.writeFileString("/about.html", "about");
      expect(yield* drive.disk.readFileString("/projects/site/about.html")).toBe("about");
      expect(yield* drive.requests).toEqual([
        { method: "directory", options: Option.some({ mode: "readwrite", id: "site" }) },
      ]);
    }).pipe(Effect.provide(TestFilePicker.layer())),
  );
});

describe("TestFilePicker", () => {
  it.effect("opens the files picked, and fails a missing one", () =>
    Effect.gen(function* () {
      const drive = yield* control;
      const pickers = yield* picker;
      yield* drive.disk.writeFileString("/a.txt", "a");
      yield* drive.disk.writeFileString("/b.txt", "b");
      yield* drive.pick(["/a.txt", "/b.txt"]);
      const files = yield* pickers.open({ multiple: true });
      expect(files.map((file) => file.name)).toEqual(["a.txt", "b.txt"]);
      yield* drive.pick(["/missing.txt"]);
      expect((yield* Effect.flip(pickers.open())).reason).toBe("Failed");
      yield* drive.cancel;
      expect((yield* Effect.flip(pickers.open())).reason).toBe("Aborted");
      expect((yield* drive.requests).map((request) => request.method)).toEqual([
        "open",
        "open",
        "open",
      ]);
      expect((yield* drive.requests)[0]?.options).toEqual(Option.some({ multiple: true }));
      expect((yield* drive.requests)[1]?.options).toEqual(Option.none());
    }).pipe(Effect.provide(TestFilePicker.layer())),
  );

  it.effect("saves to a new file, creating its parents, and refuses the root", () =>
    Effect.gen(function* () {
      const drive = yield* control;
      const pickers = yield* picker;
      yield* drive.pick(["/out/report.csv"]);
      const file = yield* pickers.save({ suggestedName: "report.csv" });
      expect(file.name).toBe("report.csv");
      expect(yield* drive.disk.exists("/out/report.csv")).toBe(true);
      yield* drive.pick(["/"]);
      expect((yield* Effect.flip(pickers.save())).reason).toBe("Failed");
      yield* drive.pick(["/"]);
      expect((yield* pickers.directory()).name).toBe("");
    }).pipe(Effect.provide(TestFilePicker.layer())),
  );

  it.effect("builds the unsupported service when asked", () =>
    Effect.map(picker, (pickers) => {
      expect(pickers.supported).toBe(false);
    }).pipe(Effect.provide(TestFilePicker.layer({ supported: false }))),
  );
});

describe("FilePicker permissions", () => {
  it.effect("reads and requests a stored handle's permission", () =>
    Effect.gen(function* () {
      const drive = yield* control;
      const stored = yield* drive.stored("/project");
      expect(yield* FilePicker.permission(stored)).toBe("prompt");
      yield* drive.respondToRequest("dismiss");
      expect(yield* FilePicker.requestPermission(stored, "readwrite")).toBe("prompt");
      yield* drive.respondToRequest("grant");
      expect(yield* FilePicker.requestPermission(stored, "readwrite")).toBe("granted");
      expect(yield* FilePicker.permission(stored, "readwrite")).toBe("granted");
      expect(yield* FilePicker.requestPermission(stored)).toBe("granted");
      yield* drive.setPermission(stored, "denied");
      expect(yield* FilePicker.requestPermission(stored)).toBe("denied");
      expect(yield* drive.permissionRequests).toEqual(["readwrite", "readwrite", "read", "read"]);
    }).pipe(Effect.provide(TestFilePicker.layer())),
  );

  it.effect("grants a picked handle, and refuses a request without a gesture", () =>
    Effect.gen(function* () {
      const drive = yield* control;
      const pickers = yield* picker;
      yield* drive.disk.writeFileString("/a.txt", "a");
      yield* drive.pick(["/a.txt"]);
      const [file] = yield* pickers.open();
      expect(yield* FilePicker.permission(file)).toBe("granted");
      const stored = yield* drive.stored("/later");
      yield* drive.respondToRequest("refuse");
      const refused = yield* Effect.flip(FilePicker.requestPermission(stored));
      expect([refused.method, refused.reason]).toEqual(["requestPermission", "NotAllowed"]);
      yield* drive.respondToRequest("deny");
      expect(yield* FilePicker.requestPermission(stored)).toBe("denied");
    }).pipe(Effect.provide(TestFilePicker.layer())),
  );

  it.effect("fails Unsupported for a handle without the permission methods", () =>
    Effect.gen(function* () {
      const plain = MemoryFileSystemHandle.make();
      const errors = yield* Effect.all(
        [
          Effect.flip(FilePicker.permission(plain)),
          Effect.flip(FilePicker.requestPermission(plain)),
        ],
        { concurrency: 1 },
      );
      expect(errors.map((error) => [error.method, error.reason])).toEqual([
        ["permission", "Unsupported"],
        ["requestPermission", "Unsupported"],
      ]);
    }),
  );
});

describe("FilePicker.fileSystem over a stored handle", () => {
  it.effect("asks for the permission it lacks, then roots a FileSystem at the handle", () =>
    Effect.gen(function* () {
      const drive = yield* control;
      yield* drive.disk.makeDirectory("/project");
      yield* drive.disk.writeFileString("/project/README.md", "# Hi");
      const stored = yield* drive.stored("/project");
      yield* drive.respondToRequest("grant");
      const fs = yield* FilePicker.fileSystem({ handle: stored, mode: "readwrite" });
      expect(yield* fs.readDirectory("/")).toEqual(["README.md"]);
      const again = yield* FilePicker.fileSystem({ handle: stored });
      expect(yield* again.readFileString("/README.md")).toBe("# Hi");
      expect(yield* drive.permissionRequests).toEqual(["readwrite"]);
      expect(yield* drive.requests).toEqual([]);
    }).pipe(Effect.provide(TestFilePicker.layer())),
  );

  it.effect("fails NotAllowed when the user denies or dismisses, or it was denied", () =>
    Effect.gen(function* () {
      const drive = yield* control;
      const stored = yield* drive.stored("/project");
      yield* drive.respondToRequest("deny");
      const denied = yield* Effect.flip(FilePicker.fileSystem({ handle: stored }));
      expect([denied.method, denied.reason, denied.cause]).toEqual([
        "requestPermission",
        "NotAllowed",
        "denied",
      ]);
      const again = yield* Effect.flip(FilePicker.fileSystem({ handle: stored }));
      expect(again.reason).toBe("NotAllowed");
      const other = yield* drive.stored("/other");
      const dismissed = yield* Effect.flip(FilePicker.fileSystem({ handle: other }));
      expect([dismissed.reason, dismissed.cause]).toEqual(["NotAllowed", "prompt"]);
      expect(yield* drive.permissionRequests).toEqual(["read", "read"]);
    }).pipe(Effect.provide(TestFilePicker.layer())),
  );

  it.effect("reads and writes through the handles it hands out", () =>
    Effect.gen(function* () {
      const drive = yield* control;
      const pickers = yield* picker;
      yield* drive.disk.writeFileString("/notes.txt", "old");
      yield* drive.pick(["/notes.txt"]);
      const [file] = yield* pickers.open();
      const writable = yield* attempt(() => file.createWritable());
      yield* attempt(() => writable.write(new TextEncoder().encode("new")));
      yield* attempt(() => writable.close());
      const read = yield* attempt(() => file.getFile());
      expect(read.size).toBe(3);
      const stored = yield* drive.stored("/project");
      yield* drive.setPermission(stored, "granted");
      const fs = yield* FilePicker.fileSystem({ handle: stored });
      yield* fs.makeDirectory("/tmp");
      yield* fs.remove("/tmp");
      expect(yield* fs.readDirectory("/")).toEqual([]);
    }).pipe(Effect.provide(TestFilePicker.layer())),
  );

  it.effect("dies when a stored path runs through a file", () =>
    Effect.gen(function* () {
      const drive = yield* control;
      yield* drive.disk.writeFileString("/file", "x");
      const exit = yield* Effect.exit(drive.stored("/file/inner"));
      expect(Exit.hasDies(exit)).toBe(true);
    }).pipe(Effect.provide(TestFilePicker.layer())),
  );

  it.effect("uses a handle without the permission methods as it is", () =>
    Effect.gen(function* () {
      const fs = yield* FilePicker.fileSystem({ handle: MemoryFileSystemHandle.make() });
      expect(yield* fs.readDirectory("/")).toEqual([]);
    }).pipe(Effect.provide(TestFilePicker.layer())),
  );
});
