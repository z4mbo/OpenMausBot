import { describe, expect, it, vi } from "vitest";
import type { HandoffView } from "./coordinator.ts";
import { allocateDelegationThread } from "./delegation-thread.ts";
import type { Store, TaskRecord } from "./store.ts";

const parent = { botId: "chief", name: "Chief", threadId: "project-A" };
const input = { parent, recipientId: "researcher", fresh: false, message: "Continue the research" };
const task = (threadId: string, extra: Partial<TaskRecord> = {}): TaskRecord => ({
  threadId, title: threadId, createdAt: 1, resumeCursors: {}, ...extra,
});
const opened = (extra: Partial<NonNullable<TaskRecord["openedBy"]>> = {}) => ({ ...parent, at: 1, ...extra });
const node = (id: string, botId: string, threadId: string, parentId?: string, groupId?: string) =>
  ({ id, botId, threadId, parentId, groupId }) as HandoffView;
const previous = (...threadIds: string[]) => [node("root", parent.botId, parent.threadId),
  ...threadIds.map((threadId, i) => node(`child-${i}`, input.recipientId, threadId, "root"))];

function fixture(tasks: TaskRecord[], nodes: HandoffView[] = []) {
  let serial = 0;
  const store: Pick<Store, "tasks" | "createTask" | "setTaskOpenedBy"> = {
    tasks: vi.fn(() => tasks),
    createTask: vi.fn((_botId, title, activate, projectId, openedBy, _resume, _surface, cwd) => {
      expect(activate).toBe(false);
      const created = task(`created-${++serial}`, { title: title!, projectId, openedBy, cwd });
      tasks.unshift(created);
      return created;
    }),
    setTaskOpenedBy: vi.fn((_botId, threadId, openedBy) => {
      const existing = tasks.find(task => task.threadId === threadId);
      if (!existing) return null;
      existing.openedBy = structuredClone(openedBy);
      return existing;
    }),
  };
  const history = vi.fn(() => nodes);
  const allocate = (patch: Partial<Parameters<typeof allocateDelegationThread>[2]> = {}) => allocateDelegationThread(store, history, { ...input, ...patch });
  return { store, history, allocate };
}

