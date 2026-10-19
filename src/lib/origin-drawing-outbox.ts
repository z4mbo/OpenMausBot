import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { BinaryFileData } from "@excalidraw/excalidraw/types";

type Save = (elements: readonly OrderedExcalidrawElement[]) => Promise<unknown>;
const queues = new Map<string, DrawingOutbox>();
const BATCH = 100;
const versionOf = (element: OrderedExcalidrawElement) => `${element.version}:${element.versionNonce}`;

class DrawingOutbox {
  private pending = new Map<string, OrderedExcalidrawElement>();
  private images = new Map<string, BinaryFileData>();
  private uploading = new Set<string>();
  private listeners = new Set<() => void>();
  private revision = 0;
  private busy = false;
  private failures = 0;
  private retryAt = 0;
  private durable = true;
  error = "";
  constructor(private key: string) {
    try {
      const stored = JSON.parse(localStorage.getItem(key) ?? "{}") as { elements?: unknown[]; files?: unknown[] } | unknown[];
      const elements = Array.isArray(stored) ? stored : stored.elements;
      if (Array.isArray(elements)) for (const element of elements) {
        if (element && typeof element === "object" && "id" in element && typeof element.id === "string" && "version" in element && Number.isSafeInteger(element.version) && "versionNonce" in element && Number.isSafeInteger(element.versionNonce)) this.pending.set(element.id, element as OrderedExcalidrawElement);
      }
      if (!Array.isArray(stored) && Array.isArray(stored.files)) for (const file of stored.files) {
        if (file && typeof file === "object" && "id" in file && typeof file.id === "string" && "dataURL" in file && typeof file.dataURL === "string" && "mimeType" in file && typeof file.mimeType === "string") this.images.set(file.id, file as BinaryFileData);
      }
    } catch { this.durable = false; }
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.revision;
  elements = () => [...this.pending.values()];
  files = () => [...this.images.values()];
  get size() { return this.pending.size + this.images.size; }
  get needsOpenWindow() { return this.size > 0 && !this.durable; }
  get storageNotice() { return this.needsOpenWindow ? "Drawing changes could not be stored on this device. Keep Origin open until they sync." : ""; }
  private notify() { this.revision++; for (const listener of this.listeners) listener(); }
  private persist() {
    try {
      if (this.size) localStorage.setItem(this.key, JSON.stringify({ elements: this.elements(), files: this.files() }));
      else localStorage.removeItem(this.key);
      this.durable = true;
    } catch { this.durable = false; }
    this.notify();
  }
  enqueue(elements: readonly OrderedExcalidrawElement[]) {
    for (const element of elements) this.pending.set(element.id, element);
    this.persist();
  }
  enqueueFiles(files: readonly BinaryFileData[]) {
    for (const file of files) this.images.set(file.id, file);
    this.persist();
  }
  acknowledgeFile(id: string) { this.images.delete(id); this.persist(); }
  beginFileUpload(id: string) {
    if (this.uploading.has(id)) return false;
    this.uploading.add(id);
    return true;
  }
  endFileUpload(id: string) { this.uploading.delete(id); }
  async flush(save: Save, immediate = false) {
    if (this.busy || !this.pending.size || (!immediate && Date.now() < this.retryAt)) return;
    this.busy = true;
    const batch = this.elements().slice(0, BATCH);
    try {
      await save(batch);
      for (const element of batch) if (versionOf(this.pending.get(element.id) ?? element) === versionOf(element)) this.pending.delete(element.id);
      this.failures = 0;
      this.error = "";
      this.persist();
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Could not save the drawing";
      this.retryAt = Date.now() + Math.min(30_000, 1000 * 2 ** this.failures++);
      this.notify();
    } finally { this.busy = false; }
  }
}

export function drawingOutbox(scope: { server: string; userId: string; teamId: string; canvasId?: string }) {
  const key = `origin-drawing-outbox:v1:${JSON.stringify([scope.server, scope.userId, scope.teamId, scope.canvasId ?? null])}`;
  let queue = queues.get(key);
  if (!queue) {
    queue = new DrawingOutbox(key);
    queues.set(key, queue);
  }
  return queue;
}

globalThis.addEventListener?.("beforeunload", (event) => {
  if ([...queues.values()].some((queue) => queue.needsOpenWindow)) event.preventDefault();
});
