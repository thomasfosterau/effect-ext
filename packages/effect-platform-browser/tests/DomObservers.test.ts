/**
 * Unit tests for `DomObservers`, driven through `BrowserTesting`'s
 * `TestDomObservers` and, for the platform's sparser entries, through
 * `DomObservers.make` over hand-built observers.
 */

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { DomObservers } from "@thomasfosterau/effect-platform-browser";
import { TestDomObservers } from "@thomasfosterau/effect-platform-browser/BrowserTesting";

const run = <A, E>(
  effect: Effect.Effect<A, E, DomObservers.DomObservers | TestDomObservers.Control>,
  options?: TestDomObservers.Options,
) => Effect.provide(effect, TestDomObservers.layer(options));

/** Collects the first `count` elements of `stream`, once the double sees its observer. */
const collect = <A, E>(
  stream: Stream.Stream<A, E, DomObservers.DomObservers>,
  target: DomObservers.NodeLike,
  kind: TestDomObservers.Kind,
  count: number,
) =>
  Effect.gen(function* () {
    const control = yield* TestDomObservers.Control;
    const fiber = yield* Effect.forkChild(Stream.runCollect(Stream.take(stream, count)));
    yield* control.awaitObserved(target, kind);
    return fiber;
  });

describe("DomObservers.intersection", () => {
  it.effect("reports the target's state at once, then each change, and disconnects when done", () =>
    Effect.gen(function* () {
      const result = yield* run(
        Effect.gen(function* () {
          const control = yield* TestDomObservers.Control;
          const card = control.element("card");
          yield* control.setSize(card, { width: 100, height: 40 });
          const fiber = yield* collect(DomObservers.intersection(card), card, "intersection", 3);
          yield* control.setIntersecting(card, true, 0.5);
          yield* control.setIntersecting(card, true, 0.5);
          yield* control.setIntersecting(card, false);
          const seen = yield* Fiber.join(fiber);
          return {
            seen: seen.map(({ isIntersecting, ratio, intersectionRect }) => ({
              isIntersecting,
              ratio,
              height: intersectionRect.height,
            })),
            first: seen[0],
            observers: yield* control.observers(card, "intersection"),
          };
        }),
        { viewport: { width: 800, height: 600 } },
      );
      expect(result.seen).toStrictEqual([
        { isIntersecting: false, ratio: 0, height: 0 },
        { isIntersecting: true, ratio: 0.5, height: 20 },
        { isIntersecting: false, ratio: 0, height: 0 },
      ]);
      expect(result.first).toMatchObject({
        target: { id: "card" },
        boundingClientRect: { x: 0, y: 0, width: 100, height: 40 },
        rootBounds: Option.some({ x: 0, y: 0, width: 800, height: 600 }),
      });
      expect(result.observers).toBe(0);
    }),
  );

  it.effect("refuses a malformed rootMargin or a threshold outside 0 to 1", () =>
    Effect.gen(function* () {
      const result = yield* run(
        Effect.gen(function* () {
          const control = yield* TestDomObservers.Control;
          const card = control.element("card");
          const reasonOf = (options: IntersectionObserverInit) =>
            Effect.flip(Stream.runHead(DomObservers.intersection(card, options))).pipe(
              Effect.map((error) => error.reason),
              Effect.orElseSucceed(() => "started"),
            );
          return yield* Effect.all(
            [
              reasonOf({ rootMargin: "10 pixels" }),
              reasonOf({ threshold: 1.5 }),
              reasonOf({ threshold: [0, -0.1] }),
              reasonOf({ rootMargin: "10px 5%", threshold: 0.25 }),
            ],
            { concurrency: 1 },
          );
        }),
      );
      expect(result).toStrictEqual([
        "InvalidOptions",
        "InvalidOptions",
        "InvalidOptions",
        "started",
      ]);
    }),
  );
});

