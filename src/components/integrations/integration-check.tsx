import { useSyncExternalStore } from "react";
import { CircleCheck, CircleAlert, Loader2 } from "lucide-react";
import { api } from "@/state/store";
import { cn } from "@/lib/cn";
import type { IntegrationCheck } from "../../../shared/integration-keys";

export type CheckState = { state: "checking" } | { state: "done"; check: IntegrationCheck } | { state: "error"; error: string };

export type CheckScope = { teamId?: string | null; projectId?: string | null };

const results = new Map<string, CheckState>();
const scopeQuery = (scope: CheckScope = {}) => new URLSearchParams({ ...(scope.teamId ? { teamId: scope.teamId } : {}), ...(scope.projectId ? { projectId: scope.projectId } : {}) }).toString();
const resultKey = (id: string, scope?: CheckScope) => `${id}?${scopeQuery(scope)}`;
const listeners = new Set<() => void>();
let revision = 0;
const notify = () => { revision += 1; for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** Asks this computer's server to make the provider's cheapest read with the saved key, and remembers the answer for every view. */
export async function runIntegrationCheck(id: string, scope?: CheckScope): Promise<void> {
  const key = resultKey(id, scope);
  const query = scopeQuery(scope);
  results.set(key, { state: "checking" });
  notify();
  try {
    const { check } = await api<{ check: IntegrationCheck }>(`/api/integrations/${id}/check${query ? `?${query}` : ""}`, { method: "POST", body: "{}" });
    results.set(key, { state: "done", check });
  } catch (cause) {
    results.set(key, { state: "error", error: cause instanceof Error ? cause.message : String(cause) });
  }
  notify();
}

/** Whether the last check of `id` found the key rejected. */
export function checkFailed(id: string, scope?: CheckScope): boolean {
  const result = results.get(resultKey(id, scope));
  return result?.state === "done" && !result.check.ok;
}

export function useIntegrationCheck(id: string, scope?: CheckScope): CheckState | undefined {
  useSyncExternalStore(subscribe, () => revision);
  return results.get(resultKey(id, scope));
}

/** Tells every view that a key was saved or removed, so it reloads what the server reports. */
export function integrationsChanged(): void {
  notify();
}

/** Changes whenever a key is saved or a check finishes, so a list can reload what the server now reports. */
export function useCheckRevision(): number {
  return useSyncExternalStore(subscribe, () => revision, () => revision);
}

export function CheckResult({ id, scope, className }: { id: string; scope?: CheckScope; className?: string }) {
  const result = useIntegrationCheck(id, scope);
  if (!result) return null;
  if (result.state === "checking") return <p className={cn("flex items-center gap-1.5 text-[12px] text-ink-tertiary", className)}><Loader2 size={12} className="animate-spin" />Checking</p>;
  if (result.state === "error") return <p role="alert" className={cn("flex items-center gap-1.5 text-[12px] text-danger", className)}><CircleAlert size={12} className="shrink-0" />{result.error}</p>;
  const { check } = result;
  return (
    <p className={cn("flex min-w-0 flex-wrap items-center gap-x-1.5 text-[12px]", check.ok ? "text-success" : "text-danger", className)} role={check.ok ? "status" : "alert"}>
      {check.ok ? <CircleCheck size={12} className="shrink-0" /> : <CircleAlert size={12} className="shrink-0" />}
      <span>{check.ok ? (check.account ? `Works as ${check.account}` : "Works") : check.detail}</span>
    </p>
  );
}

export function CheckButton({ id, scope, disabled, className }: { id: string; scope?: CheckScope; disabled?: boolean; className?: string }) {
  const result = useIntegrationCheck(id, scope);
  return (
    <button type="button" disabled={disabled || result?.state === "checking"} onClick={() => void runIntegrationCheck(id, scope)}
      className={cn("inline-flex min-h-7 items-center gap-1 rounded-md px-2 text-[12px] text-ink-secondary transition-colors duration-(--motion-fast) hover:bg-raised hover:text-ink disabled:opacity-50", className)}>
      {result?.state === "checking" ? <Loader2 size={12} className="animate-spin" /> : null}Check
    </button>
  );
}
