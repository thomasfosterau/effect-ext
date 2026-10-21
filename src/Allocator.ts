/**
 * The `Allocator` service hands out blocks of `ArrayBuffer` memory.
 *
 * It is a `Context.Reference`, so it never has to be provided: when nothing
 * else is in context, the {@link heap} allocator (one `ArrayBuffer` per
 * block, reclaimed by the garbage collector) is used. Swap in a different
 * allocator, such as an {@link arena}, with {@link layer} or
 * {@link withAllocator}.
 *
 * @since 0.1.0
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import { dual } from "effect/Function"
import * as Layer from "effect/Layer"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"

/**
 * A contiguous region of an `ArrayBuffer`.
 *
 * @since 0.1.0
 * @category models
 */
export interface Block {
  readonly buffer: ArrayBuffer
  readonly byteOffset: number
  readonly byteLength: number
}

/**
 * Raised when an allocator cannot satisfy a request.
 *
 * @since 0.1.0
 * @category errors
 */
export class AllocationError extends Schema.TaggedError<AllocationError>()("AllocationError", {
  size: Schema.Number,
  align: Schema.Number,
  reason: Schema.String,
}) {
  override get message(): string {
    return `Failed to allocate ${this.size} bytes (align ${this.align}): ${this.reason}`
  }
}

/**
 * An allocator.
 *
 * Allocator methods are synchronous so that data structures can grow without
 * leaving their hot paths; failure is reported through `Result`.
 *
 * - `allocate` returns a block of exactly `size` bytes whose `byteOffset` is a
 *   multiple of `align` (a power of two). Its contents are zeroed.
 * - `reallocate` resizes a block, preserving the first
 *   `min(block.byteLength, size)` bytes and zeroing any new bytes. The old
 *   block must no longer be used afterwards.
 * - `deallocate` releases a block. The block must no longer be used afterwards.
 *
 * @since 0.1.0
 * @category models
 */
export interface Allocator {
  readonly name: string
  readonly allocate: (size: number, align: number) => Result.Result<Block, AllocationError>
  readonly reallocate: (
    block: Block,
    size: number,
    align: number,
  ) => Result.Result<Block, AllocationError>
  readonly deallocate: (block: Block) => void
}

/**
 * The default alignment used when none is given (the largest alignment of any
 * primitive layout).
 *
 * @since 0.1.0
 * @category constants
 */
export const DEFAULT_ALIGN = 8

const isPowerOfTwo = (n: number) => Number.isSafeInteger(n) && n > 0 && (n & (n - 1)) === 0

const validateRequest = (size: number, align: number): Result.Result<void, AllocationError> => {
  if (!Number.isSafeInteger(size) || size < 0) {
    return Result.fail(
      new AllocationError({ size, align, reason: "size must be a non-negative integer" }),
    )
  }
  if (!isPowerOfTwo(align)) {
    return Result.fail(new AllocationError({ size, align, reason: "align must be a power of two" }))
  }
  return Result.void
}

const tryAllocate = <A>(
  size: number,
  align: number,
  allocate: () => A,
): Result.Result<A, AllocationError> =>
  Result.flatMap(validateRequest(size, align), () =>
    Result.try({
      try: allocate,
      catch: (cause) => new AllocationError({ size, align, reason: String(cause) }),
    }),
  )

const ownsWholeBuffer = (block: Block) =>
  block.byteOffset === 0 && block.byteLength === block.buffer.byteLength

const copyBlock = (from: Block, to: Block) => {
  const n = Math.min(from.byteLength, to.byteLength)
  new Uint8Array(to.buffer, to.byteOffset, n).set(new Uint8Array(from.buffer, from.byteOffset, n))
}

/**
 * The default allocator: every block is its own `ArrayBuffer`, freed by the
 * garbage collector.
 *
 * `reallocate` uses `ArrayBuffer.prototype.transfer`, which can resize in
 * place, and `deallocate` detaches the buffer so that any use after free
 * throws instead of silently reading stale memory.
 *
 * @since 0.1.0
 * @category allocators
 */
