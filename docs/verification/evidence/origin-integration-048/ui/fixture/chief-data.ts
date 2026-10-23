const params = new URLSearchParams(location.search);
const admin = !["member", "viewer"].includes(params.get("role") ?? "owner");
const warn = params.get("budget") === "warn";
const now = Date.now();
const store = (window as unknown as { originPagesFixture: { setQuery(name: string, value: unknown): void } }).originPagesFixture;
const node = (fields: Record<string, unknown>) => ({ color: "#7c9cff", engine: "claude", model: "claude-haiku-5-5", phase: "idle", liveRuns: 0, runs: 0, tokens: 0, costUsd: 0, ...fields });
store.setQuery("org:tree", {
  truncated: false,
  projects: [{ _id: "fixture-project", name: "Fixture project", accent: "#77c59b" }, { _id: "fixture-other-project", name: "Launch site", accent: "#e0a35c" }],
  agents: [
    node({ _id: "agent-boss", kind: "head", name: "Atlas", title: "Workspace boss", runs: 14, tokens: 482_000, costUsd: 6.2 }),
    node({ _id: "agent-chief", kind: "chief", name: "Ada", title: "Project lead", projectId: "fixture-project", phase: "working", task: "Reviewing the billing form PR", liveRuns: 1, runs: 9, tokens: 210_000, costUsd: 3.1 }),
    node({ _id: "agent-dev", kind: "agent", name: "Kai", title: "Developer", projectId: "fixture-project", runs: 21, tokens: 1_200_000, costUsd: 11.4 }),
    node({ _id: "agent-designer", kind: "agent", name: "Dana", title: "Designer", projectId: "fixture-project", runs: 3, tokens: 40_000, costUsd: 0.6 }),
    node({ _id: "agent-site-chief", kind: "chief", name: "Iris", title: "Project lead", projectId: "fixture-other-project", runs: 2, tokens: 12_000, costUsd: 0.2 }),
  ],
});
store.setQuery("budgets:overview", {
  month: new Date(now).toISOString().slice(0, 7), canEdit: admin,
  agents: [{ agentId: "agent-dev", spentUsd: 42.5, runs: 48, monthlyUsd: 50 }, { agentId: "agent-chief", spentUsd: 20, runs: 30, monthlyUsd: 20 }, { agentId: "agent-boss", spentUsd: 9.3, runs: 20 }],
  projects: [{ projectId: "fixture-project", spentUsd: 63.1, runs: 90, monthlyUsd: 150 }],
});
store.setQuery("budgets:forAgent", warn
  ? { scope: "agent", name: "Kai", spentUsd: 42.5, monthlyUsd: 50, level: "warn", canRaise: admin, teamId: "fixture-team" }
  : { scope: "agent", name: "Ada", spentUsd: 20, monthlyUsd: 20, level: "over", canRaise: admin, teamId: "fixture-team" });
store.setQuery("chiefHeartbeat:settings", { enabled: params.get("heartbeat") === "on", intervalHours: 4, staleDays: 3, lastRunAt: now - 95 * 60_000, canEdit: admin, chiefName: "Ada" });
store.setQuery("callNotes:latest", {
  _id: "fixture-note", callName: "Fixture project", startedAt: now - 40 * 60_000, minutes: 22, keyPoints: ["Launch slips a week"], decisions: ["Ship web first"], chiefName: "Ada", canCreate: admin,
  actionItems: [{ title: "Fix the signup confirmation email", owner: "Sam" }, { title: "Draft the launch post for the blog and socials" }, { title: "Book the venue for the launch party", owner: "Ana" }],
});

