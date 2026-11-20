/**
 * An in-memory `FileSystemDirectoryHandle`: the platform object
 * `BrowserFileSystem` runs over, for tests (and the `FilePicker` double)
 * under Node, with no OPFS. It follows the platform's rules: a writable
 * writes to a swap copy that replaces the file on `close`, a missing entry
 * rejects `NotFoundError`, a kind mismatch `TypeMismatchError`, removing a
 * non-empty directory without `recursive` `InvalidModificationError`.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import type {
  DirectoryHandleLike,
  FileHandleLike,
  FileLike,
  HandleEntryLike,
  WritableLike,
} from "./BrowserFileSystem.ts";

/** A file's stored state: its bytes and a modification stamp. */
interface Stored {
  bytes: Uint8Array<ArrayBuffer>;
  lastModified: number;
}

/** Shared by every handle of one tree: a clock that only moves on writes. */
interface Clock {
  now: number;
}

const domError = (name: string, message: string): DOMException => new DOMException(message, name);

const snapshot = (stored: Stored): FileLike => {
  const bytes = stored.bytes.slice();
  return {
    size: bytes.length,
    lastModified: stored.lastModified,
    slice: (start, end) => ({
      arrayBuffer: () => Promise.resolve(bytes.slice(start, end).buffer),
    }),
  };
};

class MemoryWritable implements WritableLike {
  readonly #stored: Stored;
  readonly #clock: Clock;
  #swap: Uint8Array<ArrayBuffer>;
  #position = 0;
  constructor(stored: Stored, clock: Clock, keepExistingData: boolean) {
    this.#stored = stored;
    this.#clock = clock;
    this.#swap = keepExistingData ? stored.bytes.slice() : new Uint8Array();
  }
  write(data: Uint8Array<ArrayBuffer>): Promise<void> {
    const end = this.#position + data.length;
    const grown = new Uint8Array(Math.max(end, this.#swap.length));
    grown.set(this.#swap);
    grown.set(data, this.#position);
    this.#swap = grown;
    this.#position = end;
    return Promise.resolve();
  }
  seek(position: number): Promise<void> {
    this.#position = position;
    return Promise.resolve();
  }
  truncate(size: number): Promise<void> {
    const resized = new Uint8Array(size);
    resized.set(this.#swap.subarray(0, size));
    this.#swap = resized;
    this.#position = Math.min(this.#position, size);
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.#clock.now += 1;
    this.#stored.bytes = this.#swap;
    this.#stored.lastModified = this.#clock.now;
    return Promise.resolve();
  }
}

class MemoryFileHandle implements FileHandleLike {
  readonly kind = "file";
  readonly name: string;
  readonly #stored: Stored;
  readonly #clock: Clock;
  constructor(name: string, stored: Stored, clock: Clock) {
    this.name = name;
    this.#stored = stored;
    this.#clock = clock;
  }
  getFile(): Promise<FileLike> {
    return Promise.resolve(snapshot(this.#stored));
  }
  createWritable(options?: { readonly keepExistingData?: boolean }): Promise<WritableLike> {
    return Promise.resolve(
      new MemoryWritable(this.#stored, this.#clock, options?.keepExistingData === true),
    );
  }
}

type Node = { readonly kind: "file"; readonly stored: Stored } | MemoryDirectoryHandle;

class MemoryDirectoryHandle implements DirectoryHandleLike {
  readonly kind = "directory";
  readonly name: string;
  readonly #children: Array<{ readonly name: string; readonly node: Node }> = [];
  readonly #clock: Clock;
  constructor(name: string, clock: Clock) {
    this.name = name;
    this.#clock = clock;
  }
  #find(name: string): Option.Option<Node> {
    return Option.map(
      Arr.findFirst(this.#children, (child) => child.name === name),
      (child) => child.node,
    );
  }
  #checkName(name: string): Option.Option<DOMException> {
    return name === "" || name === "." || name === ".." || name.includes("/")
      ? Option.some(domError("TypeError", `invalid name "${name}"`))
      : Option.none();
  }
  getDirectoryHandle(
    name: string,
    options?: { readonly create?: boolean },
  ): Promise<DirectoryHandleLike> {
    return this.#get(name, "directory", options?.create === true).then((node) => {
      if (node.kind === "directory") return node;
      throw domError("TypeMismatchError", `${name} is a file`);
    });
  }
  getFileHandle(name: string, options?: { readonly create?: boolean }): Promise<FileHandleLike> {
    return this.#get(name, "file", options?.create === true).then((node) => {
      if (node.kind === "file") return new MemoryFileHandle(name, node.stored, this.#clock);
      throw domError("TypeMismatchError", `${name} is a directory`);
    });
  }
  removeEntry(name: string, options?: { readonly recursive?: boolean }): Promise<void> {
    const index = Arr.findFirstIndex(this.#children, (child) => child.name === name);
    if (Option.isNone(index)) {
      return Promise.reject(domError("NotFoundError", `${name} does not exist`));
    }
    const node = this.#children[index.value]?.node;
    if (node instanceof MemoryDirectoryHandle && !node.isEmpty() && options?.recursive !== true) {
      return Promise.reject(domError("InvalidModificationError", `${name} is not empty`));
    }
    this.#children.splice(index.value, 1);
    return Promise.resolve();
  }
  async *entries(): AsyncIterableIterator<readonly [string, HandleEntryLike]> {
    yield* Arr.map([...this.#children], (child): readonly [string, HandleEntryLike] => [
      child.name,
      { kind: child.node.kind, name: child.name },
    ]);
  }
  isEmpty(): boolean {
    return Arr.isReadonlyArrayEmpty(this.#children);
  }
  #get(name: string, kind: Node["kind"], create: boolean): Promise<Node> {
    const invalid = this.#checkName(name);
    if (Option.isSome(invalid)) return Promise.reject(invalid.value);
    const found = this.#find(name);
    if (Option.isSome(found)) return Promise.resolve(found.value);
    if (!create) return Promise.reject(domError("NotFoundError", `${name} does not exist`));
    const node: Node =
      kind === "directory"
        ? new MemoryDirectoryHandle(name, this.#clock)
        : { kind: "file", stored: { bytes: new Uint8Array(), lastModified: this.#clock.now } };
    this.#children.push({ name, node });
    return Promise.resolve(node);
  }
}

/**
 * A fresh, empty in-memory directory named `name` (default `""`, as the
 * OPFS root is).
 *
 * @example
 * ```ts
 * import { make } from "@thomasfosterau/effect-platform-worker-shared/MemoryFileSystemHandle"
 *
 * const root = make()
 * root.getFileHandle("a.txt", { create: true }).then((file) => console.log(file.name)) // "a.txt"
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = (name = ""): DirectoryHandleLike => new MemoryDirectoryHandle(name, { now: 0 });