describe("DomObservers.resize", () => {
  it.effect("reports the target's size at once, then each change", () =>
    Effect.gen(function* () {
      const result = yield* run(
        Effect.gen(function* () {
          const control = yield* TestDomObservers.Control;
          const panel = control.element("panel");
          const fiber = yield* collect(DomObservers.resize(panel), panel, "resize", 2);
          yield* control.setSize(panel, { width: 0, height: 0 });
          yield* control.setSize(panel, { width: 320, height: 200 });
          return yield* Fiber.join(fiber);
        }),
      );
      expect(result.map((entry) => entry.contentRect)).toStrictEqual([
        { x: 0, y: 0, width: 0, height: 0 },
        { x: 0, y: 0, width: 320, height: 200 },
      ]);
      expect(result[1]).toMatchObject({
        contentBoxSize: [{ inlineSize: 320, blockSize: 200 }],
        borderBoxSize: [{ inlineSize: 320, blockSize: 200 }],
        devicePixelContentBoxSize: [{ inlineSize: 320, blockSize: 200 }],
      });
    }),
  );
});

describe("DomObservers.mutation", () => {
  it.effect("delivers each batch in order, keeping the record types the options observe", () =>
    Effect.gen(function* () {
      const result = yield* run(
        Effect.gen(function* () {
          const control = yield* TestDomObservers.Control;
          const list = control.element("list");
          const item = control.element("item");
          const fiber = yield* collect(
            DomObservers.mutation(list, { childList: true }),
            list,
            "mutation",
            2,
          );
          yield* control.mutate(list, [{ addedNodes: [item] }, { type: "attributes" }]);
          yield* control.mutate(list, [{ type: "characterData" }]);
          yield* control.mutate(list, [{ type: "childList", removedNodes: [item], target: item }]);
          return yield* Fiber.join(fiber);
        }),
      );
      expect(result).toStrictEqual([
        [
          {
            type: "childList",
            target: { id: "list", nodeName: "TEST-ELEMENT" },
            addedNodes: [{ id: "item", nodeName: "TEST-ELEMENT" }],
            removedNodes: [],
            attributeName: Option.none(),
            oldValue: Option.none(),
          },
        ],
        [
          {
            type: "childList",
            target: { id: "item", nodeName: "TEST-ELEMENT" },
            addedNodes: [],
            removedNodes: [{ id: "item", nodeName: "TEST-ELEMENT" }],
            attributeName: Option.none(),
            oldValue: Option.none(),
          },
        ],
      ]);
    }),
  );

  it.effect(
    "keeps old values only where asked, and implies the record types the old values name",
    () =>
      Effect.gen(function* () {
        const result = yield* run(
          Effect.gen(function* () {
            const control = yield* TestDomObservers.Control;
            const node = control.element("node");
            const records = [
              { type: "attributes", attributeName: "class", oldValue: "a" },
              { type: "attributes", attributeName: "id" },
              { type: "characterData", oldValue: "text" },
              { type: "childList", oldValue: "ignored" },
            ] as const;
            const batch = (options: MutationObserverInit) =>
              Effect.gen(function* () {
                const fiber = yield* collect(
                  DomObservers.mutation(node, options),
                  node,
                  "mutation",
                  1,
                );
                yield* control.mutate(node, records);
                const [first = []] = yield* Fiber.join(fiber);
                return first.map((record) => [record.type, record.attributeName, record.oldValue]);
              });
            return yield* Effect.all(
              [
                batch({ attributeOldValue: true, characterDataOldValue: true, childList: true }),
                batch({ attributes: true, characterData: true }),
                batch({ attributeFilter: ["class"] }),
              ],
              { concurrency: 1 },
            );
          }),
        );
        expect(result).toStrictEqual([
          [
            ["attributes", Option.some("class"), Option.some("a")],
            ["attributes", Option.some("id"), Option.none()],
            ["characterData", Option.none(), Option.some("text")],
            ["childList", Option.none(), Option.none()],
          ],
          [
            ["attributes", Option.some("class"), Option.none()],
            ["attributes", Option.some("id"), Option.none()],
            ["characterData", Option.none(), Option.none()],
          ],
          [["attributes", Option.some("class"), Option.none()]],
        ]);
      }),
  );

  it.effect("refuses options that observe nothing", () =>
    Effect.gen(function* () {
      const reasons = yield* run(
        Effect.gen(function* () {
          const control = yield* TestDomObservers.Control;
          const node = control.element("node");
          return yield* Effect.forEach(
            [{}, { attributes: false, attributeOldValue: true }, { characterData: false }],
            (options) =>
              Effect.map(
                Effect.flip(Stream.runDrain(DomObservers.mutation(node, options))),
                (error) => error.reason,
              ),
            { concurrency: 1 },
          );
        }),
      );
      expect(reasons).toStrictEqual(["InvalidOptions", "InvalidOptions", "InvalidOptions"]);
    }),
  );
});

