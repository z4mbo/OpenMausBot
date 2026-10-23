import { describe, expect, it } from "vitest";
import { campaignsByPost, canMove, dayKey, matchesSearch, publishOverview, defaultSlot, fromLocalInput, listOrder, matchesFilter, metricSamples, monthGrid, movedTo, placeInWeek, postsByDay, toLocalInput, weekStart, type BroadcastPost } from "./broadcast-model";

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

describe("broadcast month", () => {
  it("covers a month with whole Monday-first weeks", () => {
    const weeks = monthGrid(new Date(2026, 9, 1));
    expect(weeks).toHaveLength(5);
    expect([weeks[0][0].getDate(), weeks[0][0].getMonth(), weeks[4][6].getDate(), weeks[4][6].getMonth()]).toEqual([28, 8, 1, 10]);
    expect(monthGrid(new Date(2027, 1, 1))).toHaveLength(4);
  });

  it("groups posts by local day, earliest first", () => {
    const byDay = postsByDay([
      post("late", { status: "scheduled", scheduledAt: new Date(2026, 9, 21, 18).getTime() }),
      post("early", { status: "scheduled", scheduledAt: new Date(2026, 9, 21, 8).getTime() }),
      post("draft"),
    ]);
    expect(byDay.get(dayKey(new Date(2026, 9, 21)))!.map((item) => item._id)).toEqual(["early", "late"]);
    expect(byDay.size).toBe(1);
  });

  it("moves only scheduled posts, keeping their time of day", () => {
    const at = new Date(2026, 9, 21, 18, 30).getTime();
    expect(canMove(post("s", { status: "scheduled", scheduledAt: at }))).toBe(true);
    expect(canMove(post("p", { status: "published" }))).toBe(false);
    expect(canMove(post("a", { status: "scheduled", scheduledAt: at, needsApproval: true }))).toBe(false);
    expect(movedTo(at, new Date(2026, 9, 24))).toBe(new Date(2026, 9, 24, 18, 30).getTime());
  });

  it("collects measured channels for best times", () => {
    const metrics = { likes: 3, reposts: 1, replies: 0, at: 5 };
    expect(metricSamples([post("m", { status: "published", variants: [{ channel: "x", text: "m", result: "published", publishedAt: 9, metrics }, { channel: "bluesky", text: "m", result: "published", publishedAt: 9 }] })]))
      .toEqual([{ channel: "x", publishedAt: 9, metrics }]);
  });
});

describe("posts overview", () => {
  const now = new Date(2026, 9, 22, 12).getTime();
  const day = 86_400_000;
  it("counts approvals, the next week's queue, failures and the last month's published posts with their engagement", () => {
    const metrics = { likes: 10, reposts: 2, replies: 1, at: now };
    expect(publishOverview([
      post("a", { needsApproval: true }),
      post("soon", { status: "scheduled", scheduledAt: now + 2 * day }),
      post("later", { status: "scheduled", scheduledAt: now + 9 * day }),
      post("broken", { status: "failed" }),
      post("fresh", { status: "published", variants: [{ channel: "x", text: "f", result: "published", publishedAt: now - day, metrics }] }),
      post("old", { status: "published", variants: [{ channel: "x", text: "o", result: "published", publishedAt: now - 40 * day, metrics }] }),
    ], now)).toEqual({ approval: 1, upcoming: 1, failed: 1, published: 1, engagement: 13 });
  });

  it("searches every word across texts, media and the agent", () => {
    const found = post("p", { variants: [{ channel: "x", text: "Launch day" }], media: [{ assetId: "a", name: "hero.png", url: null, contentType: null, kind: "image" }], agentName: "Atlas" });
    expect(matchesSearch(found, "launch HERO")).toBe(true);
    expect(matchesSearch(found, "atlas")).toBe(true);
    expect(matchesSearch(found, "launch pricing")).toBe(false);
    expect(matchesSearch(found, "  ")).toBe(true);
  });

  it("maps posts to the campaigns that list them", () => {
    const map = campaignsByPost([{ _id: "c1", name: "Spring", postIds: ["p1", "p2"] }, { _id: "c2", name: "Fall", postIds: ["p2"] }, { _id: "c3", name: "Old backend" }]);
    expect(map.get("p2")).toEqual([{ id: "c1", name: "Spring" }, { id: "c2", name: "Fall" }]);
    expect(map.get("p3")).toBeUndefined();
  });
});
