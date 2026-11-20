import { describe, expect, it } from "vite-plus/test";
import * as MemoryFileSystemHandle from "@thomasfosterau/effect-platform-worker-shared/MemoryFileSystemHandle";

describe("MemoryFileSystemHandle", () => {
  it("rejects names the platform rejects", async () => {
    const root = MemoryFileSystemHandle.make();
    await expect(root.getFileHandle("", { create: true })).rejects.toMatchObject({
      name: "TypeError",
    });
    await expect(root.getDirectoryHandle(".", { create: true })).rejects.toMatchObject({
      name: "TypeError",
    });
    await expect(root.getFileHandle("..")).rejects.toMatchObject({ name: "TypeError" });
    await expect(root.getFileHandle("a/b")).rejects.toMatchObject({ name: "TypeError" });
  });

  it("rejects a kind mismatch and a missing entry", async () => {
    const root = MemoryFileSystemHandle.make("root");
    expect(root.name).toBe("root");
    await root.getFileHandle("f", { create: true });
    await root.getDirectoryHandle("d", { create: true });
    await expect(root.getDirectoryHandle("f")).rejects.toMatchObject({
      name: "TypeMismatchError",
    });
    await expect(root.getFileHandle("d")).rejects.toMatchObject({ name: "TypeMismatchError" });
    await expect(root.getFileHandle("x")).rejects.toMatchObject({ name: "NotFoundError" });
    await expect(root.removeEntry("x")).rejects.toMatchObject({ name: "NotFoundError" });
  });

  it("swaps a writable's bytes in on close", async () => {
    const root = MemoryFileSystemHandle.make();
    const handle = await root.getFileHandle("f", { create: true });
    const writable = await handle.createWritable();
    await writable.write(new TextEncoder().encode("abcdef"));
    expect((await handle.getFile()).size).toBe(0);
    await writable.truncate(2);
    await writable.write(new TextEncoder().encode("Z"));
    await writable.close();
    const file = await handle.getFile();
    expect(new TextDecoder().decode(await file.slice().arrayBuffer())).toBe("abZ");
    expect(file.lastModified).toBe(1);
  });
});
