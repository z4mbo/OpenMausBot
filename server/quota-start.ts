import type { RuntimeEvent } from "../shared/runtime-events.ts";
import { quotaWorkEvent } from "./quota-refusal.ts";

export class InitialQuotaRefusalError extends Error {
  readonly event: Extract<RuntimeEvent, { type: "turn.completed" }>;
  constructor(event: Extract<RuntimeEvent, { type: "turn.completed" }>) {
    super("The selected model exhausted its allowance before doing work.");
    this.name = "InitialQuotaRefusalError";
    this.event = event;
  }
}

interface PendingStart {
  generation: string;
  instanceId: string;
  turnId?: string;
  done: boolean;
  activity: boolean;
  result: Promise<void>;
  resolve(): void;
  reject(error: InitialQuotaRefusalError): void;
}

export function createQuotaStartGate(deps: { settled?(threadId: string, initialQuotaRefusal: boolean): void } = {}) {
  const pending = new Map<string, PendingStart>();
  const ignored = new Set<string>();
  return {
    open(threadId: string, generation: string, instanceId: string) {
      pending.get(threadId)?.resolve();
      let resolve!: () => void, reject!: (error: InitialQuotaRefusalError) => void;
      const result = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
      void result.catch(() => undefined);
      const entry: PendingStart = { generation, instanceId, done: false, activity: false, result, resolve, reject };
      pending.set(threadId, entry);
      return async <T extends { turnId: string }>(dispatch: Promise<T>): Promise<T> => {
        try {
          const [value] = await Promise.all([dispatch.then(value => {
            if (entry.turnId && entry.turnId !== value.turnId) { entry.done = true; entry.resolve(); }
            entry.turnId = value.turnId;
            return value;
          }), result]);
          return value;
        } finally {
          if (pending.get(threadId) === entry) pending.delete(threadId);
        }
      };
    },
    cancel(threadId: string, generation: string): void {
      const entry = pending.get(threadId);
      if (entry?.generation !== generation) return;
      entry.done = true;
      entry.resolve();
      pending.delete(threadId);
    },
    event(event: RuntimeEvent): boolean {
      if (ignored.has(event.eventId)) return true;
      const entry = pending.get(event.threadId);
      if (!entry || entry.done || event.providerInstanceId !== entry.instanceId || !event.turnId ||
          (entry.turnId && entry.turnId !== event.turnId)) return false;
      if (!entry.turnId && event.type !== "turn.started") return false;
      entry.turnId = event.turnId;
      entry.activity ||= quotaWorkEvent(event);
      if (entry.activity || event.type === "turn.completed" || event.type === "session.exited") {
        entry.done = true;
        if (event.type === "turn.completed" && !event.ok && !entry.activity && event.refusal?.kind === "quota_exhausted" && event.refusal.retry === "safe_initial_refusal") {
          deps.settled?.(event.threadId, true);
          ignored.add(event.eventId);
          if (ignored.size > 500) ignored.delete(ignored.values().next().value!);
          entry.reject(new InitialQuotaRefusalError(event));
          return true;
        }
        deps.settled?.(event.threadId, false);
        entry.resolve();
      }
      return false;
    },
  };
}
