/**
 * The DOM's observers (`IntersectionObserver`, `ResizeObserver`,
 * `MutationObserver`) as streams. Each subscription owns one observer and
 * disconnects it when the stream's scope closes; the platform's entries
 * become plain data, with `Option` where the DOM reports `null`.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { dual } from "effect/Function";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { reasonOf } from "./internal/dom.ts";
import {
  ambientIntersectionObserver,
  ambientMutationObserver,
  ambientResizeObserver,
} from "./internal/globals.ts";

/**
 * What an observer watches: an `Element` (any `Node` for `mutation`). The
 * adapter only hands it to the platform's observer and back, so this is the
 * slice of `Node` that names it, and a double's stand-in fits too.
 *
 * @since 0.1.0
 * @category models
 */
export interface NodeLike {
  readonly nodeName: string;
}

/**
 * A rectangle in CSS pixels, as the DOM's `DOMRectReadOnly` reports it.
 *
 * @since 0.1.0
 * @category models
 */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The structural slice of an `IntersectionObserverEntry` the adapter reads.
 *
 * @since 0.1.0
 * @category models
 */
export interface IntersectionEntryLike {
  readonly target: NodeLike;
  readonly time: number;
  readonly isIntersecting: boolean;
  readonly intersectionRatio: number;
  readonly boundingClientRect: Rect;
  readonly intersectionRect: Rect;
  readonly rootBounds: Rect | null;
}

/**
 * One box size in a `ResizeObserverEntry`, in the element's writing mode.
 *
 * @since 0.1.0
 * @category models
 */
export interface BoxSize {
  readonly inlineSize: number;
  readonly blockSize: number;
}

/**
 * The structural slice of a `ResizeObserverEntry` the adapter reads. The box
 * sizes are optional: older Safari reports `contentRect` alone, and only
 * Chromium reports `devicePixelContentBoxSize`.
 *
 * @since 0.1.0
 * @category models
 */
export interface ResizeEntryLike {
  readonly target: NodeLike;
  readonly contentRect: Rect;
  readonly contentBoxSize?: ReadonlyArray<BoxSize>;
  readonly borderBoxSize?: ReadonlyArray<BoxSize>;
  readonly devicePixelContentBoxSize?: ReadonlyArray<BoxSize>;
}

/**
 * The structural slice of a `MutationRecord` the adapter reads.
 *
 * @since 0.1.0
 * @category models
 */
export interface MutationRecordLike {
  readonly type: MutationRecordType;
  readonly target: NodeLike;
  readonly addedNodes: ArrayLike<NodeLike>;
  readonly removedNodes: ArrayLike<NodeLike>;
  readonly attributeName: string | null;
  readonly oldValue: string | null;
}

/**
 * The structural slice of an observer the adapter calls; `Options` is what
 * `observe` takes (`void` for an intersection observer, whose options go to
 * its constructor).
 *
 * @since 0.1.0
 * @category models
 */
export interface ObserverLike<Options> {
  observe(target: NodeLike, options: Options): void;
  disconnect(): void;
}

/**
 * The structural shape of the `IntersectionObserver` constructor.
 *
 * @since 0.1.0
 * @category models
 */
export type IntersectionObserverConstructorLike = new (
  callback: (entries: ReadonlyArray<IntersectionEntryLike>) => void,
  options?: IntersectionObserverInit,
) => ObserverLike<void>;

/**
 * The structural shape of the `ResizeObserver` constructor.
 *
 * @since 0.1.0
 * @category models
 */
export type ResizeObserverConstructorLike = new (
  callback: (entries: ReadonlyArray<ResizeEntryLike>) => void,
) => ObserverLike<ResizeObserverOptions | undefined>;

/**
 * The structural shape of the `MutationObserver` constructor.
 *
 * @since 0.1.0
 * @category models
 */
export type MutationObserverConstructorLike = new (
  callback: (records: ReadonlyArray<MutationRecordLike>) => void,
) => ObserverLike<MutationObserverInit>;

/**
 * The observer constructors {@link make} builds over; a missing one makes
 * its stream fail `Unsupported`. {@link layer} passes the ambient ones.
 *
 * @since 0.1.0
 * @category models
 */
