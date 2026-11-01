import { describe, expect, it } from "vitest";
import { compareTaskOrder, planTaskMove, type OrderedTask } from "./task-order";

const task = (id: string, order: number, created = 0): OrderedTask => ({ _id: id, order, _creationTime: created });

/** Applies a plan and returns the column's ids in display order. */
function apply(column: OrderedTask[], moving: OrderedTask, beforeId?: string) {
  const plan = planTaskMove(column, moving._id, beforeId);
  if (plan.noop) return column.slice().sort(compareTaskOrder).map(item => item._id);
  const changes = new Map(plan.renumber.map(item => [item._id, item.order]));
  const next = column.filter(item => item._id !== moving._id).map(item => ({ ...item, order: changes.get(item._id) ?? item.order }));
  next.push({ ...moving, order: plan.order });
  return next.sort(compareTaskOrder).map(item => item._id);
}

describe("planTaskMove", () => {
  const column = [task("a", 0), task("b", 1), task("c", 2)];

  it("places a task from another column between neighbours", () => {
    const plan = planTaskMove(column, "x", "b");
    expect(plan).toEqual({ noop: false, order: 0.5, renumber: [] });
    expect(apply(column, task("x", 9), "b")).toEqual(["a", "x", "b", "c"]);
  });

  it("puts a task first, last and into an empty column", () => {
    expect(planTaskMove(column, "x", "a").order).toBe(-1);
    expect(planTaskMove(column, "x").order).toBe(3);
    expect(planTaskMove(column, "x", "missing").order).toBe(3);
    expect(planTaskMove([], "x")).toEqual({ noop: false, order: 0, renumber: [] });
  });

  it("reorders inside a column", () => {
    expect(apply(column, column[0]!, "c")).toEqual(["b", "a", "c"]);
    expect(apply(column, column[2]!, "a")).toEqual(["c", "a", "b"]);
    expect(apply(column, column[0]!)).toEqual(["b", "c", "a"]);
  });

  it("reports moves that keep the position as no-ops", () => {
    expect(planTaskMove(column, "b", "c").noop).toBe(true);
    expect(planTaskMove(column, "c").noop).toBe(true);
    expect(planTaskMove(column, "a", "b").noop).toBe(true);
    expect(planTaskMove(column, "a", "a").noop).toBe(false);
  });

  it("ignores the input order of the column", () => {
    const shuffled = [column[2]!, column[0]!, column[1]!];
    expect(planTaskMove(shuffled, "x", "b").order).toBe(0.5);
    expect(planTaskMove(shuffled, "b", "c").noop).toBe(true);
  });

  it("breaks order ties by creation time and id", () => {
    const tied = [task("b", 5, 2), task("a", 5, 2), task("c", 5, 1)];
    expect(tied.slice().sort(compareTaskOrder).map(item => item._id)).toEqual(["c", "a", "b"]);
  });

  it("renumbers the column when neighbours share an order", () => {
    const tied = [task("a", 1, 1), task("b", 1, 2), task("c", 1, 3)];
    const plan = planTaskMove(tied, "x", "b");
    expect(plan.order).toBe(1);
    expect(plan.renumber).toEqual([{ _id: "a", order: 0 }, { _id: "b", order: 2 }, { _id: "c", order: 3 }]);
    expect(apply(tied, task("x", 0), "b")).toEqual(["a", "x", "b", "c"]);
  });

  it("renumbers when repeated halving runs out of precision and keeps every order distinct", () => {
    let items = [task("a", 0), task("b", 1)];
    let renumbered = false;
    for (let step = 0; step < 80; step += 1) {
      const id = `n${step}`;
      const plan = planTaskMove(items, id, "b");
      renumbered ||= plan.renumber.length > 0;
      const changes = new Map(plan.renumber.map(item => [item._id, item.order]));
      items = [...items.map(item => ({ ...item, order: changes.get(item._id) ?? item.order })), task(id, plan.order)];
      const ids = items.slice().sort(compareTaskOrder).map(item => item._id);
      expect(ids.at(-1)).toBe("b");
      expect(ids.at(-2)).toBe(id);
      expect(new Set(items.map(item => item.order)).size).toBe(items.length);
    }
    expect(renumbered).toBe(true);
  });

  it("handles large timestamp-style orders", () => {
    const big = [task("a", 1_730_000_000_000), task("b", 1_730_000_000_001)];
    const plan = planTaskMove(big, "x", "b");
    expect(plan.order).toBe(1_730_000_000_000.5);
    expect(plan.renumber).toEqual([]);
  });
});
