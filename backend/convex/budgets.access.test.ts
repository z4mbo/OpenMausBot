/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { createSession } from "./lib/auth";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

async function fixture() {
  const t = convexTest(schema, modules);
  const people = await t.run(async ctx => {
    const result = [];
    for (const name of ["Owner", "Outsider", "Reader"]) {
      const now = Date.now(), email = `${name.toLowerCase()}@budget-access.test`;
      const id = await ctx.db.insert("users", { name, email, role: "user", status: "active", passwordHash: "unused", salt: "unused", iterations: 1, createdAt: now, updatedAt: now });
      result.push({ id, email, token: await createSession(ctx, id) });
    }
    return { owner: result[0]!, outsider: result[1]!, reader: result[2]! };
  });
  const { teamId } = await t.mutation(api.workspaces.create, { sessionToken: people.owner.token, name: "Workspace" });
  await t.run(async ctx => {
    for (const [person, role] of [[people.outsider, "member"], [people.reader, "viewer"]] as const) {
      await ctx.db.insert("teamMembers", { teamId, userId: person.id, email: person.email, name: person.email, role, status: "active", createdAt: Date.now(), updatedAt: Date.now() });
    }
  });
  const projectId = await t.mutation(api.projects.create, { sessionToken: people.owner.token, teamId, name: "Private project" });
  await t.mutation(api.members.addWorkspaceMember, { sessionToken: people.owner.token, projectId, email: people.reader.email, role: "viewer" });
  await t.mutation(api.agents.setSharedAgents, { sessionToken: people.owner.token, teamId, enabled: true });
  const [agent] = await t.mutation(api.agents.publishProjectTeam, { sessionToken: people.owner.token, teamId, projectId, agents: [{ roleKey: "chief", kind: "chief", name: "Private Chief", soul: "Lead." }] });
  await t.mutation(api.budgets.set, { sessionToken: people.owner.token, teamId, agentId: agent!.agentId, monthlyUsd: 5 });
  return { t, ...people, teamId, projectId, agentId: agent!.agentId };
}

test("a known private-project agent ID does not grant another workspace member its budget details", async () => {
  const f = await fixture();
  await expect(f.t.query(api.budgets.forAgent, { sessionToken: f.outsider.token, agentId: f.agentId })).rejects.toThrow(/project access/i);
  expect((await f.t.query(api.budgets.overview, { sessionToken: f.outsider.token, teamId: f.teamId })).agents).toEqual([]);
});

test("workspace admins and explicit project viewers retain their budget read permissions", async () => {
  const f = await fixture();
  expect(await f.t.query(api.budgets.forAgent, { sessionToken: f.owner.token, agentId: f.agentId })).toMatchObject({ name: "Private Chief", monthlyUsd: 5, canRaise: true });
  expect(await f.t.query(api.budgets.forAgent, { sessionToken: f.reader.token, agentId: f.agentId })).toMatchObject({ name: "Private Chief", monthlyUsd: 5, canRaise: false });
  await expect(f.t.mutation(api.budgets.set, { sessionToken: f.reader.token, teamId: f.teamId, agentId: f.agentId, monthlyUsd: 10 })).rejects.toThrow(/Admin role required/);
});