describe("DomObservers.awaitVisible / whileVisible", () => {
  it.effect("waits for the target to come into view", () =>
    Effect.gen(function* () {
      const result = yield* run(
        Effect.gen(function* () {
          const control = yield* TestDomObservers.Control;
          const footer = control.element("footer");
          const fiber = yield* Effect.forkChild(DomObservers.awaitVisible(footer));
          yield* control.awaitObserved(footer, "intersection");
          yield* control.setIntersecting(footer, true);
          yield* Fiber.join(fiber);
          return "seen";
        }),
      );
      expect(result).toBe("seen");
    }),
  );

  it.effect("runs the effect while the target is in view, in either argument order", () =>
    Effect.gen(function* () {
      const result = yield* run(
        Effect.gen(function* () {
          const control = yield* TestDomObservers.Control;
          const video = control.element("video");
          yield* control.setIntersecting(video, true);
          return [
            yield* DomObservers.whileVisible(Effect.succeed("played"), video),
            yield* Effect.succeed("again").pipe(DomObservers.whileVisible(video, { threshold: 0 })),
          ];
        }),
      );
      expect(result).toStrictEqual([Option.some("played"), Option.some("again")]);
    }),
  );

  it.effect("interrupts the effect, and returns None, when the target leaves view", () =>
    Effect.gen(function* () {
      const result = yield* run(
        Effect.gen(function* () {
          const control = yield* TestDomObservers.Control;
          const video = control.element("video");
          yield* control.setIntersecting(video, true);
          const fiber = yield* Effect.forkChild(DomObservers.whileVisible(Effect.never, video));
          yield* Effect.repeat(control.observers(video, "intersection"), {
            until: (count) => count === 1,
          });
          yield* Effect.yieldNow;
          yield* control.setIntersecting(video, false);
          return yield* Fiber.join(fiber);
        }),
      );
      expect(result).toStrictEqual(Option.none());
    }),
  );
});

describe("TestDomObservers.Control", () => {
  it.effect("hands out one stand-in per id, and resolves awaitObserved at once when observed", () =>
    Effect.gen(function* () {
      const result = yield* run(
        Effect.gen(function* () {
          const control = yield* TestDomObservers.Control;
          const same = control.element("a") === control.element("a");
          const a = control.element("a");
          return yield* Effect.scoped(
            Effect.gen(function* () {
              yield* Effect.forkScoped(Stream.runDrain(DomObservers.resize(a)));
              yield* control.awaitObserved(a, "resize");
              yield* control.awaitObserved(a, "resize");
              return { same, observers: yield* control.observers(a, "resize") };
            }),
          );
        }),
      );
      expect(result).toStrictEqual({ same: true, observers: 1 });
    }),
  );

  it.effect("forgets an interrupted awaitObserved", () =>
    Effect.gen(function* () {
      const result = yield* run(
        Effect.gen(function* () {
          const control = yield* TestDomObservers.Control;
          const a = control.element("a");
          const waiting = yield* Effect.forkChild(control.awaitObserved(a, "mutation"));
          yield* Effect.yieldNow;
          yield* Fiber.interrupt(waiting);
          const fiber = yield* collect(
            DomObservers.mutation(a, { childList: true }),
            a,
            "mutation",
            1,
          );
          yield* control.mutate(a, [{}]);
          return (yield* Fiber.join(fiber)).length;
        }),
      );
      expect(result).toBe(1);
    }),
  );
});

