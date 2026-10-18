/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { createSession, makePasswordRecord } from "./lib/auth";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function fixture() {
  const t = convexTest(schema, modules);
  const sessionToken = await t.run(async ctx => {
    const record = await makePasswordRecord("synthetic-legacy-password!");
    const id = await ctx.db.insert("users", { email: "owner@legacy.test", name: "Owner", ...record, role: "user", status: "active", createdAt: Date.now(), updatedAt: Date.now() });
    return createSession(ctx, id);
  });
  const { teamId } = await t.mutation(api.workspaces.create, { sessionToken, name: "Legacy fixture", slug: "legacy-mail-fixture" });
  const projectId = await t.mutation(api.projects.create, { sessionToken, teamId, name: "Legacy project", repoUrl: "https://github.com/fixture/legacy" });
  vi.stubEnv("RESEND_API_KEY", "synthetic-key");
  vi.stubEnv("INVITE_FROM_EMAIL", "invites@origin.example");
  const provider = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", provider);
  return { t, sessionToken, teamId, projectId, provider };
}

test.each(["workspace", "project"] as const)("retired legacy %s mail creates/patches nothing and never contacts its provider", async scope => {
  const f = await fixture();
  const email = "pending@legacy.test";
  const args = { sessionToken: f.sessionToken, email, role: "member" as const };
  const existing = scope === "workspace"
    ? await f.t.mutation(api.teams.invite, { ...args, teamId: f.teamId })
    : await f.t.mutation(api.members.invite, { ...args, projectId: f.projectId });
  const rows = () => scope === "workspace"
    ? f.t.query(api.teams.members, { sessionToken: f.sessionToken, teamId: f.teamId })
    : f.t.query(api.members.list, { sessionToken: f.sessionToken, projectId: f.projectId });
  const before = await rows();
  for (const target of [email, "new@legacy.test"]) {
    const common = { ...args, email: target, origin: "https://attacker.example/\"><img src=x>", name: "Changed name", role: "admin" as const };
    const action = scope === "workspace"
      ? f.t.action(api.teams.sendInvite, { ...common, teamId: f.teamId })
      : f.t.action(api.members.sendInvite, { ...common, projectId: f.projectId });
    await expect(action).rejects.toThrow("Use workspace invitations in Origin to send email invitations");
  }
  expect(await rows()).toEqual(before);
  expect(await f.t.query(api.workspaces.invitations, { sessionToken: f.sessionToken, teamId: f.teamId })).toEqual([]);
  expect(f.provider).not.toHaveBeenCalled();
  expect(await f.t.query(api.members.getInvite, { token: existing.inviteToken })).toMatchObject({ email });
  const pending = (await rows()).find(row => row.email === email);
  if (!pending) throw new Error("Missing synthetic legacy invitation");
  if (scope === "workspace") await f.t.mutation(api.teams.removeMember, { sessionToken: f.sessionToken, teamId: f.teamId, memberId: pending._id as Id<"teamMembers"> });
  else await f.t.mutation(api.members.remove, { sessionToken: f.sessionToken, projectId: f.projectId, memberId: pending._id as Id<"members"> });
  expect(await f.t.query(api.members.getInvite, { token: existing.inviteToken })).toBeNull();
});
