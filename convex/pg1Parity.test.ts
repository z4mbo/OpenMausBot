/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { createSession, makePasswordRecord } from "./lib/auth";
import { isQuietTime } from "../lib/notification-quiet";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const password = "PG1-password-2026!";
const paginationOpts = { numItems: 50, cursor: null };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

async function fixture() {
  const t = convexTest(schema, modules);
  const people = await t.run(async ctx => {
    const record = await makePasswordRecord(password);
    const people = [];
    for (const name of ["owner", "member", "viewer", "outsider"]) {
      const email = `${name}@pg1.test`;
      const id = await ctx.db.insert("users", { name, username: name, email, ...record, role: "user", status: "active", createdAt: Date.now(), updatedAt: Date.now() });
      people.push({ id, email, sessionToken: await createSession(ctx, id) });
    }
    return people;
  });
  const [owner, member, viewer, outsider] = people;
  const { teamId } = await t.mutation(api.workspaces.create, { sessionToken: owner.sessionToken, name: "PG1 fixture", slug: "pg1-fixture" });
  for (const [person, role] of [[member, "member"], [viewer, "viewer"]] as const) {
    const invite = await t.mutation(api.workspaces.createInvite, { sessionToken: owner.sessionToken, teamId, role, email: person.email });
    await t.mutation(api.workspaces.acceptInvite, { sessionToken: person.sessionToken, token: invite.token });
  }
  const projectId = await t.mutation(api.projects.create, { sessionToken: owner.sessionToken, teamId, name: "PG1 project", repoUrl: "https://github.com/fixture/pg1" });
  for (const person of [member, viewer]) await t.mutation(api.members.addWorkspaceMember, { sessionToken: owner.sessionToken, projectId, email: person.email, role: "member" });
  const scope = { sessionToken: owner.sessionToken, projectId };
  const columns = (await t.query(api.tasks.board, scope)).columns;
  const taskId = await t.mutation(api.tasks.createTask, { ...scope, columnId: columns[0]._id, title: "PG1 issue", priority: "high", assignedToEmail: member.email, dueDate: "2026-12-15" });
  return { t, owner, member, viewer, outsider, teamId, projectId, scope, columns, taskId };
}

test("PG1 O-001 O-002: open/invite-only signup, both account invite paths and wrong-email/expired rejection", async () => {
  const f = await fixture();
  const signup = { email: "new@pg1.test", name: "New person", password, workspaceName: "New workspace" };
  const open = await f.t.action(api.auth.signup, signup);
  expect(await f.t.query(api.auth.me, { sessionToken: open.sessionToken })).toMatchObject({ email: signup.email });
  await expect(f.t.action(api.auth.login, { email: signup.email, password: "wrong-password" })).rejects.toThrow("Invalid email or password");
  expect((await f.t.action(api.auth.login, { email: signup.email, password })).user.email).toBe(signup.email);
  vi.stubEnv("ORIGIN_SIGNUP_MODE", "invite");
  expect(await f.t.query(api.auth.signupMode, {})).toEqual({ inviteOnly: true });
  await expect(f.t.action(api.auth.signup, { ...signup, email: "blocked@pg1.test" })).rejects.toThrow("invite-only");
  const invite = await f.t.mutation(api.workspaces.createInvite, { sessionToken: f.owner.sessionToken, teamId: f.teamId, role: "member", email: "invited@pg1.test" });
  await expect(f.t.action(api.auth.signup, { ...signup, email: "wrong@pg1.test", inviteToken: invite.token })).rejects.toThrow("email address");
  const invited = await f.t.action(api.auth.signup, { ...signup, email: "invited@pg1.test", inviteToken: invite.token });
  await expect(f.t.mutation(api.workspaces.acceptInvite, { sessionToken: f.outsider.sessionToken, token: invite.token })).rejects.toThrow("Sign in with");
  await f.t.mutation(api.workspaces.acceptInvite, { sessionToken: invited.sessionToken, token: invite.token });
  await expect(f.t.mutation(api.workspaces.acceptInvite, { sessionToken: invited.sessionToken, token: invite.token })).rejects.toThrow("revoked");
  const existingInvite = await f.t.mutation(api.workspaces.createInvite, { sessionToken: f.owner.sessionToken, teamId: f.teamId, role: "member", email: signup.email });
  await f.t.mutation(api.workspaces.acceptInvite, { sessionToken: open.sessionToken, token: existingInvite.token });
  expect(await f.t.query(api.workspaces.access, { sessionToken: open.sessionToken, teamId: f.teamId })).toMatchObject({ role: "member" });
  const expired = await f.t.mutation(api.workspaces.createInvite, { sessionToken: f.owner.sessionToken, teamId: f.teamId, role: "member" });
  vi.spyOn(Date, "now").mockReturnValue(expired.expiresAt + 1);
  expect(await f.t.query(api.workspaces.invitePreview, { token: expired.token })).toBeNull();
  await expect(f.t.mutation(api.workspaces.acceptInvite, { sessionToken: f.outsider.sessionToken, token: expired.token })).rejects.toThrow("expired");
  await expect(f.t.action(api.auth.signup, { ...signup, email: "expired@pg1.test", inviteToken: expired.token })).rejects.toThrow("expired");
});