export const heap: Allocator = {
  name: "heap",
  allocate: (size, align) =>
    tryAllocate(size, align, () => ({
      buffer: new ArrayBuffer(size),
      byteOffset: 0,
      byteLength: size,
    })),
  reallocate: (block, size, align) =>
    tryAllocate(size, align, () => {
      if (ownsWholeBuffer(block)) {
        return { buffer: block.buffer.transfer(size), byteOffset: 0, byteLength: size }
      }
      const next = { buffer: new ArrayBuffer(size), byteOffset: 0, byteLength: size }
      copyBlock(block, next)
      return next
    }),
  deallocate(block) {
    if (ownsWholeBuffer(block) && !block.buffer.detached) {
      block.buffer.transfer(0)
    }
  },
}

/**
 * A bump allocator over a single fixed-size `ArrayBuffer`.
 *
 * Allocation is a pointer bump. Only the most recent allocation can be
 * deallocated or resized in place; everything else is reclaimed at once by
 * {@link Arena.reset}.
 *
 * @since 0.1.0
 * @category models
 */
export interface Arena extends Allocator {
  readonly buffer: ArrayBuffer
  /** The total number of bytes managed by the arena. */
  readonly capacity: number
  /** The number of bytes currently handed out (including alignment padding). */
  readonly used: number
  /** Reclaims every block. Blocks handed out before the reset must no longer be used. */
  readonly reset: () => void
}

/**
 * Creates an {@link Arena} with `capacity` bytes.
 *
 * @since 0.1.0
 * @category allocators
 */
export const makeArenaUnsafe = (capacity: number): Arena => {
  const buffer = new ArrayBuffer(capacity)
  const bytes = new Uint8Array(buffer)
  let top = 0

  const bump = (size: number, align: number): Result.Result<Block, AllocationError> => {
    const valid = validateRequest(size, align)
    if (Result.isFailure(valid)) return Result.fail(valid.failure)
    const byteOffset = (top + align - 1) & ~(align - 1)
    if (byteOffset + size > capacity) {
      return Result.fail(
        new AllocationError({
          size,
          align,
          reason: `arena exhausted (${capacity - top} of ${capacity} bytes free)`,
        }),
      )
    }
    top = byteOffset + size
    bytes.fill(0, byteOffset, top)
    return Result.succeed({ buffer, byteOffset, byteLength: size })
  }

  const isLast = (block: Block) =>
    block.buffer === buffer && block.byteOffset + block.byteLength === top

  return {
    name: "arena",
    buffer,
    capacity,
    get used() {
      return top
    },
    allocate: bump,
    reallocate(block, size, align) {
      const valid = validateRequest(size, align)
      if (Result.isFailure(valid)) return Result.fail(valid.failure)
      if (isLast(block) && (block.byteOffset & (align - 1)) === 0) {
        if (block.byteOffset + size > capacity) {
          return Result.fail(
            new AllocationError({ size, align, reason: `arena exhausted (${capacity} bytes)` }),
          )
        }
        const end = block.byteOffset + size
        if (end > top) bytes.fill(0, top, end)
        top = end
        return Result.succeed({ buffer, byteOffset: block.byteOffset, byteLength: size })
      }
      const next = bump(size, align)
      if (Result.isSuccess(next)) copyBlock(block, next.success)
      return next
    },
    deallocate(block) {
      if (isLast(block)) top = block.byteOffset
    },
    reset() {
      top = 0
    },
  }
}

/**
 * Creates an {@link Arena} with `capacity` bytes.
 *
 * @since 0.1.0
 * @category allocators
 */
export const makeArena = (capacity: number): Effect.Effect<Arena, AllocationError> =>
  Effect.try({
    try: () => makeArenaUnsafe(capacity),
    catch: (cause) => new AllocationError({ size: capacity, align: 1, reason: String(cause) }),
  })

/**
 * Statistics collected by a {@link tracked} allocator.
 *
 * @since 0.1.0
 * @category models
 */
export interface Stats {
  /** Number of blocks currently allocated. */
  readonly liveBlocks: number
  /** Number of bytes currently allocated. */
  readonly liveBytes: number
  /** Total number of successful `allocate` calls. */
  readonly allocations: number
  /** Total number of successful `reallocate` calls. */
  readonly reallocations: number
  /** Total number of `deallocate` calls. */
  readonly deallocations: number
}

/**
 * An allocator that records {@link Stats} about the allocator it wraps.
 *
 * @since 0.1.0
 * @category models
 */
export interface Tracked extends Allocator {
  readonly underlying: Allocator
  readonly stats: () => Stats
}

/**
 * Wraps an allocator so that its usage can be inspected — useful for tests
 * and for finding leaks.
 *
 * @since 0.1.0
 * @category allocators
 */
