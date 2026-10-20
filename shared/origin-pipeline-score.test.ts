import { describe, expect, it } from "vitest";
import { PIPELINE_STAGES } from "./origin-pipeline.ts";
import { nextActions, scoreLead, topOpenValue } from "./origin-pipeline-score.ts";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 20, 12);
const context = { stages: PIPELINE_STAGES, topValue: 10_000, currency: "EUR", pending: false, now: NOW };
const lead = (extra: Record<string, unknown> = {}) => ({ stage: "New", createdAt: NOW - DAY, stageChangedAt: NOW - DAY, lastActivityAt: NOW - DAY, email: "a@example.test", ...extra });

describe("lead score", () => {
  it("adds and takes points with a reason for each", () => {
    const hot = scoreLead(lead({ stage: "Proposal", value: 10_000, lastReplyAt: NOW - DAY }), context);
    expect(hot.reasons).toEqual([
      { label: "Open lead", points: 20 }, { label: "Replied 1 day ago", points: 35 }, { label: "Value €10,000", points: 25 }, { label: "In Proposal", points: 20 },
    ]);
    expect(hot.score).toBe(100);
    const cold = scoreLead(lead({ stage: "Contacted", stageChangedAt: NOW - 40 * DAY, lastActivityAt: NOW - 20 * DAY, email: undefined }), context);
    expect(cold.reasons.map((reason) => reason.points)).toEqual([20, 7, -25, -10, -10]);
    expect(cold.score).toBe(0);
    expect(scoreLead(lead({ stage: "Won", value: 5 }), context)).toEqual({ score: 0, reasons: [{ label: "Won", points: 0 }] });
  });

  it("ranks values against the biggest open deal", () => {
    expect(topOpenValue([{ stage: "Won", value: 90_000 }, { stage: "New", value: 400 }, { stage: "Qualified", value: 1_200 }])).toBe(1_200);
  });

  it("suggests the most urgent next steps first", () => {
    expect(nextActions(lead({ unreadReplies: 2 }), { ...context, pending: true }).map((action) => action.kind)).toEqual(["reply", "approve"]);
    expect(nextActions(lead({ nextDue: "2026-10-01", nextStep: "Send deck" }), context)[0]).toEqual({ kind: "overdue", label: "Overdue", why: "Next step was due 2026-10-01: Send deck" });
    expect(nextActions(lead({ email: undefined }), context).map((action) => action.kind)).toEqual(["contact_info", "first_touch"]);
    expect(nextActions(lead({ stage: "Contacted", lastActivityAt: NOW - 9 * DAY }), context)).toEqual([{ kind: "follow_up", label: "Follow up", why: "No touch for 9 days" }]);
    expect(nextActions(lead({ stage: "Proposal", value: 10, stageChangedAt: NOW - 20 * DAY }), context).map((action) => action.kind)).toEqual(["close"]);
    expect(nextActions(lead({ stage: "Lost", unreadReplies: 1 }), context)).toEqual([]);
  });
});
