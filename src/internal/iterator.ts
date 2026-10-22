/**
 * Iterates `f(0), f(1), …` while the index is below `length()`. `length` is
 * re-read on every step, so the iterator observes the current length of a
 * mutable container, like iterating a JavaScript array.
 *
 * @internal
 */
export const indexed = <A>(length: () => number, f: (index: number) => A): IterableIterator<A> => {
  let index = 0
  const iterator: IterableIterator<A> = {
    next: (): IteratorResult<A, undefined> =>
      index < length() ? { done: false, value: f(index++) } : { done: true, value: undefined },
    [Symbol.iterator]: () => iterator,
  }
  return iterator
}
