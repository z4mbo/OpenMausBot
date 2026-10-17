import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface OutboxOp {
  id: number;
  name: string;
  args: Record<string, unknown>;
  attempts: number;
}

export interface QueuedRun {
  runId: string;
  botId: string;
  threadId: string;
  cloudThreadId: string;
  teamId: string;
  messageId: string;
  text: string;
  sender?: { name: string; id?: string };
  savedAt?: number;
}

export type SendOp = (name: string, args: Record<string, unknown>) => Promise<unknown>;

const PERMANENT_ATTEMPTS = 3;
const BACKOFF_MAX_MS = 60_000;

/** Convex reports a function's own refusal as a server error; anything else (offline, timeouts) is worth retrying as is. */
export function permanentFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Server Error|Uncaught|ArgumentValidationError|Could not find public function/.test(message);
}

/** Durable, ordered queue of writes to Origin. A keyed op still waiting absorbs later ops with its key, so a burst of
 * streaming patches to one row goes out as one write per coalescing window. */
export function openOutbox(file: string, now: () => number = Date.now) {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS ops (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT, name TEXT NOT NULL, args TEXT NOT NULL, due INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0);
    CREATE UNIQUE INDEX IF NOT EXISTS ops_key ON ops(key) WHERE key IS NOT NULL;
    CREATE TABLE IF NOT EXISTS cursors (thread TEXT PRIMARY KEY, seq INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS runs (run TEXT PRIMARY KEY, payload TEXT NOT NULL);`);
  let retryAt = 0;
  let flushing: Promise<void> | null = null;

  const enqueue = (name: string, args: Record<string, unknown>, options: { key?: string; delayMs?: number } = {}) => {
    const due = now() + (options.delayMs ?? 0);
    if (options.key) {
      const waiting = db.prepare("SELECT id, args FROM ops WHERE key = ?").get(options.key) as { id: number; args: string } | undefined;
      if (waiting) {
        db.prepare("UPDATE ops SET args = ? WHERE id = ?").run(JSON.stringify({ ...JSON.parse(waiting.args), ...args }), waiting.id);
        return;
      }
    }
    db.prepare("INSERT INTO ops (key, name, args, due) VALUES (?, ?, ?, ?)").run(options.key ?? null, name, JSON.stringify(args), due);
  };

  const pending = (): OutboxOp[] => (db.prepare("SELECT id, name, args, attempts FROM ops ORDER BY id").all() as { id: number; name: string; args: string; attempts: number }[])
    .map((row) => ({ id: row.id, name: row.name, args: JSON.parse(row.args) as Record<string, unknown>, attempts: row.attempts }));

  /** Sends due ops in order and stops at the first that is not due or cannot be sent yet, so a later write never overtakes it. */
  const drain = async (send: SendOp, onDrop?: (op: OutboxOp, error: unknown) => void) => {
    if (now() < retryAt) return;
    for (;;) {
      const row = db.prepare("SELECT id, name, args, attempts, due FROM ops ORDER BY id LIMIT 1").get() as
        { id: number; name: string; args: string; attempts: number; due: number } | undefined;
      if (!row || row.due > now()) return;
      const op = { id: row.id, name: row.name, args: JSON.parse(row.args) as Record<string, unknown>, attempts: row.attempts };
      try {
        await send(op.name, op.args);
        db.prepare("DELETE FROM ops WHERE id = ?").run(op.id);
        retryAt = 0;
      } catch (error) {
        const attempts = op.attempts + 1;
        if (permanentFailure(error) && attempts >= PERMANENT_ATTEMPTS) {
          db.prepare("DELETE FROM ops WHERE id = ?").run(op.id);
          onDrop?.(op, error);
          continue;
        }
        db.prepare("UPDATE ops SET attempts = ? WHERE id = ?").run(attempts, op.id);
        retryAt = now() + Math.min(BACKOFF_MAX_MS, 500 * 2 ** Math.min(attempts, 7));
        return;
      }
    }
  };

  return {
    enqueue,
    pending,
    flush(send: SendOp, onDrop?: (op: OutboxOp, error: unknown) => void): Promise<void> {
      flushing ??= drain(send, onDrop).finally(() => { flushing = null; });
      return flushing;
    },
    cursor(thread: string): number {
      return (db.prepare("SELECT seq FROM cursors WHERE thread = ?").get(thread) as { seq: number } | undefined)?.seq ?? 0;
    },
    setCursor(thread: string, seq: number): void {
      db.prepare("INSERT INTO cursors (thread, seq) VALUES (?, ?) ON CONFLICT(thread) DO UPDATE SET seq = MAX(seq, excluded.seq)").run(thread, seq);
    },
    queuedRuns(): QueuedRun[] {
      return (db.prepare("SELECT payload FROM runs").all() as { payload: string }[]).map((row) => JSON.parse(row.payload) as QueuedRun);
    },
    saveQueuedRun(run: QueuedRun): void {
      db.prepare("INSERT OR REPLACE INTO runs (run, payload) VALUES (?, ?)").run(run.runId, JSON.stringify(run));
    },
    dropQueuedRun(runId: string): void {
      db.prepare("DELETE FROM runs WHERE run = ?").run(runId);
    },
    close(): void {
      db.close();
    },
  };
}

export type Outbox = ReturnType<typeof openOutbox>;
