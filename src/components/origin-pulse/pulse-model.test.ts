import { describe, expect, it } from "vitest";
import { attentionLabel, formatCompact, formatHours, inferStage, pulseAttention, pulseDays } from "../../../shared/origin-pulse";
import { deltaText, orderByAttention, type ProjectPulse } from "./pulse-model";

const pulseWith = (attention: ProjectPulse["attention"]) => ({ attention }) as ProjectPulse;

describe("pulse model", () => {
  it("infers the furthest stage reached on real data", () => {
    const none = { ideas: 0, issues: 0, runs: 0, prs: 0, pagesLive: 0, postsPublished: 0, leads: 0 };
    expect(inferStage(none).stage).toBe("idea");
    expect(inferStage({ ...none, ideas: 4 }).stage).toBe("idea");
    expect(inferStage({ ...none, runs: 1 }).stage).toBe("build");
    expect(inferStage({ ...none, postsPublished: 1 })).toEqual({ stage: "launch", reached: { idea: true, build: false, launch: true, grow: false } });
    expect(inferStage({ ...none, issues: 3, leads: 1 }).stage).toBe("grow");
  });

  it("lists the days of a range in UTC, ending today", () => {
    const days = pulseDays(Date.UTC(2026, 9, 20, 23, 30), 7);
    expect(days).toEqual(["2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19", "2026-10-20"]);
  });

  it("compares with the previous range only when it had something", () => {
    expect(deltaText({ value: 5, previous: 0 }, 7)).toBeNull();
    expect(deltaText({ value: 6, previous: 4 }, 7)).toEqual({ text: "+50%", title: "4 in the 7 days before" });
    expect(deltaText({ value: 1, previous: 4 }, 30)?.text).toBe("−75%");
  });

  it("flags what needs a person, budget and failures as danger only when they stop work", () => {
    const attention = pulseAttention({
      build: { prsWaiting: 2 }, grow: { leadsAwaiting: 0, draftsAwaiting: 1 }, team: { approvalsWaiting: 0, failed: 1, budgetLevel: "over" },
    } as Parameters<typeof pulseAttention>[0]);
    expect(attention.map((item) => `${item.kind}:${item.tone}`)).toEqual(["prs:warn", "drafts:warn", "failed:danger", "budget:danger"]);
    expect(attention.map((item) => attentionLabel(item, "over"))).toEqual(["2 PRs waiting", "1 draft to approve", "1 failed run", "Budget reached"]);
  });

  it("orders projects by what they need, loading ones last", () => {
    const projects = [{ _id: "a", name: "Apollo" }, { _id: "b", name: "Bravo" }, { _id: "c", name: "Charlie" }, { _id: "d", name: "Delta" }];
    const loaded = new Map([
      ["a", pulseWith([])],
      ["b", pulseWith([{ kind: "prs", count: 1, tone: "warn" }])],
      ["c", pulseWith([{ kind: "failed", count: 1, tone: "danger" }])],
    ]);
    expect(orderByAttention(projects, loaded)).toEqual(["c", "b", "a", "d"]);
  });

  it("formats durations and large counts compactly", () => {
    expect(formatHours(null)).toBe("–");
    expect(formatHours(0.5)).toBe("<1h");
    expect(formatHours(30)).toBe("30h");
    expect(formatHours(72)).toBe("3d");
    expect(formatCompact(950)).toBe("950");
    expect(formatCompact(9_400)).toBe("9.4k");
    expect(formatCompact(12_000)).toBe("12k");
  });
});
