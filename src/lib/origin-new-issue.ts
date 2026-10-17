import { useSyncExternalStore } from "react";

/** A request to open the new-issue composer, for one cloud project or with the project still to choose. */
export interface NewIssueRequest { projectId: string | null; nonce: number }

let request: NewIssueRequest | null = null;
let nonce = 0;
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };

export function openNewIssue(projectId: string | null = null) {
  request = { projectId, nonce: ++nonce };
  emit();
}

export function closeNewIssue() {
  request = null;
  emit();
}

export function useNewIssueRequest(): NewIssueRequest | null {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => request, () => null);
}