test("PG1 O-003 O-005: persistent session, password change, explicit revocation, logout and 30-day expiry", async () => {
  const f = await fixture();
  const other = await f.t.action(api.auth.login, { email: f.owner.email, password });
  expect(await f.t.query(api.auth.me, { sessionToken: other.sessionToken })).not.toBeNull();
  await expect(f.t.mutation(api.auth.changePassword, { sessionToken: f.owner.sessionToken, currentPassword: "wrong-password", newPassword: "PG1-replacement-password!" })).rejects.toThrow("wrong");
  await f.t.mutation(api.auth.changePassword, { sessionToken: f.owner.sessionToken, currentPassword: password, newPassword: "PG1-replacement-password!" });
  expect(await f.t.query(api.auth.me, { sessionToken: other.sessionToken })).toBeNull();
  expect(await f.t.query(api.auth.me, { sessionToken: f.owner.sessionToken })).not.toBeNull();
  await expect(f.t.action(api.auth.login, { email: f.owner.email, password })).rejects.toThrow();
  const replacement = await f.t.action(api.auth.login, { email: f.owner.email, password: "PG1-replacement-password!" });
  await f.t.mutation(api.auth.revokeOtherSessions, { sessionToken: f.owner.sessionToken });
  expect(await f.t.query(api.auth.me, { sessionToken: replacement.sessionToken })).toBeNull();
  await f.t.mutation(api.auth.logout, { sessionToken: f.owner.sessionToken });
  await expect(f.t.query(api.projects.get, f.scope)).rejects.toThrow("Login required");
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31 * 86400000);
  expect(await f.t.query(api.auth.me, { sessionToken: f.member.sessionToken })).toBeNull();
});

test("PG1 O-004: profile updates reach a second member and invalid avatar MIME is rejected", async () => {
  const f = await fixture();
  await f.t.mutation(api.auth.updateProfile, { sessionToken: f.owner.sessionToken, name: "Updated Owner", username: "@updated" });
  const rows = await f.t.query(api.workspaces.members, { sessionToken: f.member.sessionToken, teamId: f.teamId });
  expect(rows.find(row => row.email === f.owner.email)).toMatchObject({ name: "Updated Owner", username: "updated" });
  const invalid = await f.t.run(ctx => ctx.storage.store(new Blob(["invalid"], { type: "text/plain" })));
  await expect(f.t.mutation(api.auth.updateProfile, { sessionToken: f.owner.sessionToken, avatarStorageId: invalid })).rejects.toThrow("Choose a PNG");
});

test("PG1 O-011: reusable unbound/project links, one-use bound links, list and revoke", async () => {
  const f = await fixture(), scope = { sessionToken: f.owner.sessionToken, teamId: f.teamId };
  const reusable = await f.t.mutation(api.workspaces.createInvite, { ...scope, role: "viewer", projectId: f.projectId });
  for (let i = 0; i < 2; i++) await f.t.mutation(api.workspaces.acceptInvite, { sessionToken: f.outsider.sessionToken, token: reusable.token });
  expect((await f.t.query(api.members.people, { sessionToken: f.outsider.sessionToken, projectId: f.projectId })).some(row => row.email === f.outsider.email)).toBe(true);
  const invites = await f.t.query(api.workspaces.invitations, scope);
  const invitation = invites.find((row: { token: string }) => row.token === reusable.token);
  if (!invitation) throw new Error("Reusable invitation was not listed");
  const id = invitation._id;
  await f.t.mutation(api.workspaces.revokeInvite, { sessionToken: f.owner.sessionToken, inviteId: id });
  await expect(f.t.mutation(api.workspaces.acceptInvite, { sessionToken: f.outsider.sessionToken, token: reusable.token })).rejects.toThrow("revoked");
  expect(await f.t.query(api.workspaces.invitations, scope)).toHaveLength(0);
  await expect(f.t.mutation(api.workspaces.createInvite, { ...scope, role: "admin", projectId: f.projectId })).rejects.toThrow("cannot grant");
});

