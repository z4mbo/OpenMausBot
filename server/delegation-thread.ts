import type { HandoffView } from "./coordinator.ts";
import type { Store, TaskRecord } from "./store.ts";

type Parent = { botId: string; name: string; threadId: string };
type DelegationStore = Pick<Store, "tasks" | "createTask" | "setTaskOpenedBy">;
type Delegation = {
  parent: Parent;
  recipientId: string;
  fresh: boolean;
  message: string;
  title?: string;
  projectId?: string;
};

function eligible(task: TaskRecord, parent: Parent): boolean {
  const by = task.openedBy;
  return task.archivedAt === undefined && !task.routineRunId && !by?.roomLane && by?.kind !== "pair"
    && (!by || by.botId === parent.botId && (by.threadId === undefined || by.threadId === parent.threadId));
}

function continuedThread(tasks: TaskRecord[], parent: Parent, recipientId: string, history: () => HandoffView[]): TaskRecord | undefined {
  const candidates = tasks.filter(task => eligible(task, parent));
  const bound = candidates.filter(task => task.openedBy?.kind === "work" && task.openedBy.threadId === parent.threadId);
  const canonical = bound.filter(task => task.openedBy?.continuity);
  if (canonical.length > 1) throw new Error("More than one delegated conversation is linked to this parent; choose a new thread explicitly");
  if (canonical.length) return canonical[0];
  if (bound.length) return bound.length === 1 ? bound[0] : undefined;
  const nodes = history();
  const byId = new Map(nodes.map(node => [node.id, node]));
  const previous = new Set(nodes.flatMap(node => {
    const source = node.parentId ? byId.get(node.parentId) : undefined;
    return !node.groupId && node.botId === recipientId && source && !source.groupId
      && source.botId === parent.botId && source.threadId === parent.threadId ? [node.threadId] : [];
  }));
  const legacy = candidates.filter(task => previous.has(task.threadId));
  return legacy.length === 1 ? legacy[0] : undefined;
}

export function allocateDelegationThread(store: DelegationStore, history: () => HandoffView[], input: Delegation): { task: TaskRecord; created: boolean } {
  const { parent, recipientId, fresh } = input;
  const continued = fresh ? undefined : continuedThread(store.tasks(recipientId), parent, recipientId, history);
  if (continued) {
    if (!continued.openedBy?.continuity) {
      const by = continued.openedBy;
      const task = store.setTaskOpenedBy(recipientId, continued.threadId,
        { ...by, ...parent, at: by?.at ?? Date.now(), kind: "work", continuity: true });
      if (!task) throw new Error("The delegated conversation no longer exists");
      return { task, created: false };
    }
    return { task: continued, created: false };
  }
  const title = fresh ? input.title ?? (input.message.replace(/\s+/g, " ").trim().slice(0, 60) || `From ${parent.name}`) : `@${parent.name} · work`;
  const task = store.createTask(recipientId, title, false, fresh ? input.projectId : undefined,
    { ...parent, at: Date.now(), ...(fresh ? {} : { kind: "work", continuity: true }) });
  if (!task) throw new Error("The recipient no longer exists");
  return { task, created: true };
}
