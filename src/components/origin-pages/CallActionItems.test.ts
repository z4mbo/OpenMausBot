import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AgentBudgetPillView } from "../AgentBudgetPill";
import { CallActionItemsView, pendingPicks, type CallNote } from "./CallActionItems";

const note: CallNote = {
  _id: "n1", callName: "Weekly", startedAt: Date.parse("2026-10-19T09:00:00Z"), minutes: 22, keyPoints: [], decisions: [], chiefName: "Ada", canCreate: true,
  actionItems: [{ title: "Fix the signup email", owner: "Sam" }, { title: "Draft the launch post", taskId: "t1" }, { title: "Book the venue" }],
};

describe("call action items", () => {
  it("picks every ticked item that is not an issue yet", () => {
    expect(pendingPicks(note.actionItems, new Set())).toEqual([0, 2]);
    expect(pendingPicks(note.actionItems, new Set([2]))).toEqual([0]);
  });

  it("offers the remaining items as Draft issues for the Chief in one click", () => {
    const html = renderToStaticMarkup(createElement(CallActionItemsView, { note, busy: false, error: "", onCreate: vi.fn(), onDismiss: vi.fn() }));
    expect(html).toContain("Action items from Weekly");
    expect(html).toContain("In Draft");
    expect(html).toContain("Draft issues for Ada");
    expect(html).toContain("Create all 2");
    expect(renderToStaticMarkup(createElement(CallActionItemsView, { note: { ...note, canCreate: false }, busy: false, error: "", onCreate: vi.fn(), onDismiss: vi.fn() })))
      .not.toContain("Create all");
  });
});

describe("agent budget pill", () => {
  const budget = { scope: "agent" as const, name: "Kai", spentUsd: 8.5, monthlyUsd: 10, level: "warn" as const, canRaise: false, teamId: "team" };

  it("warns from 80% and stops at 100%, offering a raise to admins only", () => {
    expect(renderToStaticMarkup(createElement(AgentBudgetPillView, { budget }))).toContain("85% of Kai&#x27;s budget");
    expect(renderToStaticMarkup(createElement(AgentBudgetPillView, { budget: { ...budget, level: "ok" } }))).toBe("");
    const over = renderToStaticMarkup(createElement(AgentBudgetPillView, { budget: { ...budget, scope: "project", name: "Rocket", spentUsd: 10, level: "over" }, onRaise: vi.fn() }));
    expect(over).toContain("Rocket&#x27;s project budget is used up");
    expect(over).toContain("Raise budget");
  });
});
