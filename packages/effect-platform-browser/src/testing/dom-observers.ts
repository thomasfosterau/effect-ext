/**
 * Controllable DOM observers for tests of code that uses `DomObservers`:
 * {@link layer} provides the real adapter over in-memory
 * `IntersectionObserver`, `ResizeObserver` and `MutationObserver`
 * constructors, plus {@link Control} to scroll a target into view, resize
 * it and mutate it, delivering entries to its observers as the browser
 * would.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as MutableHashMap from "effect/MutableHashMap";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import {
  DomObservers,
  type IntersectionEntryLike,
  type MutationRecordLike,
  type Rect,
  type ResizeEntryLike,
  type NodeLike,
  make as makeDomObservers,
} from "../DomObservers.ts";

/**
 * Which observer a target is watched by.
 *
 * @since 0.1.0
 * @category models
 */
export type Kind = "intersection" | "resize" | "mutation";

/**
 * A target's size, in CSS pixels.
 *
 * @since 0.1.0
 * @category models
 */
export interface Size {
  readonly width: number;
  readonly height: number;
}

/**
 * One change {@link Control}'s `mutate` delivers. `type` defaults to
 * `"childList"`, the nodes to none, and `attributeName` / `oldValue` to
 * absent; `target` defaults to the observed target.
 *
 * @since 0.1.0
 * @category models
 */
export interface MutationInit {
  readonly type?: MutationRecordType;
  readonly target?: NodeLike;
  readonly addedNodes?: ReadonlyArray<NodeLike>;
  readonly removedNodes?: ReadonlyArray<NodeLike>;
  readonly attributeName?: string;
  readonly oldValue?: string;
}

/**
 * The in-memory observers' starting behaviour.
 *
 * - `supported` (default `true`) — builds the service with no observers
 *   when `false`.
 * - `viewport` (default 1280 × 720) — the root's bounds every intersection
 *   entry reports.
 *
 * @since 0.1.0
 * @category models
 */
export interface Options {
  readonly supported?: boolean;
  readonly viewport?: Size;
}

/**
 * Drives the in-memory observers.
 *
 * - `element` — the stand-in element for `id`: the same object for the
 *   same id.
 * - `setIntersecting` — moves the target into or out of the root (with
 *   the visible `ratio`, default 1 in and 0 out) and delivers an entry to
 *   its intersection observers; a no-op when nothing changed. A target
 *   starts out of view.
 * - `setSize` — resizes the target and delivers an entry to its resize
 *   observers; a no-op when unchanged. A target starts 0 × 0.
 * - `mutate` — delivers one batch of records to the target's mutation
 *   observers, each keeping only the record types (and, with an
 *   `attributeFilter`, the attributes) its options observe.
 * - `observers` — how many observers of `kind` watch the target now.
 * - `awaitObserved` — waits until an observer of `kind` watches the
 *   target: the sync point before driving a `mutation` stream, which
 *   emits nothing on subscribe.
 *
 * @since 0.1.0
 * @category services
 */
export class Control extends Context.Service<
  Control,
  {
    readonly element: (id: string) => NodeLike;
    readonly setIntersecting: (
      target: NodeLike,
      isIntersecting: boolean,
      ratio?: number,
    ) => Effect.Effect<void>;
    readonly setSize: (target: NodeLike, size: Size) => Effect.Effect<void>;
    readonly mutate: (
      target: NodeLike,
      records: ReadonlyArray<MutationInit>,
    ) => Effect.Effect<void>;
    readonly observers: (target: NodeLike, kind: Kind) => Effect.Effect<number>;
    readonly awaitObserved: (target: NodeLike, kind: Kind) => Effect.Effect<void>;
  }
>()("@thomasfosterau/effect-platform-browser/BrowserTesting/DomObserversControl") {}

/**
 * What {@link make} builds: the `DomObservers` service over the in-memory
 * observers, and the {@link Control} that drives them.
 *
 * @since 0.1.0
 * @category models
 */
export interface Fixture {
  readonly domObservers: DomObservers["Service"];
  readonly control: Control["Service"];
}

