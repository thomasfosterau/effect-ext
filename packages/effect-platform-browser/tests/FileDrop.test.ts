import { describe, expect, it } from "@effect/vitest";
import * as BrowserFileSystem from "@thomasfosterau/effect-platform-worker-shared/BrowserFileSystem";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { FileDrop } from "@thomasfosterau/effect-platform-browser";
import { TestFileDrop } from "@thomasfosterau/effect-platform-browser/BrowserTesting";

/** Each dropped item as its tag and name. */
const describeItem = (item: FileDrop.DroppedItem): readonly [string, string] =>
  FileDrop.DroppedItem.$match(item, {
    File: ({ handle }) => ["File", handle.name] as const,
    Directory: ({ handle }) => ["Directory", handle.name] as const,
    Blob: ({ file }) => ["Blob", file.name] as const,
  });

/** Collects the next `count` drops onto the fixture's target, driven by `drive`. */
const collect = <E>(fixture: TestFileDrop.Fixture, count: number, drive: Effect.Effect<void, E>) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(
      Stream.runCollect(Stream.take(FileDrop.drops(fixture.target), count)),
    );
    yield* fixture.control.listening;
    yield* drive;
    const drops = yield* Fiber.join(fiber);
    return Arr.map(drops, Arr.map(describeItem));
  });

describe("FileDrop.drops", () => {
  it.effect("emits each drop's files and directories as handles, in order", () => {
    const fixture = TestFileDrop.make();
    const { disk } = fixture.control;
    return Effect.gen(function* () {
      yield* disk.writeFileString("/notes.txt", "hi");
      yield* disk.makeDirectory("/photos/2026", { recursive: true });
      const drops = yield* collect(
        fixture,
        2,
        Effect.andThen(
          fixture.control.drop(["/notes.txt", "/photos"]),
          fixture.control.drop(["/photos/2026"]),
        ),
      );
      expect(drops).toEqual([
        [
          ["File", "notes.txt"],
          ["Directory", "photos"],
        ],
        [["Directory", "2026"]],
      ]);
      expect(yield* fixture.control.prevented).toBe(4);
    });
  });

  it.effect("drops a directory that becomes a FileSystem", () => {
    const fixture = TestFileDrop.make();
    return Effect.gen(function* () {
      yield* fixture.control.disk.makeDirectory("/project");
      yield* fixture.control.disk.writeFileString("/project/README.md", "# Hi");
      const fiber = yield* Effect.forkChild(Stream.runHead(FileDrop.drops(fixture.target)));
      yield* fixture.control.listening;
      yield* fixture.control.drop(["/project"]);
      const dropped = yield* Fiber.join(fiber);
      const handle = Option.flatMap(dropped, (items) =>
        Option.liftPredicate(items[0], FileDrop.DroppedItem.$is("Directory")),
      ).pipe(Option.map((item) => item.handle));
      const fs = BrowserFileSystem.make(yield* Effect.fromOption(handle));
      expect(yield* fs.readFileString("/README.md")).toBe("# Hi");
    });
  });

  it.effect("drops plain Files where the agent has no handles, and skips other items", () => {
    const fixture = TestFileDrop.make({ handles: false });
    return Effect.gen(function* () {
      yield* fixture.control.disk.writeFileString("/a.txt", "abc");
      yield* fixture.control.disk.makeDirectory("/folder");
      const drops = yield* collect(
        fixture,
        1,
        Effect.gen(function* () {
          yield* fixture.control.dropText;
          yield* fixture.control.drop(["/folder"]);
          yield* fixture.control.drop(["/a.txt", "/folder"]);
        }),
      );
      expect(drops).toEqual([[["Blob", "a.txt"]]]);
    });
  });

  it.effect("stops accepting drops once the stream ends", () => {
    const fixture = TestFileDrop.make();
    return Effect.gen(function* () {
      yield* fixture.control.disk.writeFileString("/a.txt", "a");
      yield* collect(fixture, 1, fixture.control.drop(["/a.txt"]));
      yield* fixture.control.drop(["/a.txt"]);
      expect(yield* fixture.control.prevented).toBe(2);
    });
  });

  it.effect("empties a drop's items once its listeners return", () => {
    const fixture = TestFileDrop.make();
    const seen: Array<FileDrop.DragEventLike> = [];
    fixture.target.addEventListener("drop", (event) => {
      seen.push(event);
    });
    return Effect.gen(function* () {
      yield* fixture.control.disk.makeDirectory("/a", { recursive: true });
      yield* fixture.control.disk.writeFileString("/a/b.txt", "b");
      yield* fixture.control.drop(["/a/b.txt"]);
      yield* fixture.control.dropText;
      const items = Arr.flatMap(seen, (event) => Arr.fromIterable(event.dataTransfer?.items ?? []));
      expect(Arr.map(items, (item) => [item.kind, item.getAsFile()])).toEqual([
        ["file", null],
        ["string", null],
      ]);
      const handles = yield* Effect.tryPromise({
        try: () =>
          Promise.all(
            Arr.map(items, (item) =>
              item.getAsFileSystemHandle === undefined
                ? Promise.resolve(undefined)
                : item.getAsFileSystemHandle(),
            ),
          ),
        catch: String,
      });
      expect(handles).toEqual([null, null]);
    });
  });

  it.effect("dies when a dropped path is not a disk entry", () =>
    Effect.gen(function* () {
      const { control: drive } = TestFileDrop.make();
      const exits = yield* Effect.all(
        [Effect.exit(drive.drop(["/missing"])), Effect.exit(drive.drop(["/"]))],
        { concurrency: 1 },
      );
      expect(Arr.map(exits, Exit.hasDies)).toEqual([true, true]);
    }),
  );
});

describe("FileDrop.drops over a real-shaped item", () => {
  it.effect("falls back to the File when the handle is refused or missing", () =>
    Effect.gen(function* () {
      const listeners: Array<(event: FileDrop.DragEventLike) => void> = [];
      const target: FileDrop.DropTargetLike = {
        addEventListener: (type, listener) => {
          if (type === "drop") listeners.push(listener);
        },
        removeEventListener: () => {},
      };
      const file = new File(["x"], "x.txt");
      const fiber = yield* Effect.forkChild(Stream.runHead(FileDrop.drops(target)));
      yield* Effect.repeat(
        Effect.map(Effect.yieldNow, () => listeners.length),
        { until: (count) => count > 0 },
      );
      const event: FileDrop.DragEventLike = {
        preventDefault: () => {},
        dataTransfer: {
          items: [
            {
              kind: "file",
              getAsFile: () => file,
              getAsFileSystemHandle: () =>
                Promise.reject(new DOMException("no", "NotAllowedError")),
            },
            {
              kind: "file",
              getAsFile: () => file,
              getAsFileSystemHandle: () => Promise.resolve(null),
            },
            {
              kind: "file",
              getAsFile: () => null,
              getAsFileSystemHandle: () => Promise.resolve(null),
            },
          ],
        },
      };
      Arr.forEach(listeners, (listener) => listener(event));
      Arr.forEach(listeners, (listener) =>
        listener({ preventDefault: () => {}, dataTransfer: null }),
      );
      const dropped = yield* Fiber.join(fiber);
      expect(Option.map(dropped, Arr.map(describeItem))).toEqual(
        Option.some([
          ["Blob", "x.txt"],
          ["Blob", "x.txt"],
        ]),
      );
    }),
  );
});
