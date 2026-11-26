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

  it("writes in place through a sync access handle, which locks the file until closed", async () => {
    const root = MemoryFileSystemHandle.make();
    const file = await root.getFileHandle("db", { create: true });
    const access = await file.createSyncAccessHandle?.();
    expect(access).toBeDefined();
    if (access === undefined) return;
    expect(access.write(new TextEncoder().encode("abc"))).toBe(3);
    expect(access.write(new TextEncoder().encode("Z"), { at: 1 })).toBe(1);
    const buffer = new Uint8Array(5);
    expect(access.read(buffer)).toBe(3);
    expect(new TextDecoder().decode(buffer.subarray(0, 3))).toBe("aZc");
    expect((await file.getFile()).size).toBe(3);
    await expect(file.createSyncAccessHandle?.()).rejects.toMatchObject({
      name: "NoModificationAllowedError",
    });
    await expect(file.createWritable()).rejects.toMatchObject({
      name: "NoModificationAllowedError",
    });
    access.flush();
    access.close();
    access.close();
    expect(() => access.getSize()).toThrow(expect.objectContaining({ name: "InvalidStateError" }));
    const again = await file.createSyncAccessHandle?.();
    expect(again?.getSize()).toBe(3);
  });
});
