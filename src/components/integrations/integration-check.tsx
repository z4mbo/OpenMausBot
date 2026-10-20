import { useSyncExternalStore } from "react";
import { CircleCheck, CircleAlert, Loader2 } from "lucide-react";
import { api } from "@/state/store";
import { cn } from "@/lib/cn";
import type { IntegrationCheck } from "../../../shared/integration-keys";

export type CheckState = { state: "checking" } | { state: "done"; check: IntegrationCheck } | { state: "error"; error: string };

const results = new Map<string, CheckState>();
const listeners = new Set<() => void>();
let revision = 0;
const notify = () => { revision += 1; for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** Asks this computer's server to make the provider's cheapest read with the saved key, and remembers the answer for every view. */
export async function runIntegrationCheck(id: string): Promise<void> {
  results.set(id, { state: "checking" });
  notify();
  try {
    const { check } = await api<{ check: IntegrationCheck }>(`/api/integrations/${id}/check`, { method: "POST", body: "{}" });
    results.set(id, { state: "done", check });
  } catch (cause) {
    results.set(id, { state: "error", error: cause instanceof Error ? cause.message : String(cause) });
  }
  notify();
}

/** Whether the last check of `id` found the key rejected. */
export function checkFailed(id: string): boolean {
  const result = results.get(id);
  return result?.state === "done" && !result.check.ok;
}

export function useIntegrationCheck(id: string): CheckState | undefined {
  useSyncExternalStore(subscribe, () => revision);
  return results.get(id);
}

/** Tells every view that a key was saved or removed, so it reloads what the server reports. */
export function integrationsChanged(): void {
  notify();
}

/** Changes whenever a key is saved or a check finishes, so a list can reload what the server now reports. */
export function useCheckRevision(): number {
  return useSyncExternalStore(subscribe, () => revision);
}

export function CheckResult({ id, className }: { id: string; className?: string }) {
  const result = useIntegrationCheck(id);
  if (!result) return null;
  if (result.state === "checking") return <p className={cn("flex items-center gap-1.5 text-[12px] text-ink-tertiary", className)}><Loader2 size={12} className="animate-spin" />Checking</p>;
  if (result.state === "error") return <p role="alert" className={cn("flex items-center gap-1.5 text-[12px] text-danger", className)}><CircleAlert size={12} className="shrink-0" />{result.error}</p>;
  const { check } = result;
  return (
    <p className={cn("flex min-w-0 flex-wrap items-center gap-x-1.5 text-[12px]", check.ok ? "text-success" : "text-danger", className)} role={check.ok ? "status" : "alert"}>
      {check.ok ? <CircleCheck size={12} className="shrink-0" /> : <CircleAlert size={12} className="shrink-0" />}
      <span>{check.ok ? (check.account ? `Works as ${check.account}` : "Works") : check.detail}</span>
      {check.mode === "test" && <span className="rounded bg-warning/12 px-1 text-[11px] text-warning">Test mode</span>}
    </p>
  );
}

export function CheckButton({ id, disabled, className }: { id: string; disabled?: boolean; className?: string }) {
  const result = useIntegrationCheck(id);
  return (
    <button type="button" disabled={disabled || result?.state === "checking"} onClick={() => void runIntegrationCheck(id)}
      className={cn("inline-flex min-h-7 items-center gap-1 rounded-md px-2 text-[12px] text-ink-secondary transition-colors duration-(--motion-fast) hover:bg-raised hover:text-ink disabled:opacity-50", className)}>
      {result?.state === "checking" ? <Loader2 size={12} className="animate-spin" /> : null}Check
    </button>
  );
}
