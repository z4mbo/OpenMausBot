import { describe, expect, it, vi } from "vitest";

import { cleanNote, heartbeatFallback, heartbeatPrompt, runChiefHeartbeats, type HeartbeatClaim } from "./origin-chief-heartbeat.ts";
import { recordCallNotes } from "./origin-call-notes.ts";
import { createRunLease, spentSince, type RunUsage } from "./origin-run-lease.ts";
import { budgetRefusalLine } from "./origin-shared-agents.ts";
import { standupText, standupTools, type StandupToolScope } from "./origin-standup-tool.ts";

const claim: HeartbeatClaim = {
  claimId: "c1", projectId: "p1", projectName: "Rocket", chiefAgentId: "chief", chiefName: "Ada", staleDays: 3,
  findings: {
    stale: [{ taskId: "t1", title: "Login bug", column: "Todo", days: 5 }],
    blocked: [{ agentName: "Kai", kind: "approval", text: "Push the migration" }],
    waiting: [{ number: 7, url: "https://github.com/o/r/pull/7", title: "Billing form", waitingFor: "merge" }],
  },
};

describe("run usage on finish", () => {
  it("reports only what the run added to its thread", () => {
    expect(spentSince({ input: 100, output: 10, costUsd: 0.5 }, { input: 160, output: 30, costUsd: 0.8 })).toEqual({ input: 60, output: 20, costUsd: 0.3 });
    expect(spentSince(null, { input: 5, output: 1, costUsd: null })).toEqual({ input: 5, output: 1 });
    expect(spentSince({ input: 5, output: 1, costUsd: 1 }, { input: 5, output: 1, costUsd: 1 })).toBeNull();
    expect(spentSince(null, null)).toBeNull();
  });

  it("sends the run's usage with agentRuns:finish", async () => {
    const enqueued: Array<[string, Record<string, unknown>]> = [];
    const busy = { value: false };
    let usage: RunUsage = { input: 1_000, output: 200, costUsd: 1.25 };
    const lease = createRunLease({
      mutation: async (name) => (name === "agentRuns:begin" ? { runId: "r1", status: "running", messageId: "m" } : { status: "running" }),
      outbox: { enqueue: (name, args) => { enqueued.push([name, args]); }, queuedRuns: () => [], saveQueuedRun: () => undefined, dropQueuedRun: () => undefined },
      kick: () => undefined, isBusy: () => busy.value, startQueued: async () => undefined, interrupt: vi.fn(), abandoned: () => undefined,
      usage: () => usage, now: () => 0, monotonicNow: () => 0,
    });
    await lease.begin({ botId: "b", threadId: "t", cloudThreadId: "ct", teamId: "team", text: "hi", clientId: "send:s" });
    busy.value = true;
    lease.observe("b");
    usage = { input: 1_400, output: 260, costUsd: 1.5 };
    busy.value = false;
    lease.observe("b");
    expect(enqueued).toEqual([["agentRuns:finish", { runId: "r1", status: "succeeded", usage: { input: 400, output: 60, costUsd: 0.25 } }]]);
  });
});

describe("budget refusals", () => {
  it("reads the one-line reason out of Origin's error", () => {
    const error = new Error("[CONVEX M(agentRuns:begin)] [Request ID: x] Server Error\nUncaught Error: Budget reached: Kai spent $5.20 of its $5.00 monthly budget. A workspace admin can raise it.\n    at handler (../convex/agentRuns.ts:36:20)");
    expect(budgetRefusalLine(error)).toBe("Budget reached: Kai spent $5.20 of its $5.00 monthly budget. A workspace admin can raise it.");
    expect(budgetRefusalLine(new Error("Thread not found"))).toBeNull();
  });
});