export interface DomObserversEnvironment {
  readonly IntersectionObserver?: IntersectionObserverConstructorLike;
  readonly ResizeObserver?: ResizeObserverConstructorLike;
  readonly MutationObserver?: MutationObserverConstructorLike;
}

/**
 * A target's intersection with the root (the viewport, by default).
 * `rootBounds` is `None` where the platform withholds it (a cross-origin
 * frame).
 *
 * @since 0.1.0
 * @category models
 */
export interface Intersection {
  readonly target: NodeLike;
  readonly time: number;
  readonly isIntersecting: boolean;
  readonly ratio: number;
  readonly boundingClientRect: Rect;
  readonly intersectionRect: Rect;
  readonly rootBounds: Option.Option<Rect>;
}

/**
 * A target's new size. Each box size has one entry per fragment (one,
 * outside multi-column layout); a box the agent does not report is empty.
 *
 * @since 0.1.0
 * @category models
 */
export interface Resize {
  readonly target: NodeLike;
  readonly contentRect: Rect;
  readonly contentBoxSize: ReadonlyArray<BoxSize>;
  readonly borderBoxSize: ReadonlyArray<BoxSize>;
  readonly devicePixelContentBoxSize: ReadonlyArray<BoxSize>;
}

/**
 * One change to the observed subtree. `attributeName` is set for an
 * `attributes` record; `oldValue` when the options asked for it.
 *
 * @since 0.1.0
 * @category models
 */
export interface Mutation {
  readonly type: MutationRecordType;
  readonly target: NodeLike;
  readonly addedNodes: ReadonlyArray<NodeLike>;
  readonly removedNodes: ReadonlyArray<NodeLike>;
  readonly attributeName: Option.Option<string>;
  readonly oldValue: Option.Option<string>;
}

/**
 * Why an observer did not start.
 *
 * - `Unsupported` — the context has no such observer (a server render, a
 *   worker).
 * - `InvalidOptions` — the platform refused the options: a malformed
 *   `rootMargin`, a threshold outside 0–1, mutation options that observe
 *   nothing.
 * - `Failed` — anything else; `cause` carries it.
 *
 * @since 0.1.0
 * @category errors
 */
export type DomObserverErrorReason = "Unsupported" | "InvalidOptions" | "Failed";

/**
 * An observer that did not start. `cause` carries the platform's exception,
 * where there was one.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import { DomObservers } from "@thomasfosterau/effect-platform-browser"
 *
 * const observers = DomObservers.make({})
 * Effect.runPromise(Effect.flip(Stream.runDrain(observers.resize({ nodeName: "DIV" })))).then((error) =>
 *   console.log(error.reason), // "Unsupported"
 * )
 * ```
 *
 * @since 0.1.0
 * @category errors
 */
export class DomObserverError extends Schema.TaggedError<
  DomObserverError,
  { readonly brand: unique symbol }
>()("DomObserverError", {
  observer: Schema.Literals(["intersection", "resize", "mutation"]),
  reason: Schema.Literals(["Unsupported", "InvalidOptions", "Failed"]),
  message: Schema.String,
  cause: Schema.Unknown,
}) {}

type Kind = DomObserverError["observer"];

const domObserverError = (observer: Kind, reason: DomObserverErrorReason, cause: unknown) =>
  new DomObserverError({ observer, reason, cause, message: `${observer} observer: ${reason}` });

const REJECTION_REASONS = {
  SyntaxError: "InvalidOptions",
  RangeError: "InvalidOptions",
  TypeError: "InvalidOptions",
} satisfies Readonly<Record<string, DomObserverErrorReason>>;

/**
 * The DOM observers. Provide {@link layer} in a page, or
 * `TestDomObservers.layer` from
 * `@thomasfosterau/effect-platform-browser/BrowserTesting` in tests.
 *
 * - `supported` — which observers the context has.
 * - `intersection` — the target's intersections with the root: the first
 *   as soon as it is observed, then one each time it crosses a threshold.
 * - `resize` — the target's sizes: the first as soon as it is observed,
 *   then each change.
 * - `mutation` — each batch of changes to the target (and, with
 *   `subtree`, its descendants), in order. Nothing is emitted on subscribe.
 *
 * Each stream fails with the {@link DomObserverError} before emitting
 * anything when the observer cannot start.
 *
 * @since 0.1.0
 * @category services
 */
