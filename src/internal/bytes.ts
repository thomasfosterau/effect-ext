/**
 * A growable byte buffer whose memory comes from an `Allocator`.
 *
 * @internal
 */
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import * as Allocator from "../Allocator.ts"

const MIN_CAPACITY = 8

const noBytes = new Uint8Array(0)

export class ByteBuffer {
  block: Option.Option<Allocator.Block> = Option.none()
  /** All of the block's memory (`capacity` bytes). */
  memory: Uint8Array = noBytes
  len = 0

  constructor(readonly allocator: Allocator.Allocator) {}

  get capacity(): number {
    return this.memory.byteLength
  }

  /** The initialised bytes, `[0, len)`. A view, invalidated by reallocation. */
  bytes(): Uint8Array {
    return this.memory.subarray(0, this.len)
  }

  resize(capacity: number): Result.Result<void, Allocator.AllocationError> {
    const result = Option.isSome(this.block)
      ? this.allocator.reallocate(this.block.value, capacity, 1)
      : this.allocator.allocate(capacity, 1)
    if (Result.isFailure(result)) return Result.fail(result.failure)
    this.block = Option.some(result.success)
    this.memory = Allocator.bytes(result.success)
    return Result.void
  }

  reserve(additional: number): Result.Result<void, Allocator.AllocationError> {
    const required = this.len + additional
    if (required <= this.capacity) return Result.void
    return this.resize(Math.max(required, this.capacity * 2, MIN_CAPACITY))
  }

  /** Grows or shrinks the capacity to exactly `capacity` (at least `len`). */
  reserveExact(capacity: number): Result.Result<void, Allocator.AllocationError> {
    if (capacity === this.capacity) return Result.void
    if (capacity === 0) {
      this.free()
      return Result.void
    }
    return this.resize(capacity)
  }

  /**
   * Replaces `[start, end)` with `insert`, shifting the tail. The caller
   * guarantees `0 <= start <= end <= len`.
   */
  splice(
    start: number,
    end: number,
    insert: Uint8Array,
  ): Result.Result<void, Allocator.AllocationError> {
    // `insert` may be a view of this buffer, which moving the tail or
    // reallocating would clobber; copy it first in that case.
    const source = insert.buffer === this.memory.buffer ? insert.slice() : insert
    const newLen = this.len - (end - start) + source.byteLength
    if (newLen > this.len) {
      const result = this.reserve(newLen - this.len)
      if (Result.isFailure(result)) return result
    }
    this.memory.copyWithin(start + source.byteLength, end, this.len)
    this.memory.set(source, start)
    this.len = newLen
    return Result.void
  }

  append(bytes: Uint8Array): Result.Result<void, Allocator.AllocationError> {
    return this.splice(this.len, this.len, bytes)
  }

  free(): void {
    if (Option.isSome(this.block)) {
      this.allocator.deallocate(this.block.value)
      this.block = Option.none()
      this.memory = noBytes
    }
    this.len = 0
  }
}
