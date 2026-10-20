import { describe, expect, it } from "vitest";
import { defaultSlot, fromLocalInput, listOrder, matchesFilter, placeInWeek, toLocalInput, weekStart, type BroadcastPost } from "./broadcast-model";

const post = (id: string, patch: Partial<BroadcastPost> = {}): BroadcastPost => ({
  _id: id, projectId: "p", variants: [{ channel: "x", text: id }], assetIds: [], status: "draft", createdAt: 0, updatedAt: 0, media: [], needsApproval: false, ...patch,
});

describe("broadcast week", () => {
  it("starts weeks on Monday at local midnight", () => {
    const start = weekStart(new Date(2026, 9, 22, 15).getTime());
    expect([start.getDay(), start.getDate(), start.getHours()]).toEqual([1, 19, 0]);
  });

  it("places scheduled and published posts on their day and keeps the rest unscheduled", () => {
    const start = new Date(2026, 9, 19);
    const { days, unscheduled } = placeInWeek([
      post("late", { status: "scheduled", scheduledAt: new Date(2026, 9, 21, 18).getTime() }),
      post("early", { status: "scheduled", scheduledAt: new Date(2026, 9, 21, 8).getTime() }),
      post("done", { status: "published", variants: [{ channel: "x", text: "d", result: "published", publishedAt: new Date(2026, 9, 25, 23).getTime() }] }),
      post("next", { status: "scheduled", scheduledAt: new Date(2026, 9, 26, 9).getTime() }),
      post("idea"),
    ], start);
    expect(days[2].map((item) => item._id)).toEqual(["early", "late"]);
    expect(days[6].map((item) => item._id)).toEqual(["done"]);
    expect(unscheduled.map((item) => item._id)).toEqual(["idea"]);
  });

  it("offers 9:00 on a future day and the next hour today", () => {
    const now = new Date(2026, 9, 20, 14, 20).getTime();
    expect(new Date(defaultSlot(new Date(2026, 9, 21), now)).getHours()).toBe(9);
    expect(new Date(defaultSlot(new Date(2026, 9, 20), now)).getHours()).toBe(15);
  });

  it("round-trips datetime-local values", () => {
    const at = new Date(2026, 10, 2, 9, 30).getTime();
    expect(fromLocalInput(toLocalInput(at))).toBe(at);
    expect(fromLocalInput("")).toBeUndefined();
  });
});

describe("broadcast list", () => {
  it("puts approvals and failures first, then upcoming posts soonest first", () => {
    const ordered = listOrder([
      post("published", { status: "published" }),
      post("later", { status: "scheduled", scheduledAt: 200 }),
      post("approve", { needsApproval: true }),
      post("sooner", { status: "scheduled", scheduledAt: 100 }),
      post("failed", { status: "failed" }),
    ]);
    expect(ordered.map((item) => item._id)).toEqual(["approve", "failed", "sooner", "later", "published"]);
  });

  it("filters drafts apart from those waiting for approval", () => {
    expect(matchesFilter(post("a", { needsApproval: true }), "draft")).toBe(false);
    expect(matchesFilter(post("a", { needsApproval: true }), "approval")).toBe(true);
    expect(matchesFilter(post("b", { status: "publishing" }), "scheduled")).toBe(true);
  });
});
