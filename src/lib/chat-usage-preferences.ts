import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
const choices = new Map<string, boolean>();
const DETAILS = "origin-chat-context-details";
function read(key: string): boolean {
  if (choices.has(key)) return choices.get(key)!;
  try { return globalThis.localStorage?.getItem(key) === "1"; } catch { return false; }
}
function write(key: string, value: boolean) {
  choices.set(key, value);
  try { globalThis.localStorage?.setItem(key, value ? "1" : "0"); } catch {}
  for (const listener of listeners) listener();
}
function changed(event: StorageEvent) {
  if (event.key !== null && event.key !== DETAILS) return;
  choices.clear(); for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener("storage", changed);
  return () => { listeners.delete(listener); if (!listeners.size) window.removeEventListener("storage", changed); };
}
export const useChatContextDetails = () => useSyncExternalStore(subscribe, () => read(DETAILS), () => false);
export const setChatContextDetails = (value: boolean) => write(DETAILS, value);
