import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { FilePicker } from "@thomasfosterau/effect-platform-browser";
import { TestFilePicker } from "@thomasfosterau/effect-platform-browser/BrowserTesting";

const picker = Effect.service(FilePicker.FilePicker);
const control = Effect.service(TestFilePicker.Control);

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