describe("DomObservers without observers", () => {
  it.effect("reports each observer unsupported, and fails its stream Unsupported", () =>
    Effect.gen(function* () {
      const result = yield* run(
        Effect.gen(function* () {
          const observers = yield* DomObservers.DomObservers;
          const control = yield* TestDomObservers.Control;
          const node = control.element("node");
          const streams: ReadonlyArray<
            Stream.Stream<unknown, DomObservers.DomObserverError, DomObservers.DomObservers>
          > = [
            DomObservers.intersection(node),
            DomObservers.resize(node),
            DomObservers.mutation(node, { childList: true }),
          ];
          const reasons = yield* Effect.forEach(
            streams,
            (stream) => Effect.map(Effect.flip(Stream.runDrain(stream)), (error) => error.message),
            { concurrency: 1 },
          );
          return { supported: observers.supported, reasons };
        }),
        { supported: false },
      );
      expect(result).toStrictEqual({
        supported: { intersection: false, resize: false, mutation: false },
        reasons: [
          "intersection observer: Unsupported",
          "resize observer: Unsupported",
          "mutation observer: Unsupported",
        ],
      });
    }),
  );

  it.effect("builds the live layer under Node", () =>
    Effect.gen(function* () {
      const supported = yield* Effect.provide(
        Effect.map(DomObservers.DomObservers, (observers) => observers.supported),
        DomObservers.layer,
      );
      expect(supported).toStrictEqual({ intersection: false, resize: false, mutation: false });
    }),
  );
});

/** An observer whose `observe` throws an exception the adapter has no reason for. */
class Unknowable {
  observe(): void {
    throw new DOMException("odd", "UnknownError");
  }
  disconnect() {}
}

describe("DomObservers over the platform's sparser entries", () => {
  const node: DomObservers.NodeLike = { nodeName: "DIV" };
  const rect = { x: 1, y: 2, width: 3, height: 4, top: 2, left: 1 };

  it.effect("reads a withheld rootBounds as None, and missing box sizes as empty", () =>
    Effect.gen(function* () {
      const observers = DomObservers.make({
        IntersectionObserver: class {
          readonly #deliver;
          constructor(
            deliver: (entries: ReadonlyArray<DomObservers.IntersectionEntryLike>) => void,
          ) {
            this.#deliver = deliver;
          }
          observe(target: DomObservers.NodeLike) {
            this.#deliver([
              {
                target,
                time: 1,
                isIntersecting: true,
                intersectionRatio: 1,
                boundingClientRect: rect,
                intersectionRect: rect,
                rootBounds: null,
              },
            ]);
          }
          disconnect() {}
        },
        ResizeObserver: class {
          readonly #deliver;
          constructor(deliver: (entries: ReadonlyArray<DomObservers.ResizeEntryLike>) => void) {
            this.#deliver = deliver;
          }
          observe(target: DomObservers.NodeLike) {
            this.#deliver([{ target, contentRect: rect }]);
          }
          disconnect() {}
        },
      });
      const [intersection, resize] = yield* Effect.all(
        [Stream.runHead(observers.intersection(node)), Stream.runHead(observers.resize(node))],
        { concurrency: 1 },
      );
      expect(
        Option.map(intersection, (entry) => [entry.rootBounds, entry.intersectionRect]),
      ).toStrictEqual(Option.some([Option.none(), { x: 1, y: 2, width: 3, height: 4 }]));
      expect(resize).toStrictEqual(
        Option.some({
          target: node,
          contentRect: { x: 1, y: 2, width: 3, height: 4 },
          contentBoxSize: [],
          borderBoxSize: [],
          devicePixelContentBoxSize: [],
        }),
      );
    }),
  );

  it.effect("maps any other exception from the platform to Failed", () =>
    Effect.gen(function* () {
      const observers = DomObservers.make({
        MutationObserver: Unknowable,
      });
      const error = yield* Effect.flip(
        Stream.runDrain(observers.mutation(node, { childList: true })),
      );
      expect(error).toMatchObject({ observer: "mutation", reason: "Failed" });
    }),
  );
});
