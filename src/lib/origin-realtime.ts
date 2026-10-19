import { useCallback, useEffect, useRef, useState } from "react";
import { sessionStore } from "./origin-cloud/client";

export type MemberCallParticipant = {
  userId: string; name: string; username?: string; email: string; avatarUrl?: string | null;
  audioEnabled: boolean; videoEnabled: boolean; screenSharing?: boolean; joinedAt: number; lastSeenAt: number; sessionId: string;
};
export type MemberCallSignalKind = "offer" | "answer" | "candidate";
export type MemberCallSignal = { id: string; fromUserId: string; toUserId: string; fromJoinedAt?: number; toJoinedAt?: number; fromSessionId: string; toSessionId: string; kind: MemberCallSignalKind; payload: string; createdAt: number };
export type MemberChatAttachment = { id: string; name: string; size: number; contentType: string; projectId?: string };
export type MemberChatMessage = {
  id: string; authorUserId: string; authorName: string; authorEmail: string; avatarUrl?: string | null;
  body: string; createdAt: number; editedAt?: number; replyTo?: string; pinned?: boolean;
  attachments?: MemberChatAttachment[]; reactions?: Record<string, string[]>; mentions?: { userId: string; name: string }[];
};

export class OriginRealtimeError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export type RealtimeTarget = { teamId: string; room?: string; conversation?: string };

export function realtimeUrl(path: string, target: RealtimeTarget, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({ teamId: target.teamId, ...extra });
  if (target.room) params.set("room", target.room);
  if (target.conversation) params.set("conversation", target.conversation);
  return `${path}?${params}`;
}

export async function originRealtime<T>(path: string, target: RealtimeTarget, init: { method?: string; json?: unknown; body?: BodyInit; query?: Record<string, string> } = {}): Promise<T> {
  const token = sessionStore.get();
  if (!token) throw new OriginRealtimeError("Sign in to Origin first", 401);
  const response = await fetch(realtimeUrl(path, target, init.query), {
    method: init.method ?? (init.json === undefined && init.body === undefined ? "GET" : "POST"),
    headers: { "x-origin-session": token, ...(init.json === undefined ? {} : { "content-type": "application/json" }) },
    body: init.json === undefined ? init.body : JSON.stringify(init.json),
  });
  const body = await response.json().catch(() => ({})) as { error?: unknown };
  if (!response.ok) throw new OriginRealtimeError(typeof body.error === "string" ? body.error : `${response.status} ${response.statusText}`, response.status);
  return body as T;
}

export async function originRealtimeFile(target: RealtimeTarget, id: string): Promise<Blob> {
  const token = sessionStore.get();
  if (!token) throw new OriginRealtimeError("Sign in to Origin first", 401);
  const response = await fetch(realtimeUrl("/api/local-chat/files", target, { id }), { headers: { "x-origin-session": token } });
  if (!response.ok) throw new OriginRealtimeError("File not found or access denied", response.status);
  return response.blob();
}

export function usePolled<T>(load: (() => Promise<T>) | null, intervalMs: number, key: string): { value: T | undefined; error: string; refresh(): void } {
  const [value, setValue] = useState<T | undefined>(undefined);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const loader = useRef(load);
  loader.current = load;
  useEffect(() => {
    setValue(undefined);
    setError("");
  }, [key]);
  useEffect(() => {
    if (!loader.current) return;
    let alive = true;
    const run = () => {
      const current = loader.current;
      if (!current) return;
      current().then((next) => { if (alive) { setValue(next); setError(""); } })
        .catch((reason: unknown) => { if (alive) setError(reason instanceof Error ? reason.message : "Could not reach Origin"); });
    };
    run();
    const timer = window.setInterval(run, intervalMs);
    return () => { alive = false; window.clearInterval(timer); };
  }, [key, intervalMs, tick, load === null]);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  return { value, error, refresh };
}