interface Placement {
  intersecting: boolean;
  ratio: number;
  size: Size;
}

/** One observer watching one target; `deliver` hands it the platform's callback argument. */
interface Registration<Delivery> {
  readonly target: NodeLike;
  /** The observer's own key: `disconnect` drops every registration under it. */
  readonly key: symbol;
  readonly deliver: (delivery: Delivery) => void;
}

interface MutationRegistration extends Registration<ReadonlyArray<MutationRecordLike>> {
  readonly options: MutationObserverInit;
}

interface Waiter {
  readonly kind: Kind;
  readonly target: NodeLike;
  readonly resume: () => void;
}

const DEFAULT_VIEWPORT: Size = { width: 1280, height: 720 };

const rectOf = (size: Size): Rect => ({ x: 0, y: 0, ...size });

/** A `rootMargin` the platform parses: one to four lengths, in px or %. */
const ROOT_MARGIN = /^\s*(?:-?\d+(?:\.\d+)?(?:px|%)?\s*){1,4}$/;

const validThreshold = (threshold: number | ReadonlyArray<number>): boolean =>
  Arr.every(P.isNumber(threshold) ? [threshold] : threshold, (value) => value >= 0 && value <= 1);

/** Whether `options` observe anything at all, as `MutationObserver.observe` requires. */
const observesSomething = (options: MutationObserverInit): boolean =>
  options.childList === true || observesAttributes(options) || observesCharacterData(options);

const observesAttributes = (options: MutationObserverInit): boolean =>
  options.attributes === true ||
  (options.attributes === undefined &&
    (options.attributeOldValue === true || options.attributeFilter !== undefined));

const observesCharacterData = (options: MutationObserverInit): boolean =>
  options.characterData === true ||
  (options.characterData === undefined && options.characterDataOldValue === true);

/** Whether options that observe this record type keep a record of it. */
const KEEPS = {
  childList: (options) => options.childList === true,
  attributes: observesAttributes,
  characterData: observesCharacterData,
} satisfies Readonly<Record<MutationRecordType, (options: MutationObserverInit) => boolean>>;

/** Whether an `attributeFilter` lets the record through: it names the attributes to keep. */
const passesFilter = (options: MutationObserverInit, init: MutationInit): boolean =>
  options.attributeFilter === undefined ||
  init.type !== "attributes" ||
  Arr.contains(options.attributeFilter, init.attributeName);

/** Whether options keep a record's old value: a child-list record has none. */
const KEEPS_OLD_VALUE = {
  childList: () => false,
  attributes: (options) => options.attributeOldValue === true,
  characterData: (options) => options.characterDataOldValue === true,
} satisfies Readonly<Record<MutationRecordType, (options: MutationObserverInit) => boolean>>;