test("PG1 O-030: two-user presence hides leave/idle and stale heartbeats cannot restore it", async () => {
  const f = await fixture();
  const update = { sessionToken: f.member.sessionToken, teamId: f.teamId, clientId: "member-tab", projectId: f.projectId, sequence: 1 };
  const list = () => f.t.query(api.projectPresence.list, { sessionToken: f.owner.sessionToken, teamId: f.teamId, activeSince: Date.now() - 45000 });
  await f.t.mutation(api.projectPresence.update, update);
  expect(await list()).toMatchObject([{ email: f.member.email, projectId: f.projectId }]);
  await f.t.mutation(api.projectPresence.update, { ...update, projectId: null, sequence: 2 });
  await f.t.mutation(api.projectPresence.update, update);
  expect(await list()).toEqual([]);
  await f.t.mutation(api.projectPresence.update, { ...update, sequence: 3 });
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 46000);
  expect(await list()).toEqual([]);
});

test("PG1 O-049: six-month heatmap counts mine/all and emits truncation at 5001 completions", async () => {
  const f = await fixture();
  const since = Date.UTC(2026, 4, 1), until = Date.UTC(2026, 10, 1);
  await f.t.run(async ctx => {
    for (let i = 0; i < 5001; i++) await ctx.db.insert("taskCompletions", { teamId: f.teamId, projectId: f.projectId, taskId: f.taskId, assignedToEmail: i % 2 ? f.owner.email : f.member.email, completedAt: since + i * 1000 });
  });
  const args = { sessionToken: f.owner.sessionToken, teamId: f.teamId, since, until };
  const all = await f.t.query(api.inbox.activity, { ...args, mine: false });
  expect(all.events).toHaveLength(5000); expect(all.truncated).toBe(true);
  const mine = await f.t.query(api.inbox.activity, { ...args, mine: true });
  expect(mine.events).toHaveLength(2500); expect(mine.truncated).toBe(false);
  expect(mine.events.every(row => row.projectId === f.projectId && row.completedAt >= since && row.completedAt < until)).toBe(true);
});

test("PG1 O-055: scheduled notification wake uses the current snooze deadline", async () => {
  vi.useFakeTimers();
  const f = await fixture(), scope = { sessionToken: f.member.sessionToken, teamId: f.teamId };
  const row = (await f.t.query(api.notifications.list, { ...scope, unreadOnly: true, paginationOpts })).page[0];
  const until = Date.now() + 60000;
  await f.t.mutation(api.notifications.snooze, { ...scope, id: row._id, until });
  await f.t.mutation(api.notifications.snooze, { ...scope, id: row._id, until: until + 60000 });
  await f.t.mutation(internal.notifications.wake, { id: row._id, until });
  expect((await f.t.query(api.notifications.summary, scope)).unread).toBe(0);
  await f.t.finishAllScheduledFunctions(vi.runAllTimers);
  expect((await f.t.query(api.notifications.summary, scope)).unread).toBe(1);
  expect((await f.t.query(api.notifications.list, { ...scope, unreadOnly: true, paginationOpts })).page[0]).toMatchObject({ _id: row._id, read: false });
});

