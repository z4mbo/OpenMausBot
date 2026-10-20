import { describe, expect, it } from "vitest";
import type { PipelineLead } from "../../../shared/origin-pipeline";
import { dueTone, matchesLead, orderForDrop, pipelineValue, planBrief, withPendingMoves } from "./pipeline-model";

const lead = (id: string, stage: string, order: number, extra: Partial<PipelineLead> = {}): PipelineLead => ({
  _id: id, projectId: "p", name: id, source: "manual", stage, order, tags: [], createdAt: 1, updatedAt: 1, ...extra,
});

describe("pipeline board model", () => {
  const leads = [lead("a", "New", 1), lead("b", "New", 2), lead("c", "New", 3), lead("d", "Won", 1, { value: 500 }), lead("e", "Qualified", 1, { value: 200, tags: ["vip"] })];

  it("places a dropped lead between its new neighbours", () => {
    expect(orderForDrop(leads, "c", "New", "a")).toBe(0);
    expect(orderForDrop(leads, "a", "New", "c")).toBe(2.5);
    expect(orderForDrop(leads, "a", "Won")).toBe(2);
    expect(orderForDrop(leads, "a", "Lost")).toBe(1);
    const moved = withPendingMoves(leads, new Map([["a", { stage: "Won", order: 2 }]]));
    expect(moved.find((item) => item._id === "a")).toMatchObject({ stage: "Won", order: 2 });
  });

  it("searches across fields and sums open and won value", () => {
    expect(matchesLead(leads[4]!, "VIP")).toBe(true);
    expect(matchesLead(leads[0]!, "vip")).toBe(false);
    expect(pipelineValue(leads)).toEqual({ open: 200, won: 500 });
  });

  it("labels due dates by urgency", () => {
    const today = new Date(2026, 9, 20, 15);
    expect(dueTone("2026-10-19", today)).toEqual({ label: "Yesterday", tone: "late" });
    expect(dueTone("2026-10-21", today)).toEqual({ label: "Tomorrow", tone: "soon" });
    expect(dueTone("2026-11-30", today)?.tone).toBe("later");
    expect(dueTone("soon", today)).toBeNull();
  });

  it("briefs the Chief with each lead's id and the approval rule", () => {
    const brief = planBrief({ projectName: "Apollo", leads: [lead("x1", "New", 1, { name: "Ada", company: "Engines", email: "a@x.test", value: 1200, nextStep: "Intro", nextDue: "2026-11-01" })], currency: "EUR", direction: " Keep it short " });
    expect(brief).toContain("Plan an outreach strategy for this lead in Apollo's Pipeline:");
    expect(brief).toContain("- Ada (Engines) · New · €1,200 · email · next: Intro by 2026-11-01 · id x1");
    expect(brief).toContain("My direction: Keep it short");
    expect(brief).toContain("they wait for my approval in Pipeline");
  });
});