export class DomObservers extends Context.Service<
  DomObservers,
  {
    readonly supported: {
      readonly intersection: boolean;
      readonly resize: boolean;
      readonly mutation: boolean;
    };
    readonly intersection: (
      target: NodeLike,
      options?: IntersectionObserverInit,
    ) => Stream.Stream<Intersection, DomObserverError>;
    readonly resize: (
      target: NodeLike,
      options?: ResizeObserverOptions,
    ) => Stream.Stream<Resize, DomObserverError>;
    readonly mutation: (
      target: NodeLike,
      options: MutationObserverInit,
    ) => Stream.Stream<ReadonlyArray<Mutation>, DomObserverError>;
  }
>()("@thomasfosterau/effect-platform-browser/DomObservers") {}

/** A plain copy of a platform rectangle (a `DOMRectReadOnly` carries more). */
const toRect = ({ x, y, width, height }: Rect): Rect => ({ x, y, width, height });

const toBoxSizes = (sizes: ReadonlyArray<BoxSize> = []): ReadonlyArray<BoxSize> =>
  Arr.map(sizes, ({ inlineSize, blockSize }) => ({ inlineSize, blockSize }));

const toIntersection = (entry: IntersectionEntryLike): Intersection => ({
  target: entry.target,
  time: entry.time,
  isIntersecting: entry.isIntersecting,
  ratio: entry.intersectionRatio,
  boundingClientRect: toRect(entry.boundingClientRect),
  intersectionRect: toRect(entry.intersectionRect),
  rootBounds: Option.map(Option.fromNullOr(entry.rootBounds), toRect),
});

const toResize = (entry: ResizeEntryLike): Resize => ({
  target: entry.target,
  contentRect: toRect(entry.contentRect),
  contentBoxSize: toBoxSizes(entry.contentBoxSize),
  borderBoxSize: toBoxSizes(entry.borderBoxSize),
  devicePixelContentBoxSize: toBoxSizes(entry.devicePixelContentBoxSize),
});

const toMutation = (record: MutationRecordLike): Mutation => ({
  type: record.type,
  target: record.target,
  addedNodes: Array.from(record.addedNodes),
  removedNodes: Array.from(record.removedNodes),
  attributeName: Option.fromNullOr(record.attributeName),
  oldValue: Option.fromNullOr(record.oldValue),
});

/**
 * A stream over one observer: `start` builds it around the delivery
 * callback and starts observing (either may throw, for refused options);
 * the observer disconnects when the stream's scope closes.
 */
const observe = <Entry, A>(
  kind: Kind,
  start: (
    deliver: (entries: ReadonlyArray<Entry>) => void,
  ) => Pick<ObserverLike<void>, "disconnect">,
  convert: (entries: ReadonlyArray<Entry>) => Iterable<A>,
): Stream.Stream<A, DomObserverError> =>
  Stream.callback<A, DomObserverError>((queue) =>
    Effect.acquireRelease(
      Effect.try({
        try: () =>
          start((entries) => {
            Queue.offerAllUnsafe(queue, convert(entries));
          }),
        catch: (cause) =>
          domObserverError(kind, reasonOf(cause, REJECTION_REASONS, "Failed"), cause),
      }),
      (observer) => Effect.sync(() => observer.disconnect()),
    ).pipe(Effect.catch((error) => Queue.fail(queue, error))),
  );

const unsupported = (kind: Kind) => Stream.fail(domObserverError(kind, "Unsupported", undefined));