test("PG1 O-038: deleting an issue removes its comments/assets/relations while unrelated records survive", async () => {
  const f = await fixture();
  const keep = await f.t.mutation(api.tasks.createTask, { ...f.scope, columnId: f.columns[0]._id, title: "Keep issue", priority: "low", assignedToEmail: f.owner.email, dueDate: "2026-12-31" });
  for (const taskId of [f.taskId, keep]) {
    await f.t.mutation(api.tasks.addComment, { ...f.scope, taskId, body: "Stored comment" });
    await f.t.mutation(api.tasks.addAsset, { ...f.scope, taskId, type: "link", name: "Stored link", url: "https://example.test/pg1" });
  }
  await f.t.mutation(api.issueRelations.connect, { sessionToken: f.owner.sessionToken, fromTaskId: f.taskId, toTaskId: keep, kind: "blocks" });
  await f.t.mutation(api.tasks.deleteTask, { ...f.scope, taskId: f.taskId });
  await f.t.run(async ctx => {
    expect(await ctx.db.get(f.taskId)).toBeNull();
    expect(await ctx.db.query("taskComments").withIndex("by_task", q => q.eq("taskId", f.taskId)).take(1)).toEqual([]);
    expect(await ctx.db.query("taskAssets").withIndex("by_task", q => q.eq("taskId", f.taskId)).take(1)).toEqual([]);
    expect(await ctx.db.query("taskRelations").withIndex("by_fromTaskId", q => q.eq("fromTaskId", f.taskId)).take(1)).toEqual([]);
  });
  const detail = await f.t.query(api.tasks.details, { ...f.scope, taskId: keep });
  expect(detail.comments).toHaveLength(1); expect(detail.assets).toHaveLength(1);
});

test("PG1 O-056: preference persistence suppresses categories/muted projects and quiet hours handle timezone overnight", async () => {
  const f = await fixture(), scope = { sessionToken: f.member.sessionToken, teamId: f.teamId };
  const prefs = { assignments: false, comments: false, mentions: false, mutedProjects: [f.projectId], quietStart: "22:00", quietEnd: "07:00", timeZone: "Europe/Rome" };
  await f.t.mutation(api.preferences.saveNotifications, { ...scope, ...prefs });
  expect(await f.t.query(api.preferences.notifications, scope)).toEqual(prefs);
  await f.t.mutation(api.notifications.markAll, scope);
  await f.t.mutation(api.tasks.addComment, { ...f.scope, taskId: f.taskId, body: "@member muted mention", mentions: [{ userId: f.member.id, token: "@member" }] });
  expect((await f.t.query(api.notifications.summary, scope)).unread).toBe(0);
  const delivery = { ...prefs, mutedProjects: [], assignments: false, comments: true, mentions: true };
  await f.t.mutation(api.preferences.saveNotifications, { ...scope, ...delivery });
  await f.t.mutation(api.tasks.updateTask, { ...f.scope, taskId: f.taskId, assignedToEmail: f.owner.email });
  await f.t.mutation(api.tasks.updateTask, { ...f.scope, taskId: f.taskId, assignedToEmail: f.member.email });
  expect((await f.t.query(api.notifications.summary, scope)).unread).toBe(0);
  await f.t.mutation(api.tasks.addComment, { ...f.scope, taskId: f.taskId, body: "Delivered ordinary comment" });
  expect((await f.t.query(api.notifications.summary, scope)).unread).toBe(1);
  await f.t.mutation(api.notifications.markAll, scope);
  await f.t.mutation(api.preferences.saveNotifications, { ...scope, ...delivery, comments: false });
  await f.t.mutation(api.tasks.addComment, { ...f.scope, taskId: f.taskId, body: "Suppressed ordinary comment" });
  expect((await f.t.query(api.notifications.summary, scope)).unread).toBe(0);
  await f.t.mutation(api.tasks.addComment, { ...f.scope, taskId: f.taskId, body: "@member delivered mention", mentions: [{ userId: f.member.id, token: "@member" }] });
  expect((await f.t.query(api.notifications.summary, scope)).unread).toBe(1);
  await f.t.mutation(api.notifications.markAll, scope);
  await f.t.mutation(api.preferences.saveNotifications, { ...scope, ...delivery, comments: true, mentions: false });
  await f.t.mutation(api.tasks.addComment, { ...f.scope, taskId: f.taskId, body: "@member suppressed mention", mentions: [{ userId: f.member.id, token: "@member" }] });
  expect((await f.t.query(api.notifications.summary, scope)).unread).toBe(0);
  await f.t.mutation(api.preferences.saveNotifications, { ...scope, ...delivery, assignments: true, mutedProjects: [f.projectId] });
  await f.t.mutation(api.tasks.addComment, { ...f.scope, taskId: f.taskId, body: "Suppressed muted project" });
  expect((await f.t.query(api.notifications.summary, scope)).unread).toBe(0);
  for (const [iso, expected] of [["2026-10-15T21:00:00Z", true], ["2026-10-16T04:30:00Z", true], ["2026-10-16T05:00:00Z", false]] as const) expect(isQuietTime(prefs, new Date(iso))).toBe(expected);
});

