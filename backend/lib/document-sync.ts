export type SyncState = { saving: boolean; error: string; pending: number };

// A queue outlives its editor so navigating during a save cannot drop later edits.
export class DocumentSyncQueue {
  private updates: Uint8Array[] = [];
  private active: Promise<void> | null = null;
  private listeners = new Set<() => void>();
  private state: SyncState = { saving: false, error: "", pending: 0 };
  constructor(private send: (updates: Uint8Array[]) => Promise<void>) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  restore() { return this.updates.slice(); }
  private publish(saving: boolean, error = "") {
    this.state = { saving, error, pending: this.updates.length };
    for (const listener of this.listeners) listener();
  }
  add(update: Uint8Array) { this.updates.push(update); this.publish(true); }
  flush = (): Promise<void> => {
    if (this.active) return this.active;
    this.active = this.drain().finally(() => { this.active = null; });
    return this.active;
  };
  private async drain() {
    while (this.updates.length) {
      const batch = this.updates.slice();
      this.publish(true);
      try { await this.send(batch); }
      catch (error) {
        this.publish(false, error instanceof Error ? error.message : "Changes have not synced");
        return;
      }
      this.updates.splice(0, batch.length);
    }
    this.publish(false);
  }
}

const queues = new Map<string, DocumentSyncQueue>();
let listening = false;
export function documentSyncQueue(key: string, send: (updates: Uint8Array[]) => Promise<void>) {
  if (typeof window !== "undefined" && !listening) {
    listening = true;
    window.addEventListener("beforeunload", event => {
      if ([...queues.values()].some(queue => queue.snapshot().pending)) event.preventDefault();
    });
    window.addEventListener("online", () => { for (const queue of queues.values()) void queue.flush(); });
  }
  let queue = queues.get(key);
  if (!queue) { queue = new DocumentSyncQueue(send); queues.set(key, queue); }
  return queue;
}
