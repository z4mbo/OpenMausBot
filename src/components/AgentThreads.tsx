import { Plus } from "lucide-react";
import type { Action, Bot } from "@/state/store";
import { orderedThreadList, SidebarThreadRow } from "./SidebarThreadRow";

export function AgentThreads({ agent, threadId, locale, creating, onPick, onCreate, dispatch }: {
  agent: Bot; threadId?: string; locale: string; creating: boolean;
  onPick(threadId: string): void; onCreate(): void; dispatch(action: Action): void;
}) {
  const tasks = orderedThreadList((agent.tasks ?? []).filter(task => task.archivedAt === undefined));
  return <div className="mb-2 ml-8 border-l border-hairline/50 pl-1" role="group" aria-label={`${agent.name} threads`}>
    <button type="button" onClick={onCreate} disabled={creating}
      className="flex min-h-8 w-full items-center gap-1.5 rounded-lg px-2 text-left text-[12px] text-ink-secondary outline-none transition-colors duration-150 hover:bg-raised/50 hover:text-ink focus-visible:ring-1 focus-visible:ring-accent/60 disabled:opacity-50">
      <Plus size={14} aria-hidden="true" />{creating ? "Creating thread…" : "New thread"}
    </button>
    {tasks.map(task => <SidebarThreadRow key={task.threadId} task={task} ownerId={agent.id} locale={locale} compact current={task.threadId === threadId}
      onSelect={next => onPick(next.threadId)}
      onRename={(next, title) => dispatch({ type: "renameTask", botId: agent.id, threadId: next.threadId, title })}
      onDelete={next => dispatch({ type: "deleteTask", botId: agent.id, threadId: next.threadId })}
      onArchive={(next, archivedAt) => dispatch({ type: "updateTask", botId: agent.id, threadId: next.threadId, patch: { archivedAt } })}
      onPin={(next, pinned) => dispatch({ type: "updateTask", botId: agent.id, threadId: next.threadId, patch: { pinned } })} />)}
  </div>;
}
