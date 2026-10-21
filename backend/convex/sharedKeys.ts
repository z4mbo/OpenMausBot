import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { canEdit, getActiveTeamMember, projectMember, requireTeamMember } from "./lib/permissions";
import { requireUser } from "./lib/auth";
import { seal, sealingConfigured, SEALING_MISSING, unseal } from "./lib/sealing";
import type { QueryCtx } from "./_generated/server";

const ADMIN_ROLES = new Set(["owner", "admin"]);
const FIELDS_MAX = 20;
const VALUE_MAX = 4_096;
const ROWS_MAX = 200;

const purpose = (row: Pick<Doc<"sharedKeys">, "teamId" | "projectId" | "integration">) => `shared-key:${row.teamId}:${row.projectId ?? "*"}:${row.integration}`;

function checkValues(values: Record<string, string>) {
  const entries = Object.entries(values);
  if (!entries.length || entries.length > FIELDS_MAX || entries.some(([name, value]) => !/^[A-Za-z][A-Za-z0-9]{0,40}$/.test(name) || !value || value.length > VALUE_MAX)) throw new Error("Those keys don't look right");
}

async function scopeAccess(ctx: QueryCtx, sessionToken: string, teamId: Id<"teams">, projectId: Id<"projects"> | undefined) {
  const { member, user } = await requireTeamMember(ctx, teamId, sessionToken);
  if (!projectId) {
    if (!ADMIN_ROLES.has(member.role)) throw new Error("A workspace owner or admin shares keys with the whole workspace");
    return user;
  }
  const project = await ctx.db.get(projectId);
  if (!project || project.teamId !== teamId) throw new Error("Project not found");
  const access = await projectMember(ctx, project, user);
  if (!access || !ADMIN_ROLES.has(access.role)) throw new Error("A project owner or admin shares keys with the project");
  return user;
}

export const authorizeShare = internalQuery({
  args: { sessionToken: v.string(), teamId: v.id("teams"), projectId: v.optional(v.id("projects")) },
  returns: v.id("users"),
  handler: async (ctx, a) => (await scopeAccess(ctx, a.sessionToken, a.teamId, a.projectId))._id,
});

export const store = internalMutation({
  args: { teamId: v.id("teams"), projectId: v.optional(v.id("projects")), integration: v.string(), sealed: v.string(), visible: v.record(v.string(), v.string()), sharedBy: v.id("users") },
  returns: v.null(),
  handler: async (ctx, a) => {
    const rows = await ctx.db.query("sharedKeys").withIndex("by_teamId_and_integration", q => q.eq("teamId", a.teamId).eq("integration", a.integration)).take(ROWS_MAX);
    const existing = rows.find((row) => row.projectId === a.projectId);
    const fields = { ...a, updatedAt: Date.now() };
    if (existing) await ctx.db.replace(existing._id, fields);
    else await ctx.db.insert("sharedKeys", fields);
    return null;
  },
});

/** Security: values are sealed before they are stored and only `resolve` opens them, for the people allowed to use them. */
export const share = action({
  args: { sessionToken: v.string(), teamId: v.id("teams"), projectId: v.optional(v.id("projects")), integration: v.string(), values: v.record(v.string(), v.string()), visible: v.record(v.string(), v.string()) },
  returns: v.null(),
  handler: async (ctx, a) => {
    if (!/^[a-z]{2,20}$/.test(a.integration)) throw new Error("Unknown integration");
    checkValues(a.values);
    if (Object.keys(a.visible).some((name) => a.visible[name] !== a.values[name])) throw new Error("Visible fields must be among the shared values");
    if (!sealingConfigured()) throw new Error(SEALING_MISSING);
    const sharedBy: Id<"users"> = await ctx.runQuery(internal.sharedKeys.authorizeShare, { sessionToken: a.sessionToken, teamId: a.teamId, ...(a.projectId ? { projectId: a.projectId } : {}) });
    const row = { teamId: a.teamId, projectId: a.projectId, integration: a.integration };
    await ctx.runMutation(internal.sharedKeys.store, { ...row, sealed: await seal(JSON.stringify(a.values), purpose(row)), visible: a.visible, sharedBy });
    return null;
  },
});