describe("parent delegation conversations", () => {
  it("reuses the canonical child, leaving a direct conversation and its context untouched", () => {
    const direct = task("direct-B", { resumeCursors: { claude: { sessionId: "private-session" } } as never });
    const child = task("child-A", { openedBy: opened({ kind: "work", continuity: true }), closedBy: { botId: parent.botId, name: parent.name, at: 2 } });
    const f = fixture([direct, child]);
    const before = structuredClone(direct);
    expect(f.allocate()).toEqual({ task: child, created: false });
    expect(direct).toEqual(before);
    expect(f.store.createTask).not.toHaveBeenCalled();
    expect(f.store.setTaskOpenedBy).not.toHaveBeenCalled();
    expect(f.history).not.toHaveBeenCalled();
  });

  it("marks one existing exact work link as canonical without selecting it", () => {
    const child = task("child-A", { openedBy: opened({ kind: "work" }) });
    const f = fixture([task("direct-B"), child]);
    expect(f.allocate()).toEqual({ task: child, created: false });
    expect(child.openedBy).toMatchObject({ ...parent, kind: "work", continuity: true, at: 1 });
    expect(f.history).not.toHaveBeenCalled();
  });

  it.each([undefined, opened({ threadId: undefined })])("migrates only a unique coordinator-proven child (%j)", openedBy => {
    const child = task("child-A", { openedBy });
    const f = fixture([task("direct-B"), child], previous(child.threadId));
    expect(f.allocate()).toEqual({ task: child, created: false });
    expect(child.openedBy).toMatchObject({ ...parent, kind: "work", continuity: true });
    expect(f.store.createTask).not.toHaveBeenCalled();
  });

  it("preserves a legacy fresh job with an exact opener but no work kind", () => {
    const fresh = task("legacy-named-job", { openedBy: opened() });
    const f = fixture([fresh], previous(fresh.threadId));
    expect(f.allocate().created).toBe(true);
    expect(fresh.openedBy).not.toHaveProperty("continuity");
    expect(f.store.setTaskOpenedBy).not.toHaveBeenCalled();
  });

  it("does not infer ownership from a matching opener name or current conversation", () => {
    const f = fixture([task("direct-B"), task("old-child", { openedBy: opened() })]);
    const result = f.allocate();
    expect(result.created).toBe(true);
    expect(result.task.openedBy).toMatchObject({ ...parent, kind: "work", continuity: true });
  });

  it.each([
    { openedBy: opened({ botId: "other-chief" }) },
    { openedBy: opened({ threadId: "project-C" }) },
    { openedBy: opened({ roomLane: true }) },
    { openedBy: opened({ kind: "pair" }) },
    { archivedAt: 5 },
    { routineRunId: "routine" },
  ])("does not reuse a historical child outside this conversation scope (%j)", extra => {
    const child = task("other-child", extra);
    const f = fixture([child], previous(child.threadId));
    expect(f.allocate().created).toBe(true);
    expect(f.store.setTaskOpenedBy).not.toHaveBeenCalled();
  });

  it("does not infer a direct child from a room assignment or another parent's work", () => {
    const f = fixture([task("room-child"), task("other-parent-child")], [
      node("root", parent.botId, parent.threadId),
      node("room", input.recipientId, "room-child", "root", "room-id"),
      node("other", parent.botId, "project-C"),
      node("other-child", input.recipientId, "other-parent-child", "other"),
    ]);
    expect(f.allocate().created).toBe(true);
  });

  it.each([false, true])("creates one canonical child for ambiguous historical links (exact work: %s)", exact => {
    const tasks = ["old-A", "old-B"].map(id => task(id, { openedBy: opened(exact ? { kind: "work" } : {}) }));
    const f = fixture(tasks, previous("old-A", "old-B"));
    const first = f.allocate();
    expect(first.created).toBe(true);
    expect(f.allocate()).toEqual({ task: first.task, created: false });
    expect(f.store.createTask).toHaveBeenCalledTimes(1);
    expect(tasks.filter(task => task.threadId.startsWith("old-")).every(task => !task.openedBy?.continuity)).toBe(true);
  });

  it("preserves an explicit new conversation without replacing the canonical child", () => {
    const child = task("child-A", { openedBy: opened({ kind: "work", continuity: true }) });
    const f = fixture([child]);
    const created = f.allocate({ fresh: true });
    expect(created.created).toBe(true);
    expect(created.task.openedBy?.continuity).toBe(false);
    expect(created.task.openedBy).not.toHaveProperty("kind");
    expect(f.allocate()).toEqual({ task: child, created: false });
  });

  it("keeps a fresh named job separate when no canonical child exists yet", () => {
    const history: HandoffView[] = [];
    const f = fixture([task("direct-B")], history);
    const fresh = f.allocate({ fresh: true, title: "Independent job" });
    history.push(...previous(fresh.task.threadId));
    const saved = structuredClone(fresh.task);
    const canonical = f.allocate();
    expect(canonical.created).toBe(true);
    expect(canonical.task.threadId).not.toBe(fresh.task.threadId);
    expect(fresh.task).toEqual(saved);
    expect(f.allocate()).toEqual({ task: canonical.task, created: false });
  });

  it("refuses conflicting canonical links instead of picking either context or creating more", () => {
    const f = fixture([task("A", { openedBy: opened({ kind: "work", continuity: true }) }), task("B", { openedBy: opened({ kind: "work", continuity: true }) })]);
    expect(() => f.allocate()).toThrow("More than one delegated conversation");
    expect(f.store.createTask).not.toHaveBeenCalled();
  });

  it("gives an explicit fresh delegation its requested folder without replacing the standing child", () => {
    const child = task("child-A", { cwd: "/project/standing", openedBy: opened({ kind: "work", continuity: true }) });
    const f = fixture([child]);
    expect(f.allocate({ fresh: true, cwd: "/project/shared" }).task.cwd).toBe("/project/shared");
    expect(f.allocate({ cwd: "/other" })).toEqual({ task: child, created: false });
    expect(child.cwd).toBe("/project/standing");
  });

  it("does not pin an unrelated folder when allocating a standing delegation", () => {
    expect(fixture([]).allocate({ cwd: "/unrelated" }).task.cwd).toBeUndefined();
  });
});