export const tracked = (underlying: Allocator): Tracked => {
  let liveBlocks = 0
  let liveBytes = 0
  let allocations = 0
  let reallocations = 0
  let deallocations = 0
  return {
    name: `tracked(${underlying.name})`,
    underlying,
    stats: () => ({ liveBlocks, liveBytes, allocations, reallocations, deallocations }),
    allocate(size, align) {
      const result = underlying.allocate(size, align)
      if (Result.isSuccess(result)) {
        allocations++
        liveBlocks++
        liveBytes += size
      }
      return result
    },
    reallocate(block, size, align) {
      const previous = block.byteLength
      const result = underlying.reallocate(block, size, align)
      if (Result.isSuccess(result)) {
        reallocations++
        liveBytes += size - previous
      }
      return result
    },
    deallocate(block) {
      deallocations++
      liveBlocks--
      liveBytes -= block.byteLength
      underlying.deallocate(block)
    },
  }
}

/**
 * The current allocator. Defaults to {@link heap}.
 *
 * @since 0.1.0
 * @category references
 */
export const Allocator: Context.Reference<Allocator> = Context.Reference<Allocator>(
  "effect-ext/Allocator",
  { defaultValue: () => heap },
)

/**
 * A layer that installs `allocator` as the current allocator.
 *
 * @since 0.1.0
 * @category layers
 */
export const layer = (allocator: Allocator): Layer.Layer<never> =>
  Layer.succeed(Allocator, allocator)

/**
 * A layer that installs a fresh {@link Arena} of `capacity` bytes as the
 * current allocator.
 *
 * @since 0.1.0
 * @category layers
 */
export const layerArena = (capacity: number): Layer.Layer<never, AllocationError> =>
  Layer.effect(Allocator, makeArena(capacity))

/**
 * Runs `self` with `allocator` as the current allocator.
 *
 * @since 0.1.0
 * @category combinators
 */
export const withAllocator: {
  (allocator: Allocator): <A, E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  <A, E, R>(self: Effect.Effect<A, E, R>, allocator: Allocator): Effect.Effect<A, E, R>
} = dual(2, <A, E, R>(self: Effect.Effect<A, E, R>, allocator: Allocator): Effect.Effect<A, E, R> =>
  Effect.provideService(self, Allocator, allocator),
)

/**
 * Allocates a zeroed block from the current allocator.
 *
 * @since 0.1.0
 * @category operations
 */
export const allocate = (
  size: number,
  align: number = DEFAULT_ALIGN,
): Effect.Effect<Block, AllocationError> =>
  Effect.flatMap(Effect.service(Allocator), (allocator) =>
    Effect.fromResult(allocator.allocate(size, align)),
  )

/**
 * Allocates a zeroed block from the current allocator and deallocates it when
 * the surrounding scope closes.
 *
 * @since 0.1.0
 * @category operations
 */
export const allocateScoped = (
  size: number,
  align: number = DEFAULT_ALIGN,
): Effect.Effect<Block, AllocationError, Scope.Scope> =>
  Effect.flatMap(Effect.service(Allocator), (allocator) =>
    Effect.acquireRelease(Effect.fromResult(allocator.allocate(size, align)), (block) =>
      Effect.sync(() => allocator.deallocate(block)),
    ),
  )

/**
 * Resizes a block with the current allocator.
 *
 * @since 0.1.0
 * @category operations
 */
export const reallocate = (
  block: Block,
  size: number,
  align: number = DEFAULT_ALIGN,
): Effect.Effect<Block, AllocationError> =>
  Effect.flatMap(Effect.service(Allocator), (allocator) =>
    Effect.fromResult(allocator.reallocate(block, size, align)),
  )

/**
 * Returns a block to the current allocator.
 *
 * @since 0.1.0
 * @category operations
 */
export const deallocate = (block: Block): Effect.Effect<void> =>
  Effect.flatMap(Effect.service(Allocator), (allocator) =>
    Effect.sync(() => allocator.deallocate(block)),
  )

/**
 * Views a block as bytes.
 *
 * @since 0.1.0
 * @category utils
 */
export const bytes = (block: Block): Uint8Array =>
  new Uint8Array(block.buffer, block.byteOffset, block.byteLength)

/**
 * Views a block through a `DataView`.
 *
 * @since 0.1.0
 * @category utils
 */
export const dataView = (block: Block): DataView =>
  new DataView(block.buffer, block.byteOffset, block.byteLength)
