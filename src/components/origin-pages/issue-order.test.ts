import { describe, expect, it } from "vitest";
import { orderForMove, stepTarget, withPendingMoves } from "./issue-order";

const tasks = [
  { _id: "a", columnId: "todo", order: 0 },
  { _id: "b", columnId: "todo", order: 1 },
  { _id: "c", columnId: "todo", order: 2 },
  { _id: "d", columnId: "doing", order: 5 },
];

describe("issue ordering", () => {
  it("places a task the way tasks:moveTask does", () => {
    expect(orderForMove(tasks, "c", "todo", "a")).toBe(-1);
    expect(orderForMove(tasks, "a", "todo", "c")).toBe(1.5);
    expect(orderForMove(tasks, "a", "doing")).toBe(6);
    expect(orderForMove(tasks, "a", "empty")).toBe(0);
    expect(orderForMove(tasks, "a", "todo", "missing")).toBe(3);
  });

  it("shows pending moves in their new lane and order", () => {
    const moved = withPendingMoves(tasks, new Map([["c", { columnId: "todo", order: -1 }], ["a", { columnId: "doing", order: 6 }]]));
    expect(moved.filter((task) => task.columnId === "todo").map((task) => task._id)).toEqual(["c", "b"]);
    expect(moved.filter((task) => task.columnId === "doing").map((task) => task._id)).toEqual(["d", "a"]);
  });

  it("steps a task one place up or down its lane, and stops at the ends", () => {
    const lane = tasks.slice(0, 3);
    expect(stepTarget(lane, "b", -1)).toEqual({ beforeTaskId: "a" });
    expect(stepTarget(lane, "a", 1)).toEqual({ beforeTaskId: "c" });
    expect(stepTarget(lane, "b", 1)).toEqual({});
    expect(stepTarget(lane, "a", -1)).toBeNull();
    expect(stepTarget(lane, "c", 1)).toBeNull();
  });
});