/**
 * Builds the {@link DomObservers} service over the given observer
 * constructors. {@link layer} passes the ambient ones.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { DomObservers } from "@thomasfosterau/effect-platform-browser"
 *
 * console.log(DomObservers.make({}).supported) // { intersection: false, resize: false, mutation: false }
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = (environment: DomObserversEnvironment): DomObservers["Service"] => {
  const { IntersectionObserver, ResizeObserver, MutationObserver } = environment;
  return DomObservers.of({
    supported: {
      intersection: IntersectionObserver !== undefined,
      resize: ResizeObserver !== undefined,
      mutation: MutationObserver !== undefined,
    },
    intersection: (target, options) =>
      IntersectionObserver === undefined
        ? unsupported("intersection")
        : observe<IntersectionEntryLike, Intersection>(
            "intersection",
            (deliver) => {
              const observer = new IntersectionObserver(deliver, options);
              observer.observe(target);
              return observer;
            },
            Arr.map(toIntersection),
          ),
    resize: (target, options) =>
      ResizeObserver === undefined
        ? unsupported("resize")
        : observe<ResizeEntryLike, Resize>(
            "resize",
            (deliver) => {
              const observer = new ResizeObserver(deliver);
              observer.observe(target, options);
              return observer;
            },
            Arr.map(toResize),
          ),
    mutation: (target, options) =>
      MutationObserver === undefined
        ? unsupported("mutation")
        : observe<MutationRecordLike, ReadonlyArray<Mutation>>(
            "mutation",
            (deliver) => {
              const observer = new MutationObserver(deliver);
              observer.observe(target, options);
              return observer;
            },
            (records) => [Arr.map(records, toMutation)],
          ),
  });
};

/**
 * The {@link DomObservers} service over the ambient observer constructors;
 * each observer the context lacks fails `Unsupported`.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { DomObservers } from "@thomasfosterau/effect-platform-browser"
 *
 * const program = Effect.map(DomObservers.DomObservers, (observers) => observers.supported.resize)
 * Effect.runPromise(Effect.provide(program, DomObservers.layer)).then(console.log) // false under Node
 * ```
 *
 * @since 0.1.0
 * @category layers
 */
export const layer: Layer.Layer<DomObservers> = Layer.sync(DomObservers, () =>
  make({
    ...Option.match(ambientIntersectionObserver(), {
      onNone: () => ({}),
      onSome: (IntersectionObserver) => ({ IntersectionObserver }),
    }),
    ...Option.match(ambientResizeObserver(), {
      onNone: () => ({}),
      onSome: (ResizeObserver) => ({ ResizeObserver }),
    }),
    ...Option.match(ambientMutationObserver(), {
      onNone: () => ({}),
      onSome: (MutationObserver) => ({ MutationObserver }),
    }),
  }),
);