test("PG1 O-060: manual commit CRUD and fixture GitHub sync are idempotent and permission checked", async () => {
  const f = await fixture();
  await f.t.mutation(api.commits.addManual, { ...f.scope, sha: "manual", message: "Manual commit", author: "PG1" });
  const payload = [{ sha: "abcdef", html_url: "https://github.com/fixture/pg1/commit/abcdef", commit: { message: "Fixture sync\nbody", author: { name: "PG1", date: "2026-10-15T10:00:00Z" } } }];
  const fetcher = vi.fn(async (_url: string) => Response.json(payload)); vi.stubGlobal("fetch", fetcher);
  for (let i = 0; i < 2; i++) expect(await f.t.action(api.commits.syncGitHub, f.scope)).toMatchObject({ ok: true, count: 1 });
  expect(fetcher.mock.calls[0]?.[0]).toContain("api.github.com/repos/fixture/pg1/commits");
  const commits = await f.t.query(api.commits.list, { ...f.scope, sessionToken: f.viewer.sessionToken });
  expect(commits).toHaveLength(2);
  expect(commits.find(row => row.sha === "abcdef")).toMatchObject({ message: "Fixture sync", author: "PG1" });
  await expect(f.t.action(api.commits.syncGitHub, { ...f.scope, sessionToken: f.viewer.sessionToken })).rejects.toThrow("Edit role");
  for (const row of commits) await f.t.mutation(api.commits.remove, { ...f.scope, commitId: row._id });
  expect(await f.t.query(api.commits.list, f.scope)).toEqual([]);
});

test("PG1 O-061: configured legacy owner retains general chat/voice while ordinary accounts are denied", async () => {
  vi.resetModules(); vi.stubEnv("ORIGIN_LEGACY_OWNER_EMAIL", "owner@pg1.test");
  const f = await fixture(), scope = { sessionToken: f.owner.sessionToken };
  await f.t.mutation(api.chat.sendMessage, { ...scope, body: "Legacy message" });
  expect((await f.t.query(api.chat.listMessages, scope)).map(row => row.body)).toEqual(["Legacy message"]);
  await f.t.mutation(api.chat.joinVoice, { ...scope, audioEnabled: true, videoEnabled: false });
  await f.t.mutation(api.chat.updateVoicePresence, { ...scope, audioEnabled: false, videoEnabled: true });
  expect(await f.t.query(api.chat.listVoiceParticipants, scope)).toMatchObject([{ userId: f.owner.id, audioEnabled: false, videoEnabled: true }]);
  await expect(f.t.mutation(api.chat.joinVoice, { sessionToken: f.member.sessionToken, audioEnabled: true, videoEnabled: false })).rejects.toThrow("Use workspace chat");
  await f.t.mutation(api.chat.ackVoiceSignals, { ...scope, signalIds: [] });
  expect(await f.t.query(api.chat.listVoiceSignals, scope)).toEqual([]);
  await f.t.mutation(api.chat.leaveVoice, scope);
  expect(await f.t.query(api.chat.listVoiceParticipants, scope)).toEqual([]);
});

test("PG1 O-062: legacy active admin cannot delete an empty team; only its owner can", async () => {
  const f = await fixture();
  const teamId = await f.t.mutation(api.teams.create, { sessionToken: f.owner.sessionToken, name: "Legacy empty team" });
  const invitation = await f.t.mutation(api.teams.invite, { sessionToken: f.owner.sessionToken, teamId, email: f.member.email, role: "admin" });
  const accepted = await f.t.action(api.auth.acceptInvite, { inviteToken: invitation.inviteToken, name: "Legacy admin", password });
  expect(await f.t.query(api.teams.members, { sessionToken: accepted.sessionToken, teamId })).toContainEqual(expect.objectContaining({ email: f.member.email, role: "admin", status: "active" }));
  await expect(f.t.mutation(api.teams.remove, { sessionToken: accepted.sessionToken, teamId })).rejects.toThrow("Owner role required");
  await expect(f.t.mutation(api.teams.remove, { sessionToken: f.owner.sessionToken, teamId: f.teamId })).rejects.toThrow("Delete projects");
  await f.t.mutation(api.teams.remove, { sessionToken: f.owner.sessionToken, teamId });
  expect((await f.t.query(api.teams.listWithProjects, { sessionToken: f.owner.sessionToken })).some(row => row._id === teamId)).toBe(false);
});
