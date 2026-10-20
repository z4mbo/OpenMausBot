import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/state/store";
import { sessionStore } from "@/lib/origin-cloud/client";
import { deploymentBusy, type ShipAction, type ShipPreview, type ShipStatus } from "../../shared/origin-ship";

function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = sessionStore.get();
  if (!session) return Promise.reject(new Error("Sign in to Origin first"));
  return api<T>(path, { ...init, headers: { "content-type": "application/json", "x-origin-session": session } });
}

const post = <T>(path: string, body: Record<string, unknown>) => call<T>(path, { method: "POST", body: JSON.stringify(body) });

/** Ship's routes on this computer, which use the member's own provider tokens. */
export const originShip = {
  status: (projectId: string, fresh = false) => call<ShipStatus>(`/api/origin/ship/status?${new URLSearchParams({ projectId, ...(fresh ? { fresh: "1" } : {}) })}`),
  act: (projectId: string, targetId: string, action: ShipAction, deploymentId?: string) =>
    post<{ message: string }>("/api/origin/ship/act", { projectId, targetId, action, ...(deploymentId ? { deploymentId } : {}) }),
  previews: (projectId: string, pulls: readonly { number: number; branch: string }[]) =>
    post<{ previews: Record<number, ShipPreview[]> }>("/api/origin/ship/previews", { projectId, pulls }).then((body) => body.previews),
  draftRelease: (projectId: string, projectName: string, writer: { botId: string; name: string }) =>
    post<{ releaseId: string; tag: string; pulls: number; written: string }>("/api/origin/ship/release/draft", { projectId, projectName, writer }),
  publishRelease: (projectId: string, releaseId: string, announcer: { botId: string; name: string }) =>
    post<{ url: string; tag: string; deployed: string[]; postId?: string }>("/api/origin/ship/release/publish", { projectId, releaseId, announcer }),
};

const BUSY_POLL_MS = 4_000;
const IDLE_POLL_MS = 30_000;
/** After an action, poll fast this long even before the provider reports the new deployment. */
const AFTER_ACTION_MS = 90_000;

/** Live deployments of a project's targets: fast while something builds, slow otherwise, paused while the window is hidden. */
export function useShipStatus(projectId: string, revision: string) {
  const [status, setStatus] = useState<ShipStatus | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const kicked = useRef(0);
  const generation = useRef(0);
  const timer = useRef<number | undefined>(undefined);

  const load = useCallback(async (fresh = false) => {
    const mine = ++generation.current;
    window.clearTimeout(timer.current);
    setLoading(true);
    let busy = false;
    try {
      const next = await originShip.status(projectId, fresh);
      if (mine !== generation.current) return;
      setStatus(next);
      setError("");
      busy = next.targets.some((target) => target.deployments.some((deployment) => deploymentBusy(deployment.state)));
    } catch (cause) {
      if (mine === generation.current) setError(cause instanceof Error ? cause.message : "Could not read deployments");
    } finally {
      if (mine === generation.current) {
        setLoading(false);
        const fast = busy || Date.now() - kicked.current < AFTER_ACTION_MS;
        timer.current = window.setTimeout(() => { if (!document.hidden) void load(); }, fast ? BUSY_POLL_MS : IDLE_POLL_MS);
      }
    }
  }, [projectId]);

  useEffect(() => {
    void load();
    const visible = () => { if (!document.hidden) void load(); };
    document.addEventListener("visibilitychange", visible);
    return () => {
      generation.current++;
      window.clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [load, revision]);

  const kick = useCallback(() => {
    kicked.current = Date.now();
    void load(true);
  }, [load]);
  return { status, error, loading, reload: () => load(true), kick };
}

const PREVIEW_POLL_MS = 20_000;

/** Preview deployments of these pull requests; empty when Ship has no targets or the window is hidden. */
export function useShipPreviews(projectId: string | null | undefined, pulls: readonly { number: number; branch?: string }[]) {
  const [previews, setPreviews] = useState<Record<number, ShipPreview[]>>({});
  const wanted = pulls.filter((pull): pull is { number: number; branch: string } => Boolean(pull.branch)).slice(0, 40);
  const key = wanted.map((pull) => `${pull.number}:${pull.branch}`).join(",");
  useEffect(() => {
    if (!projectId || !key) return;
    let live = true;
    let timer: number | undefined;
    const pullsOf = key.split(",").map((entry) => {
      const at = entry.indexOf(":");
      return { number: Number(entry.slice(0, at)), branch: entry.slice(at + 1) };
    });
    const load = async () => {
      const next = document.hidden ? null : await originShip.previews(projectId, pullsOf).catch(() => null);
      if (!live) return;
      if (next) setPreviews(next);
      const busy = next && Object.values(next).some((rows) => rows.some((row) => deploymentBusy(row.state)));
      timer = window.setTimeout(() => void load(), busy ? BUSY_POLL_MS : PREVIEW_POLL_MS);
    };
    void load();
    return () => { live = false; window.clearTimeout(timer); };
  }, [projectId, key]);
  return previews;
}
