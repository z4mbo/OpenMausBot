import { useSyncExternalStore } from "react";

/** The lead a Pipeline page should open once it shows its project. */
export interface LeadFocus {
  projectId: string;
  leadId: string;
}

let focus: LeadFocus | null = null;
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };

export function requestLeadFocus(next: LeadFocus): void {
  focus = next;
  notify();
}

export function consumeLeadFocus(done: LeadFocus): void {
  if (focus !== done) return;
  focus = null;
  notify();
}

export function useLeadFocus(projectId: string | null): LeadFocus | null {
  const current = useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => focus, () => null);
  return current && current.projectId === projectId ? current : null;
}