export const unshare = mutation({
  args: { sessionToken: v.string(), teamId: v.id("teams"), projectId: v.optional(v.id("projects")), integration: v.string() },
  returns: v.null(),
  handler: async (ctx, a) => {
    await scopeAccess(ctx, a.sessionToken, a.teamId, a.projectId);
    const rows = await ctx.db.query("sharedKeys").withIndex("by_teamId_and_integration", q => q.eq("teamId", a.teamId).eq("integration", a.integration)).take(ROWS_MAX);
    for (const row of rows) if (row.projectId === a.projectId) await ctx.db.delete(row._id);
    return null;
  },
});

const sharedRow = v.object({
  integration: v.string(), teamId: v.id("teams"), projectId: v.union(v.id("projects"), v.null()), projectName: v.union(v.string(), v.null()),
  sharedByName: v.string(), visible: v.record(v.string(), v.string()), updatedAt: v.number(), mine: v.boolean(),
});

async function usableRows(ctx: QueryCtx, sessionToken: string, teamId: Id<"teams"> | undefined, needEdit: boolean) {
  const user = await requireUser(ctx, sessionToken);
  const memberships = teamId
    ? [await getActiveTeamMember(ctx, teamId, user.email)].filter((row): row is Doc<"teamMembers"> => Boolean(row))
    : (await ctx.db.query("teamMembers").withIndex("by_email", q => q.eq("email", user.email)).take(50)).filter((row) => row.status === "active");
  const rows: UsableRow[] = [];
  for (const membership of memberships) {
    if (membership.userId && membership.userId !== user._id) continue;
    for await (const row of ctx.db.query("sharedKeys").withIndex("by_teamId_and_integration", q => q.eq("teamId", membership.teamId))) {
      if (rows.length >= ROWS_MAX) break;
      let projectName: string | null = null;
      if (row.projectId) {
        const project = await ctx.db.get(row.projectId);
        const access = project ? await projectMember(ctx, project, user) : null;
        if (!project || !access || (needEdit && !canEdit(access))) continue;
        projectName = project.name;
      } else if (needEdit && !canEdit(membership)) continue;
      const by = await ctx.db.get(row.sharedBy);
      rows.push({ row, projectName, sharedByName: by?.name || by?.email || "A workspace admin" });
    }
  }
  return { user, rows };
}

/** What is shared with the caller, without any secret value. */
export const list = query({
  args: { sessionToken: v.string(), teamId: v.optional(v.id("teams")) },
  returns: v.array(sharedRow),
  handler: async (ctx, a) => {
    const { user, rows } = await usableRows(ctx, a.sessionToken, a.teamId, false);
    return rows.map(({ row, projectName, sharedByName }) => ({
      integration: row.integration, teamId: row.teamId, projectId: row.projectId ?? null, projectName, sharedByName, visible: row.visible, updatedAt: row.updatedAt, mine: row.sharedBy === user._id,
    }));
  },
});

type UsableRow = { row: Doc<"sharedKeys">; projectName: string | null; sharedByName: string };

export const usable = internalQuery({
  args: { sessionToken: v.string() },
  handler: async (ctx, a): Promise<UsableRow[]> => (await usableRows(ctx, a.sessionToken, undefined, true)).rows,
});

/**
 * The shared values the caller may use: editors of the workspace or project they were shared with. Security: the
 * member's own Origin server asks for these with the member's session and keeps them in memory only.
 */
export const resolve = action({
  args: { sessionToken: v.string() },
  returns: v.array(v.object({ integration: v.string(), teamId: v.id("teams"), projectId: v.union(v.id("projects"), v.null()), projectName: v.union(v.string(), v.null()), sharedByName: v.string(), values: v.record(v.string(), v.string()), updatedAt: v.number() })),
  handler: async (ctx, a) => {
    const rows: UsableRow[] = await ctx.runQuery(internal.sharedKeys.usable, a);
    if (rows.length && !sealingConfigured()) throw new Error(SEALING_MISSING);
    return Promise.all(rows.map(async ({ row, projectName, sharedByName }) => ({
      integration: row.integration, teamId: row.teamId, projectId: row.projectId ?? null, projectName, sharedByName, updatedAt: row.updatedAt,
      values: JSON.parse(await unseal(row.sealed, purpose(row))) as Record<string, string>,
    })));
  },
});
