/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { createSession } from "./lib/auth";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

test("presence heartbeats from a tab whose access just ended publish nothing instead of failing", async () => {
  const t = convexTest(schema, modules);
  const [owner, member] = await t.run(async ctx => {
    const people = [];
    for (const name of ["owner", "member"]) {
      const id = await ctx.db.insert("users", { name, email: `${name}@presence.test`, role: "user", status: "active", passwordHash: "unused", salt: "unused", iterations: 1, createdAt: 1, updatedAt: 1 });
      people.push({ id, email: `${name}@presence.test`, token: await createSession(ctx, id) });
    }
    return people;
  });
  const { teamId } = await t.mutation(api.workspaces.create, { sessionToken: owner!.token, name: "Presence" });
  const membershipId = await t.run(ctx => ctx.db.insert("teamMembers", { teamId, userId: member!.id, email: member!.email, name: "member", role: "member", status: "active", createdAt: 1, updatedAt: 1 }));
  const projectId = await t.mutation(api.projects.create, { sessionToken: owner!.token, teamId, name: "Shared" });
  const privateId = await t.mutation(api.projects.create, { sessionToken: owner!.token, teamId, name: "Private" });
  await t.mutation(api.members.addWorkspaceMember, { sessionToken: owner!.token, projectId, email: member!.email, role: "member" });
  const publish = (sequence: number, project: typeof projectId | null, sessionToken = member!.token) =>
    t.mutation(api.projectPresence.update, { sessionToken, teamId, clientId: "tab", sequence, projectId: project });
  const seen = async () => (await t.query(api.projectPresence.list, { sessionToken: owner!.token, teamId, activeSince: 0 })).map(row => row.projectId);

  await publish(1, projectId);
  expect(await seen()).toEqual([projectId]);
  // A project the member cannot open is recorded as "nowhere", not refused.
  await expect(publish(2, privateId)).resolves.toBeNull();
  expect(await seen()).toEqual([]);
  await publish(3, projectId);
  expect(await seen()).toEqual([projectId]);
  await expect(publish(4, projectId, "not-a-session")).resolves.toBeNull();

  await t.mutation(api.teams.removeMember, { sessionToken: owner!.token, teamId, memberId: membershipId });
  await expect(publish(5, projectId)).resolves.toBeNull();
  await expect(publish(6, null)).resolves.toBeNull();
  await expect(t.query(api.projectPresence.list, { sessionToken: member!.token, teamId, activeSince: 0 })).rejects.toThrow();
  const rows = await t.run(ctx => ctx.db.query("projectPresence").collect());
  expect(rows.map(row => row.sequence)).toEqual([3]);
  // Malformed sessions are still refused.
  await expect(t.mutation(api.projectPresence.update, { sessionToken: owner!.token, teamId, clientId: "", sequence: 1, projectId: null })).rejects.toThrow("Invalid presence session");
});