/**
 * Builds the in-memory observers: the `DomObservers` service over them, and
 * their {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import { TestDomObservers } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const { domObservers, control } = TestDomObservers.make()
 * const hero = control.element("hero")
 * const program = Effect.andThen(
 *   control.setIntersecting(hero, true),
 *   Stream.runHead(domObservers.intersection(hero)),
 * )
 * Effect.runPromise(program).then((first) => console.log(first._tag)) // "Some"
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = (options?: Options): Fixture => {
  const viewport = rectOf(options?.viewport ?? DEFAULT_VIEWPORT);
  const elements = MutableHashMap.empty<string, NodeLike>();
  const placements = new WeakMap<NodeLike, Placement>();
  const intersections: Array<Registration<ReadonlyArray<IntersectionEntryLike>>> = [];
  const resizes: Array<Registration<ReadonlyArray<ResizeEntryLike>>> = [];
  const mutations: Array<MutationRegistration> = [];
  const registries = { intersection: intersections, resize: resizes, mutation: mutations };
  const waiters: Array<Waiter> = [];

  const placementOf = (target: NodeLike): Placement => {
    const known = placements.get(target);
    if (known !== undefined) return known;
    const fresh: Placement = { intersecting: false, ratio: 0, size: { width: 0, height: 0 } };
    placements.set(target, fresh);
    return fresh;
  };

  const intersectionEntry = (target: NodeLike): IntersectionEntryLike => {
    const { intersecting, ratio, size } = placementOf(target);
    return {
      target,
      time: performance.now(),
      isIntersecting: intersecting,
      intersectionRatio: ratio,
      boundingClientRect: rectOf(size),
      intersectionRect: rectOf({ width: size.width, height: size.height * ratio }),
      rootBounds: viewport,
    };
  };

  const resizeEntry = (target: NodeLike): ResizeEntryLike => {
    const { size } = placementOf(target);
    const box = [{ inlineSize: size.width, blockSize: size.height }];
    return {
      target,
      contentRect: rectOf(size),
      contentBoxSize: box,
      borderBoxSize: box,
      devicePixelContentBoxSize: box,
    };
  };

  const watching = (target: NodeLike, kind: Kind): ReadonlyArray<Registration<never>> =>
    Arr.filter<Registration<never>>(
      registries[kind],
      (registration) => registration.target === target,
    );

  const register = <R extends Registration<never>>(
    kind: Kind,
    registry: Array<R>,
    registration: R,
  ): void => {
    registry.push(registration);
    const matches = (waiter: Waiter) =>
      waiter.kind === kind && waiter.target === registration.target;
    const ready = Arr.filter(waiters, matches);
    waiters.splice(0, waiters.length, ...Arr.filter(waiters, (waiter) => !matches(waiter)));
    Arr.forEach(ready, (waiter) => waiter.resume());
  };

  const unregister = (registry: Array<Registration<never>>, key: symbol): void => {
    const kept = Arr.filter(registry, (registration) => registration.key !== key);
    registry.splice(0, registry.length, ...kept);
  };

  class TestIntersectionObserver {
    readonly #key = Symbol("TestIntersectionObserver");
    readonly #deliver: (entries: ReadonlyArray<IntersectionEntryLike>) => void;
    constructor(
      callback: (entries: ReadonlyArray<IntersectionEntryLike>) => void,
      init?: IntersectionObserverInit,
    ) {
      if (init?.rootMargin !== undefined && !ROOT_MARGIN.test(init.rootMargin)) {
        throw new DOMException("Failed to parse rootMargin", "SyntaxError");
      }
      if (!validThreshold(init?.threshold ?? [])) {
        throw new RangeError("Threshold values must be numbers between 0 and 1");
      }
      this.#deliver = callback;
    }
    observe(target: NodeLike): void {
      // Report the state now before registering: a waiter resumed by
      // `register` may change the state at once.
      this.#deliver([intersectionEntry(target)]);
      register("intersection", intersections, { target, key: this.#key, deliver: this.#deliver });
    }
    disconnect(): void {
      unregister(intersections, this.#key);
    }
  }

  class TestResizeObserver {
    readonly #key = Symbol("TestResizeObserver");
    readonly #deliver: (entries: ReadonlyArray<ResizeEntryLike>) => void;
    constructor(callback: (entries: ReadonlyArray<ResizeEntryLike>) => void) {
      this.#deliver = callback;
    }
    observe(target: NodeLike): void {
      // Report the state now before registering: a waiter resumed by
      // `register` may change the state at once.
      this.#deliver([resizeEntry(target)]);
      register("resize", resizes, { target, key: this.#key, deliver: this.#deliver });
    }
    disconnect(): void {
      unregister(resizes, this.#key);
    }
  }

  class TestMutationObserver {
    readonly #key = Symbol("TestMutationObserver");
    readonly #deliver: (records: ReadonlyArray<MutationRecordLike>) => void;
    constructor(callback: (records: ReadonlyArray<MutationRecordLike>) => void) {
      this.#deliver = callback;
    }
    // The adapter always passes options, so this models only that call.
    observe(target: NodeLike, init: MutationObserverInit): void {
      if (!observesSomething(init)) {
        throw new TypeError("The options must observe childList, attributes or characterData");
      }
      register("mutation", mutations, {
        target,
        key: this.#key,
        deliver: this.#deliver,
        options: init,
      });
    }
    disconnect(): void {
      unregister(mutations, this.#key);
    }
  }

  const deliverMutations = (target: NodeLike, records: ReadonlyArray<MutationInit>): void =>
    Arr.forEach(
      Arr.filter(mutations, (registration) => registration.target === target),
      (registration) => {
        const kept = Arr.map(
          Arr.filter(
            records,
            (init) =>
              KEEPS[init.type ?? "childList"](registration.options) &&
              passesFilter(registration.options, init),
          ),
          (init): MutationRecordLike => {
            const type = init.type ?? "childList";
            return {
              type,
              target: init.target ?? target,
              addedNodes: init.addedNodes ?? [],
              removedNodes: init.removedNodes ?? [],
              attributeName: init.attributeName ?? null,
              oldValue: KEEPS_OLD_VALUE[type](registration.options)
                ? (init.oldValue ?? null)
                : null,
            };
          },
        );
        if (Arr.isReadonlyArrayNonEmpty(kept)) registration.deliver(kept);
      },
    );

  const domObservers = makeDomObservers(
    options?.supported === false
      ? {}
      : {
          IntersectionObserver: TestIntersectionObserver,
          ResizeObserver: TestResizeObserver,
          MutationObserver: TestMutationObserver,
        },
  );

  return {
    domObservers,
    control: Control.of({
      element: (id) =>
        Option.getOrElse(MutableHashMap.get(elements, id), () => {
          const made: NodeLike & { readonly id: string } = { id, nodeName: "TEST-ELEMENT" };
          MutableHashMap.set(elements, id, made);
          return made;
        }),
      setIntersecting: (target, isIntersecting, ratio) =>
        Effect.sync(() => {
          const placement = placementOf(target);
          const nextRatio = ratio ?? (isIntersecting ? 1 : 0);
          if (placement.intersecting === isIntersecting && placement.ratio === nextRatio) return;
          placement.intersecting = isIntersecting;
          placement.ratio = nextRatio;
          Arr.forEach(
            Arr.filter(intersections, (registration) => registration.target === target),
            (registration) => registration.deliver([intersectionEntry(target)]),
          );
        }),
      setSize: (target, size) =>
        Effect.sync(() => {
          const placement = placementOf(target);
          if (placement.size.width === size.width && placement.size.height === size.height) return;
          placement.size = size;
          Arr.forEach(
            Arr.filter(resizes, (registration) => registration.target === target),
            (registration) => registration.deliver([resizeEntry(target)]),
          );
        }),
      mutate: (target, records) => Effect.sync(() => deliverMutations(target, records)),
      observers: (target, kind) => Effect.sync(() => watching(target, kind).length),
      awaitObserved: (target, kind) =>
        Effect.callback<void>((resume) => {
          if (Arr.isReadonlyArrayNonEmpty(watching(target, kind))) {
            resume(Effect.void);
            return;
          }
          const waiter: Waiter = { kind, target, resume: () => resume(Effect.void) };
          waiters.push(waiter);
          return Effect.sync(() => {
            waiters.splice(waiters.indexOf(waiter), 1);
          });
        }),
    }),
  };
};

/**
 * Provides `DomObservers` over fresh in-memory observers, and their
 * {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { DomObservers } from "@thomasfosterau/effect-platform-browser"
 * import { TestDomObservers } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.gen(function* () {
 *   const control = yield* TestDomObservers.Control
 *   const banner = control.element("banner")
 *   yield* control.setIntersecting(banner, true)
 *   yield* DomObservers.awaitVisible(banner)
 *   return "in view"
 * })
 * Effect.runPromise(Effect.provide(program, TestDomObservers.layer())).then(console.log) // "in view"
 * ```
 *
 * @since 0.1.0
 * @category layers
 */
export const layer = (options?: Options): Layer.Layer<DomObservers | Control> =>
  Layer.syncContext(() => {
    const { domObservers, control } = make(options);
    return Context.make(DomObservers, domObservers).pipe(Context.add(Control, control));
  });
