import { fixtureBoard, cloudMutation as mutate } from "./origin-pages-cloud";
import { isDraftColumn } from "../../shared/origin-columns";
export * from "./origin-pages-cloud";

const mode = new URLSearchParams(location.search).get("columns") ?? "reordered";
const draft = { _id: "fixture-draft", title: mode === "renamed" ? "Private planning" : "Draft", order: 10, isDraft: true };
const todo = { _id: "fixture-todo", title: "Todo", order: 0 };
fixtureBoard.columns = mode === "missing" ? [todo] : [todo, draft];
fixtureBoard.tasks = [];

export async function cloudMutation<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const value = await mutate<T>(name, args);
  if (name === "tasks:ensureDefaultColumns" && !fixtureBoard.columns.some(isDraftColumn)) {
    fixtureBoard.columns = [{ ...draft, order: -1 }, ...fixtureBoard.columns];
    (window as unknown as { originPagesFixture: { setQuery(name: string, value: unknown): void } }).originPagesFixture.setQuery("tasks:board", { ...fixtureBoard });
  }
  return value;
}
