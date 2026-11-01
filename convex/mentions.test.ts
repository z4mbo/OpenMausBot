/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { createSession } from "./lib/auth";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

async function fixture() {
  const t = convexTest(schema, modules);
  const people = await t.run(async (ctx) => {
    const now = Date.now();
    const out: Record<string, { id: Id<"users">; email: string; token: string }> = {};
    for (const name of ["Owner", "Member", "Bystander", "Outsider"]) {
      const email = `${name.toLowerCase()}@example.test`;
      const id = await ctx.db.insert("users", { name: `${name} Person`, username: name.toLowerCase(), email, role: "user", status: "active", passwordHash: "unused", salt: "unused", iterations: 1, createdAt: now, updatedAt: now });
      out[name.toLowerCase()] = { id, email, token: await createSession(ctx, id) };
    }
    return out as Record<"owner" | "member" | "bystander" | "outsider", { id: Id<"users">; email: string; token: string }>;
  });
  const { teamId } = await t.mutation(api.workspaces.create, { sessionToken: people.owner.token, name: "Team" });
  await t.run(async (ctx) => {
    for (const person of [people.member, people.bystander]) {
      await ctx.db.insert("teamMembers", { teamId, userId: person.id, email: person.email, name: "x", role: "member", status: "active", createdAt: Date.now(), updatedAt: Date.now() });
    }
  });
  const projectId = await t.mutation(api.projects.create, { sessionToken: people.owner.token, teamId, name: "App", repoUrl: "https://github.com/example/app" });
  await t.mutation(api.members.addWorkspaceMember, { sessionToken: people.owner.token, projectId, email: people.member.email, role: "member" });
  return { t, ...people, teamId, projectId };
}

const inbox = (f: Awaited<ReturnType<typeof fixture>>, person: { token: string }) =>
  f.t.query(api.notifications.list, { sessionToken: person.token, teamId: f.teamId, unreadOnly: true, paginationOpts: { numItems: 20, cursor: null } }).then((page) => page.page);

describe("chat mentions over the signed bridge", () => {
  test("a project chat mention reaches project members only, with its conversation and preview", async () => {
    const f = await fixture();
    await f.t.mutation(internal.notifications.chatMentions, {
      teamId: f.teamId, actorId: f.owner.id, messageId: "m-1", userIds: [f.member.id, f.bystander.id, f.outsider.id],
      conversation: `project:${f.projectId}`, preview: "  @member   please review\nthe draft  ",
    });
    expect(await inbox(f, f.member)).toMatchObject([{ kind: "mention", messageId: "m-1", conversation: `project:${f.projectId}`, projectId: f.projectId, preview: "@member please review the draft", actorName: "Owner Person" }]);
    expect(await inbox(f, f.bystander)).toEqual([]);
    await expect(inbox(f, f.outsider)).rejects.toThrow();
  });

  test("a workspace channel mention reaches any workspace member; a direct message only its other participant", async () => {
    const f = await fixture();
    await f.t.mutation(internal.notifications.chatMentions, { teamId: f.teamId, actorId: f.owner.id, messageId: "w-1", userIds: [f.bystander.id], conversation: "" });
    expect(await inbox(f, f.bystander)).toMatchObject([{ messageId: "w-1", conversation: "" }]);

    const dm = `dm:${[f.owner.id, f.member.id].sort().join(":")}`;
    await f.t.mutation(internal.notifications.chatMentions, { teamId: f.teamId, actorId: f.owner.id, messageId: "d-1", userIds: [f.member.id, f.bystander.id], conversation: dm });
    expect(await inbox(f, f.member)).toMatchObject([{ messageId: "d-1", conversation: dm }]);
    expect((await inbox(f, f.bystander)).map((row) => row.messageId)).toEqual(["w-1"]);

    await expect(f.t.mutation(internal.notifications.chatMentions, { teamId: f.teamId, actorId: f.bystander.id, messageId: "d-2", userIds: [f.member.id], conversation: dm }))
      .rejects.toThrow(/Invalid mention/);
    await expect(f.t.mutation(internal.notifications.chatMentions, { teamId: f.teamId, actorId: f.owner.id, messageId: "x", userIds: [], conversation: "room:1" }))
      .rejects.toThrow(/Invalid mention/);
  });

  test("an older server's notice without a conversation still notifies", async () => {
    const f = await fixture();
    await f.t.mutation(internal.notifications.chatMentions, { teamId: f.teamId, actorId: f.owner.id, messageId: "legacy", userIds: [f.member.id] });
    expect(await inbox(f, f.member)).toMatchObject([{ messageId: "legacy" }]);
  });
});