describe("Chief heartbeat", () => {
  it("prompts with the findings only, and falls back to a plain note", () => {
    const prompt = heartbeatPrompt(claim);
    expect(prompt).toContain("You are Ada, the Chief of the \"Rocket\" project");
    expect(prompt).toContain("- Stale 5d in Todo: Login bug");
    expect(prompt).toContain("- Kai waits for an approval: Push the migration");
    expect(prompt).toContain("- PR #7 waits for a merge: Billing form");
    expect(heartbeatFallback(claim).split("\n")[0]).toBe("Heartbeat: 1 issue idle 3+ days · 1 agent blocked · 1 PR waiting.");
    expect(cleanNote("## Note\n```x```\nMerge #7 first.")).toBe("Note\n \nMerge #7 first.");
  });

  it("claims each workspace's due heartbeats and posts the cheap model's note, or the fallback when it fails", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const cloud = {
      mutation: async (name: string, args: Record<string, unknown>) => {
        calls.push([name, args]);
        if (name === "chiefHeartbeat:claim") return args.teamId === "team1" ? [claim] : [{ ...claim, claimId: "c2", projectId: "p2", chiefAgentId: "chief2" }];
        return "thread";
      },
    };
    const quickText = vi.fn(async (botId: string) => {
      if (botId === "bot2") throw new Error("no model");
      return "Merge PR #7, then unblock Kai.";
    });
    const posted = await runChiefHeartbeats({
      cloud, quickText,
      agents: () => [{ teamId: "team1", agentId: "chief", botId: "bot1" }, { teamId: "team1", agentId: "dev", botId: "bot3" }, { teamId: "team2", agentId: "chief2", botId: "bot2" }],
    });
    expect(posted).toBe(2);
    expect(calls).toEqual([
      ["chiefHeartbeat:claim", { teamId: "team1", agentIds: ["chief", "dev"] }],
      ["chiefHeartbeat:post", { projectId: "p1", claimId: "c1", text: "Merge PR #7, then unblock Kai." }],
      ["chiefHeartbeat:claim", { teamId: "team2", agentIds: ["chief2"] }],
      ["chiefHeartbeat:post", { projectId: "p2", claimId: "c2", text: heartbeatFallback(claim) }],
    ]);
  });
});

describe("origin_standup", () => {
  const digest = {
    chiefName: "Ada", completed: [{ title: "Ship login" }], moved: [{ title: "Billing", column: "In Progress" }],
    waiting: [{ number: 7, title: "Billing form", checks: "pending", url: "https://github.com/o/r/pull/7" }], blockers: [{ kind: "failed_run", text: "E2E broke", agentName: "Kai" }],
  };

  it("writes the standup compactly and says when nothing moved", () => {
    expect(standupText("Rocket", digest, true)).toBe([
      "Rocket, last 24 hours (Ada's standup):",
      "Waiting for a merge (1):", "- #7 Billing form (checks pending) https://github.com/o/r/pull/7",
      "Blockers (1):", "- failed · Kai: E2E broke",
      "Done (1):", "- Ship login",
      "Moved (1):", "- Billing → In Progress",
      "Also posted to the project members' Inbox.",
    ].join("\n"));
    expect(standupText("Rocket", null, false)).toBe("Rocket: nothing moved in the last 24 hours.");
  });

  it("publishes with an admin sign-in and previews without one", async () => {
    const scope = (admin: boolean, calls: string[]): StandupToolScope => ({
      sessionToken: "s", projectId: "p1", projectName: "Rocket", teamId: "team",
      client: {
        mutation: async (name) => { calls.push(name); if (!admin) throw new Error("Uncaught Error: Admin role required"); return "d1"; },
        query: async (name) => { calls.push(name); return digest; },
      },
    });
    const adminCalls: string[] = [];
    const tool = standupTools(async () => [scope(true, adminCalls)]).origin_standup!;
    expect((await tool({}, null)).text).toContain("Also posted to the project members' Inbox.");
    expect(adminCalls).toEqual(["standup:requestNow", "standup:get"]);
    const memberCalls: string[] = [];
    const member = await standupTools(async () => [scope(false, memberCalls)]).origin_standup!({}, null);
    expect(member.text).not.toContain("Inbox");
    expect(memberCalls).toEqual(["standup:requestNow", "standup:preview"]);
  });
});

describe("call notes", () => {
  const input = { room: "p1abc", callName: "Weekly", startedAt: 1, minutes: 12, summary: { keyPoints: ["a"], decisions: [], actionItems: [{ title: "Fix it" }] } };

  it("keeps the summary and items in the call's project, never without a sign-in or a project", async () => {
    const mutation = vi.fn(async () => "note");
    const connect = () => ({ query: vi.fn(), mutation });
    expect(await recordCallNotes(input, () => ({ projects: {} }), connect)).toBe(false);
    expect(await recordCallNotes({ ...input, room: "" }, () => ({ url: "https://x.convex.cloud", sessionToken: "s", projects: {} }), connect)).toBe(false);
    expect(await recordCallNotes(input, () => ({ url: "https://x.convex.cloud", sessionToken: "s", projects: {} }), connect)).toBe(true);
    expect(mutation).toHaveBeenCalledWith("callNotes:record", {
      sessionToken: "s", projectId: "p1abc", callName: "Weekly", startedAt: 1, minutes: 12, keyPoints: ["a"], decisions: [], actionItems: [{ title: "Fix it" }],
    });
  });
});
