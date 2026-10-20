export * from "./origin-pages-cloud";
import { fixtureCalls } from "./origin-pages-cloud";

type Fixture = { getQuery(name: string): unknown; setQuery(name: string, value: unknown): void };
type Row = Record<string, unknown>;
const fixture = () => (window as unknown as { originPagesFixture: Fixture }).originPagesFixture;

/** The synthetic cloud's answers to the budget, heartbeat and call-note mutations, shaped like the Convex functions' results. */
export async function cloudMutation<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
  fixtureCalls.push({ name, args });
  const store = fixture();
  if (name === "budgets:set") {
    const overview = store.getQuery("budgets:overview") as { agents: Row[]; projects: Row[] };
    const [list, key] = args.agentId ? [overview.agents, "agentId"] : [overview.projects, "projectId"];
    const id = args.agentId ?? args.projectId;
    const row = list.find((entry) => entry[key] === id);
    const next: Row = { [key]: id, spentUsd: 0, runs: 0, ...row };
    if (args.monthlyUsd === null) delete next.monthlyUsd;
    else next.monthlyUsd = args.monthlyUsd;
    store.setQuery("budgets:overview", { ...overview, [args.agentId ? "agents" : "projects"]: [...list.filter((entry) => entry !== row), next] });
  }
  if (name === "chiefHeartbeat:configure") store.setQuery("chiefHeartbeat:settings", { ...(store.getQuery("chiefHeartbeat:settings") as Row), ...args });
  if (name === "callNotes:createIssues") {
    const note = store.getQuery("callNotes:latest") as { actionItems: Row[] };
    const picked = new Set(args.indexes as number[]);
    store.setQuery("callNotes:latest", { ...note, actionItems: note.actionItems.map((item, index) => (picked.has(index) ? { ...item, taskId: `fixture-call-task-${index}` } : item)) });
  }
  if (name === "callNotes:dismiss") store.setQuery("callNotes:latest", null);
  return null as T;
}
