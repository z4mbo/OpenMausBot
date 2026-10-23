import { useSyncExternalStore } from "react";

export const CHAT_WIDTH_IDS = ["standard", "wide", "full"] as const;
export type ChatWidthId = (typeof CHAT_WIDTH_IDS)[number];

export const DEFAULT_CHAT_WIDTH: ChatWidthId = "standard";

const KEY = "omb-chat-width";
const listeners = new Set<() => void>();

function isChatWidthId(value: unknown): value is ChatWidthId {
  return (CHAT_WIDTH_IDS as readonly unknown[]).includes(value);
}

function getStore(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function readChatWidth(): ChatWidthId {
  try {
    const stored = getStore()?.getItem(KEY);
    return isChatWidthId(stored) ? stored : DEFAULT_CHAT_WIDTH;
  } catch {
    return DEFAULT_CHAT_WIDTH;
  }
}

export function applyChatWidth(id: ChatWidthId): void {
  if (id === DEFAULT_CHAT_WIDTH) delete document.documentElement.dataset.chatWidth;
  else document.documentElement.dataset.chatWidth = id;
  try {
    getStore()?.setItem(KEY, id);
  } catch {
    // Storage can be full or blocked in private mode; the width still applies this session.
  }
  for (const listener of listeners) listener();
}
function currentChatWidth(): ChatWidthId {
  if (typeof document === "undefined") return DEFAULT_CHAT_WIDTH;
  const id = document.documentElement.dataset.chatWidth;
  return isChatWidthId(id) ? id : DEFAULT_CHAT_WIDTH;
}

function changed(event: StorageEvent) {
  if (event.key !== KEY && event.key !== null) return;
  if (event.storageArea && event.storageArea !== getStore()) return;
  const id = readChatWidth();
  if (id === DEFAULT_CHAT_WIDTH) delete document.documentElement.dataset.chatWidth;
  else document.documentElement.dataset.chatWidth = id;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener("storage", changed);
  return () => { listeners.delete(listener); if (!listeners.size) window.removeEventListener("storage", changed); };
}

export const useChatWidth = () => useSyncExternalStore(subscribe, currentChatWidth, () => DEFAULT_CHAT_WIDTH);
