import { fixtureBoard, cloudMutation as mutate } from "./origin-pages-cloud";
import { isDraftColumn, isLegacyIdeaColumn } from "../../shared/origin-columns";
export * from "./origin-pages-cloud";

const mode = new URLSearchParams(location.search).get("columns") ?? "reordered";
const draft = { _id: "fixture-draft", title: mode === "renamed" ? "Private planning" : "Draft", order: 10, isDraft: true };
const todo = { _id: "fixture-todo", title: "Todo", order: 0 };
fixtureBoard.columns = mode === "missing" ? [todo] : mode === "legacy" ? [{ _id: "fixture-idea", title: "Idea", order: 0 }, { ...todo, order: 1 }] : [todo, draft];
fixtureBoard.tasks = mode === "legacy" ? fixtureBoard.columns.map((column, order) => ({ _id: `task-${column._id}`, columnId: column._id, title: column.title === "Idea" ? "Legacy private idea" : "Ready for GitHub", priority: "medium", done: false, order, createdAt: 1, updatedAt: 1 })) : [];

export async function cloudMutation<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const value = await mutate<T>(name, args);
  if (name === "tasks:ensureDefaultColumns" && !fixtureBoard.columns.some(isDraftColumn)) {
    const idea = fixtureBoard.columns.find(isLegacyIdeaColumn);
    fixtureBoard.columns = idea ? fixtureBoard.columns.map(column => column === idea ? { ...column, title: "Draft", isDraft: true, order: -1 } : column) : [{ ...draft, order: -1 }, ...fixtureBoard.columns];
    (window as unknown as { originPagesFixture: { setQuery(name: string, value: unknown): void } }).originPagesFixture.setQuery("tasks:board", { ...fixtureBoard });
  }
  return value;
}
export const createOriginWorkspace = async (): Promise<{ teamId: string; slug: string }> => { throw new Error("The fixture has one workspace"); };