/**
 * The target's intersections, from the {@link DomObservers} service.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import { DomObservers } from "@thomasfosterau/effect-platform-browser"
 * import { TestDomObservers } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.gen(function* () {
 *   const control = yield* TestDomObservers.Control
 *   const card = control.element("card")
 *   return yield* Stream.runHead(DomObservers.intersection(card))
 * })
 * Effect.runPromise(Effect.provide(program, TestDomObservers.layer())).then((first) =>
 *   console.log(first._tag), // "Some"
 * )
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const intersection = (
  target: NodeLike,
  options?: IntersectionObserverInit,
): Stream.Stream<Intersection, DomObserverError, DomObservers> =>
  Stream.unwrap(Effect.map(DomObservers, (observers) => observers.intersection(target, options)));

/**
 * The target's sizes, from the {@link DomObservers} service.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import * as Stream from "effect/Stream"
 * import { DomObservers } from "@thomasfosterau/effect-platform-browser"
 * import { TestDomObservers } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.gen(function* () {
 *   const control = yield* TestDomObservers.Control
 *   const panel = control.element("panel")
 *   yield* control.setSize(panel, { width: 320, height: 200 })
 *   const first = yield* Stream.runHead(DomObservers.resize(panel))
 *   return Option.map(first, (entry) => entry.contentRect.width)
 * })
 * Effect.runPromise(Effect.provide(program, TestDomObservers.layer())).then(console.log) // Some(320)
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const resize = (
  target: NodeLike,
  options?: ResizeObserverOptions,
): Stream.Stream<Resize, DomObserverError, DomObservers> =>
  Stream.unwrap(Effect.map(DomObservers, (observers) => observers.resize(target, options)));

/**
 * Each batch of changes under the target, from the {@link DomObservers}
 * service.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Fiber from "effect/Fiber"
 * import * as Stream from "effect/Stream"
 * import { DomObservers } from "@thomasfosterau/effect-platform-browser"
 * import { TestDomObservers } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.gen(function* () {
 *   const control = yield* TestDomObservers.Control
 *   const list = control.element("list")
 *   const fiber = yield* Effect.forkChild(
 *     Stream.runHead(DomObservers.mutation(list, { childList: true })),
 *   )
 *   yield* control.awaitObserved(list, "mutation")
 *   yield* control.mutate(list, [{ type: "childList", addedNodes: [control.element("item")] }])
 *   return yield* Fiber.join(fiber)
 * })
 * Effect.runPromise(Effect.provide(program, TestDomObservers.layer())).then((batch) =>
 *   console.log(batch._tag), // "Some"
 * )
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const mutation = (
  target: NodeLike,
  options: MutationObserverInit,
): Stream.Stream<ReadonlyArray<Mutation>, DomObserverError, DomObservers> =>
  Stream.unwrap(Effect.map(DomObservers, (observers) => observers.mutation(target, options)));

/**
 * Waits until the target intersects the root.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { DomObservers } from "@thomasfosterau/effect-platform-browser"
 * import { TestDomObservers } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.gen(function* () {
 *   const control = yield* TestDomObservers.Control
 *   const footer = control.element("footer")
 *   yield* control.setIntersecting(footer, true)
 *   yield* DomObservers.awaitVisible(footer)
 *   return "seen"
 * })
 * Effect.runPromise(Effect.provide(program, TestDomObservers.layer())).then(console.log) // "seen"
 * ```
 *
 * @since 0.1.0
 * @category combinators
 */
export const awaitVisible = (
  target: NodeLike,
  options?: IntersectionObserverInit,
): Effect.Effect<void, DomObserverError, DomObservers> =>
  intersection(target, options).pipe(
    Stream.filter((entry) => entry.isIntersecting),
    Stream.runHead,
    Effect.asVoid,
  );

/**
 * Runs `self` once the target intersects the root, and only while it
 * does: `Some` with `self`'s result, or `None` when the target leaves the
 * root first, which interrupts `self`.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { DomObservers } from "@thomasfosterau/effect-platform-browser"
 * import { TestDomObservers } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.gen(function* () {
 *   const control = yield* TestDomObservers.Control
 *   const video = control.element("video")
 *   yield* control.setIntersecting(video, true)
 *   return yield* DomObservers.whileVisible(Effect.succeed("played"), video)
 * })
 * Effect.runPromise(Effect.provide(program, TestDomObservers.layer())).then(console.log) // Some("played")
 * ```
 *
 * @since 0.1.0
 * @category combinators
 */
export const whileVisible: {
  (
    target: NodeLike,
    options?: IntersectionObserverInit,
  ): <A, E, R>(
    self: Effect.Effect<A, E, R>,
  ) => Effect.Effect<Option.Option<A>, E | DomObserverError, R | DomObservers>;
  <A, E, R>(
    self: Effect.Effect<A, E, R>,
    target: NodeLike,
    options?: IntersectionObserverInit,
  ): Effect.Effect<Option.Option<A>, E | DomObserverError, R | DomObservers>;
} = dual(
  (args) => Effect.isEffect(args[0]),
  <A, E, R>(
    self: Effect.Effect<A, E, R>,
    target: NodeLike,
    options?: IntersectionObserverInit,
  ): Effect.Effect<Option.Option<A>, E | DomObserverError, R | DomObservers> => {
    // A fresh observer reports the target's state first, so a target that
    // left between the two observers is seen leaving at once.
    const leaves = intersection(target, options).pipe(
      Stream.filter((entry) => !entry.isIntersecting),
      Stream.runHead,
      Effect.as(Option.none<A>()),
    );
    return Effect.andThen(
      awaitVisible(target, options),
      Effect.raceFirst(Effect.asSome(self), leaves),
    );
  },
);
