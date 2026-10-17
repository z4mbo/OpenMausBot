import { useEffect, useSyncExternalStore } from "react";
import type { Action, Message } from "@/state/store";

/** A member chat message to show: `conversation` is "" for the workspace channel, "dm:…" or "project:…". */
export interface MemberChatFocus {
  conversation: string;
  messageId: string;
}

/** A line of a shared agent thread to show, by its Origin ids. */
export interface AgentThreadFocus {
  cloudThreadId: string;
  cloudMessageId: string;
}

let chat: MemberChatFocus | null = null;
let agent: AgentThreadFocus | null = null;
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function requestChatFocus(next: MemberChatFocus): void {
  chat = next;
  notify();
}

export function consumeChatFocus(done: MemberChatFocus): void {
  if (chat !== done) return;
  chat = null;
  notify();
}

export function useChatFocus(): MemberChatFocus | null {
  return useSyncExternalStore(subscribe, () => chat, () => null);
}

export function requestAgentThreadFocus(next: AgentThreadFocus): void {
  agent = next;
  notify();
}

/** Scrolls to the requested line once this shared thread shows it. */
export function useAgentThreadFocus(
  view: { threadId: string; cloudThreadId?: string; messages: readonly Pick<Message, "id" | "remote">[] },
  dispatch: (action: Action) => void,
): void {
  const wanted = useSyncExternalStore(subscribe, () => agent, () => null);
  const local = wanted && wanted.cloudThreadId === view.cloudThreadId
    ? view.messages.find((message) => message.remote?.cloudId === wanted.cloudMessageId)?.id
    : undefined;
  useEffect(() => {
    if (!wanted || !local) return;
    agent = null;
    notify();
    dispatch({ type: "focusMessage", threadId: view.threadId, messageId: local });
  }, [wanted, local, view.threadId, dispatch]);
}
