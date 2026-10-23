import type { QuotaRefusal, RuntimeEvent } from "../shared/runtime-events.ts";

export type QuotaEvidence = Omit<QuotaRefusal, "retry">;

const QUOTA_CODES = new Set(["usage_limit_reached", "usage_limit_exceeded", "quota_exceeded"]);
const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

export function providerQuotaRefusal(value: unknown): QuotaEvidence | null {
  const root = record(value);
  const error = record(root?.error) ?? root;
  const data = record(error?.data);
  const code = error?.code ?? error?.type;
  const dataCode = data?.code ?? data?.type;
  if (!(typeof code === "string" && QUOTA_CODES.has(code)) && !(typeof dataCode === "string" && QUOTA_CODES.has(dataCode))) return null;
  return { kind: "quota_exhausted", scope: "account" };
}

export function httpQuotaRefusal(status: number, body: unknown): QuotaEvidence | null {
  return status === 429 ? providerQuotaRefusal(body) : null;
}

export function quotaWorkEvent(event: RuntimeEvent): boolean {
  if (event.type === "request.opened" || event.type === "request.resolved" || event.type === "cap.exhausted") return true;
  if (event.type === "item.started" || event.type === "item.updated") return true;
  if (event.type === "item.completed") return event.itemType !== "assistant_text" || (!event.synthetic && event.text.trim().length > 0);
  return event.type === "content.delta" && !event.synthetic && event.delta.length > 0;
}

export function createQuotaActivityProof() {
  let activity = false;
  return {
    note(event: RuntimeEvent): void { activity ||= quotaWorkEvent(event); },
    refusal(evidence: QuotaEvidence, quiesced: boolean): QuotaRefusal {
      return { ...evidence, retry: quiesced && !activity ? "safe_initial_refusal" : "manual" };
    },
  };
}

export function createQuotaEventProofs(deliver: (event: RuntimeEvent) => void) {
  const proofs = new Map<string, { turnId: string; proof: ReturnType<typeof createQuotaActivityProof> }>();
  return {
    emit(event: RuntimeEvent): void {
      if (event.type === "turn.started" && event.turnId && proofs.get(event.threadId)?.turnId !== event.turnId) {
        proofs.set(event.threadId, { turnId: event.turnId, proof: createQuotaActivityProof() });
      }
      if (proofs.get(event.threadId)?.turnId === event.turnId) proofs.get(event.threadId)?.proof.note(event);
      deliver(event);
      if (event.type === "turn.completed") proofs.delete(event.threadId);
    },
    refusal(threadId: string, evidence: QuotaEvidence, quiesced: boolean): QuotaRefusal | undefined {
      return proofs.get(threadId)?.proof.refusal(evidence, quiesced);
    },
  };
}
