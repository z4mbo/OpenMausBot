import { useSyncExternalStore } from "react";
import type { Bot, Task } from "@/state/store";

export interface ProjectAgentSelection { agentId: string; threadId?: string; chatOpen: boolean }
const choices = new Map<string, ProjectAgentSelection>();
const visible = new Map<string, { threadId: string; token: symbol }>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const projectAgentSelection = (projectId: string): ProjectAgentSelection | undefined => choices.get(projectId);

export function chooseProjectAgent(projectId: string, agentId: string, threadId?: string, options?: { chatOpen: boolean }): void {
  const before = choices.get(projectId);
  const chatOpen = options?.chatOpen ?? before?.chatOpen ?? false;
  if (before?.agentId === agentId && before.threadId === threadId && before.chatOpen === chatOpen) return;
  choices.set(projectId, { agentId, threadId, chatOpen });
  for (const listener of listeners) listener();
}

export function revealProjectAgentThread(projectId: string, agentId: string, threadId?: string): void {
  chooseProjectAgent(projectId, agentId, threadId, { chatOpen: true });
}

export function useProjectAgentSelection(projectId: string): ProjectAgentSelection | undefined {
  return useSyncExternalStore(subscribe, () => choices.get(projectId), () => undefined);
}

export function agentConversation(bot: Pick<Bot, "threadId" | "tasks">, requested?: string): Task | undefined {
  const tasks = bot.tasks ?? [];
  return tasks.find(task => task.threadId === requested)
    ?? tasks.find(task => task.activity === "waiting-on-you")
    ?? tasks.find(task => task.busy || task.activity === "working")
    ?? tasks.find(task => task.threadId === bot.threadId)
    ?? tasks[0];
}

export function exposeProjectAgentThread(projectId: string, threadId: string): () => void {
  const token = Symbol();
  visible.set(projectId, { threadId, token });
  return () => { if (visible.get(projectId)?.token === token) visible.delete(projectId); };
}

export const visibleProjectAgentThread = (projectId: string): string | null => visible.get(projectId)?.threadId ?? null;
