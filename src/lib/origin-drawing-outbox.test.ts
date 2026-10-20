import type { OutboxElement, OutboxFile } from "./origin-drawing-outbox";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const scope = { server: "https://fixture.test", userId: "user", teamId: "team", canvasId: "canvas" };
const shape = (version = 1) => ({ id: "shape", type: "rectangle", version, versionNonce: 1, x: 1, y: 1, width: 20, height: 20 }) as OutboxElement;
let stored: Map<string, string>;
beforeEach(() => {
  vi.resetModules();
  stored = new Map();
  vi.stubGlobal("localStorage", { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value), removeItem: (key: string) => stored.delete(key) });
});
afterEach(() => vi.unstubAllGlobals());
it("restores unsaved elements and image bytes after a renderer reload", async () => {
  let { drawingOutbox } = await import("./origin-drawing-outbox");
  const outbox = drawingOutbox(scope);
  const file = { id: "image", dataURL: "data:image/png;base64,YQ==", mimeType: "image/png", created: 1 } as OutboxFile;
  outbox.enqueue([shape()]); outbox.enqueueFiles([file]);
  vi.resetModules();
  ({ drawingOutbox } = await import("./origin-drawing-outbox"));
  expect(drawingOutbox(scope).elements()).toEqual([shape()]);
  expect(drawingOutbox(scope).files()).toEqual([file]);
  expect(JSON.stringify([...stored.keys()])).not.toContain("token");
});
it("preserves a newer edit when an older save is acknowledged", async () => {
  const { drawingOutbox } = await import("./origin-drawing-outbox");
  const outbox = drawingOutbox(scope);
  const save = Promise.withResolvers<void>();
  outbox.enqueue([shape()]);
  const pending = outbox.flush(() => save.promise);
  outbox.enqueue([shape(2)]);
  save.resolve(); await pending;
  expect(outbox.elements()).toEqual([shape(2)]);
  await outbox.flush(async () => {});
  expect(outbox.size).toBe(0); expect(stored.size).toBe(0);
});
it("retains a rejected batch in durable storage until a retry succeeds", async () => {
  const { drawingOutbox } = await import("./origin-drawing-outbox");
  const outbox = drawingOutbox(scope); outbox.enqueue([shape()]);
  await outbox.flush(async () => { throw new Error("Offline"); });
  expect(outbox.elements()).toEqual([shape()]); expect(stored.size).toBe(1);
  expect(outbox.error).toBe("Offline");
  await outbox.flush(async () => {}, true);
  expect(outbox.size).toBe(0); expect(outbox.error).toBe("");
});
it("separates server, account, workspace and canvas drafts", async () => {
  const { drawingOutbox } = await import("./origin-drawing-outbox");
  drawingOutbox(scope).enqueue([shape()]);
  for (const alternate of [{ server: "https://other.test" }, { userId: "other" }, { teamId: "other" }, { canvasId: "other" }, { canvasId: undefined }]) expect(drawingOutbox({ ...scope, ...alternate }).size).toBe(0);
});
it("retains edits in memory and requires an open window when device storage is full", async () => {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => { throw new Error("Quota exceeded"); }, removeItem: () => {} });
  const { drawingOutbox } = await import("./origin-drawing-outbox");
  const outbox = drawingOutbox(scope); outbox.enqueue([shape()]);
  expect(outbox.elements()).toEqual([shape()]); expect(outbox.needsOpenWindow).toBe(true);
  expect(outbox.storageNotice).toContain("Keep Origin open");
});
it("keeps unacknowledged images when element saves succeed", async () => {
  const { drawingOutbox } = await import("./origin-drawing-outbox");
  const outbox = drawingOutbox(scope);
  outbox.enqueue([shape()]); outbox.enqueueFiles([{ id: "image", dataURL: "data:image/png;base64,YQ==", mimeType: "image/png", created: 1 } as OutboxFile]);
  await outbox.flush(async () => {});
  expect(outbox.size).toBe(1); expect(stored.size).toBe(1);
  outbox.acknowledgeFile("image"); expect(outbox.size).toBe(0); expect(stored.size).toBe(0);
});
it("admits one image upload across canvas remounts sharing the same outbox", async () => {
  const { drawingOutbox } = await import("./origin-drawing-outbox");
  expect(drawingOutbox(scope).beginFileUpload("image")).toBe(true);
  expect(drawingOutbox(scope).beginFileUpload("image")).toBe(false);
  drawingOutbox(scope).endFileUpload("image");
  expect(drawingOutbox(scope).beginFileUpload("image")).toBe(true);
});
