import { api } from "@/state/store";
import { sessionStore } from "@/lib/origin-cloud/client";
import type { PipelineChannel } from "../../../shared/origin-pipeline";
import type { DealCoach, SalesReplyChannel } from "../../../shared/origin-sales";

function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = sessionStore.get();
  if (!session) return Promise.reject(new Error("Sign in to Origin first"));
  return api<T>(path, { ...init, headers: { "content-type": "application/json", "x-origin-session": session } });
}

/** The app server sends with the member's own keys, which never leave this computer. */
export const pipelineServer = {
  connections: (projectId: string) => call<{ channels: Record<PipelineChannel, boolean>; stripe?: boolean }>(`/api/origin/pipeline/channels?projectId=${encodeURIComponent(projectId)}`)
    .then((result) => ({ channels: result.channels, stripe: result.stripe === true })),
  send: (input: { projectId: string; activityId: string; botId?: string; callerPhone?: string }) =>
    call<{ ok: true; status: string; message: string }>("/api/origin/pipeline/send", { method: "POST", body: JSON.stringify(input) }),
  refresh: (input: { projectId: string; leadId: string; activityId: string; botId?: string }) =>
    call<{ status: "in_progress" | "done" | "failed"; summary?: string }>("/api/origin/pipeline/refresh", { method: "POST", body: JSON.stringify(input) }),
  suggest: (input: { projectId: string; leadId: string; channel: SalesReplyChannel; botId: string; projectName: string }) =>
    call<{ subject?: string; body: string }>("/api/origin/pipeline/suggest", { method: "POST", body: JSON.stringify(input) }),
  quote: (input: { projectId: string; dealId: string }) => call<{ url: string; amount: number }>("/api/origin/pipeline/quote", { method: "POST", body: JSON.stringify(input) }),
  coach: (input: { projectId: string; dealId: string; botId: string; projectName: string }) =>
    call<DealCoach>("/api/origin/pipeline/coach", { method: "POST", body: JSON.stringify(input) }),
  checkPayment: (input: { projectId: string; dealId: string }) =>
    call<{ paid: boolean; amount?: number }>("/api/origin/pipeline/quote/check", { method: "POST", body: JSON.stringify(input) }),
};

const CALLER_PHONE_KEY = "origin.pipeline.callerPhone";

export function rememberedCallerPhone(): string {
  try { return localStorage.getItem(CALLER_PHONE_KEY) ?? ""; } catch { return ""; }
}

export function rememberCallerPhone(value: string): boolean {
  try { localStorage.setItem(CALLER_PHONE_KEY, value); return true; } catch { return false; }
}
