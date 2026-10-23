import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { agentKind, avatarLook, modelIntent } from "./agentsTables";
import { requireUser } from "./lib/auth";
import { agentAccess, requireAgent, requireSharedAgents } from "./lib/agentAccess";
import { projectMember, requireTeamAdmin, requireTeamMember } from "./lib/permissions";
import { admitStorageReference, issueUpload, storageMetadata } from "./lib/storage";

const NAME_MAX = 80;
const TITLE_MAX = 120;
const DESCRIPTION_MAX = 2_000;
const SOUL_MAX = 60_000;
const ROLE_KEY = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
const TEAM_MAX = 40;

const definition = {
  name: v.string(), title: v.optional(v.string()), description: v.optional(v.string()), soul: v.optional(v.string()),
  color: v.optional(v.string()), mascotExpression: v.optional(v.string()), mascotBody: v.optional(v.string()),
  look: v.optional(avatarLook), modelIntent: v.optional(modelIntent), approvalCeiling: v.optional(v.string()),
};

const agentView = v.object({
  _id: v.id("workspaceAgents"), teamId: v.id("teams"), projectId: v.optional(v.id("projects")), kind: agentKind, roleKey: v.optional(v.string()),
  name: v.string(), title: v.string(), description: v.string(), soul: v.string(), soulVersion: v.number(), color: v.string(),
  mascotExpression: v.optional(v.string()), mascotBody: v.optional(v.string()), avatarUrl: v.union(v.string(), v.null()), look: v.optional(avatarLook),
  modelIntent: v.optional(modelIntent), approvalCeiling: v.optional(v.string()), archivedAt: v.optional(v.number()),
  createdBy: v.id("users"), updatedBy: v.optional(v.id("users")), updatedAt: v.number(), canEdit: v.boolean(), canSend: v.boolean(),
});

function clipped(value: string | undefined, max: number, label: string): string {
  const text = (value ?? "").trim();
  if (text.length > max) throw new Error(`${label} must be at most ${max} characters`);
  return text;
}

function cleanDefinition(input: { name?: string; title?: string; description?: string; soul?: string; color?: string; look?: Doc<"workspaceAgents">["look"]; approvalCeiling?: string }) {
  const out: Partial<Doc<"workspaceAgents">> = {};
  if (input.name !== undefined) {
    const name = clipped(input.name, NAME_MAX, "Name");
    if (!name) throw new Error("Name is required");
    out.name = name;
  }
  if (input.title !== undefined) out.title = clipped(input.title, TITLE_MAX, "Title");
  if (input.description !== undefined) out.description = clipped(input.description, DESCRIPTION_MAX, "Description");
  if (input.soul !== undefined) out.soul = clipped(input.soul, SOUL_MAX, "Instructions");
  if (input.color !== undefined) out.color = clipped(input.color, 32, "Colour");
  if (input.look) {
    for (const hex of [input.look.color, input.look.face]) if (hex !== undefined && !HEX.test(hex)) throw new Error("Look colours must be #RRGGBB");
    out.look = input.look;
  }
  if (input.approvalCeiling !== undefined) out.approvalCeiling = clipped(input.approvalCeiling, 32, "Approval ceiling");
  return out;
}

async function view(ctx: QueryCtx, agent: Doc<"workspaceAgents">, access: { canEdit: boolean; canSend: boolean }) {
  return {
    _id: agent._id, teamId: agent.teamId, projectId: agent.projectId, kind: agent.kind ?? "agent", roleKey: agent.roleKey,
    name: agent.name, title: agent.title ?? "", description: agent.description ?? "", soul: agent.soul ?? agent.instructions, soulVersion: agent.soulVersion ?? 1,
    color: agent.color ?? agent.avatarColor, mascotExpression: agent.mascotExpression, mascotBody: agent.mascotBody,
    avatarUrl: agent.avatarStorageId ? await ctx.storage.getUrl(agent.avatarStorageId) : null, look: agent.look,
    modelIntent: agent.modelIntent, approvalCeiling: agent.approvalCeiling, archivedAt: agent.archivedAt,
    createdBy: agent.createdBy, updatedBy: agent.updatedBy, updatedAt: agent.updatedAt, canEdit: access.canEdit, canSend: access.canSend,
  };
}

export const teamSettings = query({
  args: { sessionToken: v.string(), teamId: v.id("teams") },
  returns: v.object({ sharedAgents: v.boolean(), canManage: v.boolean(), userId: v.id("users") }),
  handler: async (ctx, args) => {
    const { member, user } = await requireTeamMember(ctx, args.teamId, args.sessionToken);
    const team = await ctx.db.get(args.teamId);
    return { sharedAgents: team?.sharedAgents === true, canManage: member.role === "owner" || member.role === "admin", userId: user._id };
  },
});

export const setSharedAgents = mutation({
  args: { sessionToken: v.string(), teamId: v.id("teams"), enabled: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireTeamAdmin(ctx, args.teamId, args.sessionToken);
    await ctx.db.patch(args.teamId, { sharedAgents: args.enabled, updatedAt: Date.now() });
    return null;
  },
});

export const listForTeam = query({
  args: { sessionToken: v.string(), teamId: v.id("teams"), includeArchived: v.optional(v.boolean()) },
  returns: v.array(agentView),
  handler: async (ctx, args) => {
    const { user } = await requireTeamMember(ctx, args.teamId, args.sessionToken);
    const rows = await ctx.db.query("workspaceAgents").withIndex("by_teamId", (q) => q.eq("teamId", args.teamId)).take(1_000);
    const out = [];
    for (const agent of rows) {
      if (!agent.kind || (agent.archivedAt !== undefined && !args.includeArchived)) continue;
      const access = await agentAccess(ctx, agent, user);
      if (access) out.push(await view(ctx, agent, access));
    }
    return out;
  },
});

export const get = query({
  args: { sessionToken: v.string(), agentId: v.id("workspaceAgents") },
  returns: agentView,
  handler: async (ctx, args) => {
    const { agent, access } = await requireAgent(ctx, args.agentId, args.sessionToken);
    return view(ctx, agent, access);
  },
});

async function insertAgent(ctx: MutationCtx, input: {
  teamId: Id<"teams">; projectId?: Id<"projects">; kind: "head" | "chief" | "agent"; roleKey: string; userId: Id<"users">;
  mascotExpression?: string; mascotBody?: string; modelIntent?: Doc<"workspaceAgents">["modelIntent"];
} & ReturnType<typeof cleanDefinition>) {
  const now = Date.now();
  const color = input.color || "green";
  return ctx.db.insert("workspaceAgents", {
    teamId: input.teamId, createdBy: input.userId, name: input.name ?? input.roleKey, avatarSeed: input.roleKey, avatarColor: color, instructions: "",
    engine: input.modelIntent?.provider ?? "", model: input.modelIntent?.model ?? "", effort: input.modelIntent?.effort ?? "",
    skills: [], approvalMode: "ask", destructiveMode: "ask", disabled: false, createdAt: now, updatedAt: now,
    kind: input.kind, ...(input.projectId ? { projectId: input.projectId } : {}), roleKey: input.roleKey,
    title: input.title ?? "", description: input.description ?? "", soul: input.soul ?? "", soulVersion: 1, color,
    ...(input.mascotExpression ? { mascotExpression: input.mascotExpression.slice(0, 64) } : {}),
    ...(input.mascotBody ? { mascotBody: input.mascotBody.slice(0, 64) } : {}),
    ...(input.look ? { look: input.look } : {}), ...(input.modelIntent ? { modelIntent: input.modelIntent } : {}),
    ...(input.approvalCeiling ? { approvalCeiling: input.approvalCeiling } : {}), updatedBy: input.userId,
  });
}

/** Publishes a project's (or, without a project, the workspace head's) team once: roles that already exist keep their definitions. */
export const publishProjectTeam = mutation({
  args: {
    sessionToken: v.string(), teamId: v.id("teams"), projectId: v.optional(v.id("projects")),
    agents: v.array(v.object({ roleKey: v.string(), kind: agentKind, ...definition })),
  },
  returns: v.array(v.object({ roleKey: v.string(), agentId: v.id("workspaceAgents"), created: v.boolean() })),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.sessionToken);
    await requireSharedAgents(ctx, args.teamId);
    const membership = await requireTeamMember(ctx, args.teamId, args.sessionToken);
    if (membership.member.role === "viewer") throw new Error("Edit role required");
    if (args.agents.length > TEAM_MAX) throw new Error(`A team publishes at most ${TEAM_MAX} agents`);
    const keys = new Set<string>();
    for (const agent of args.agents) {
      if (!ROLE_KEY.test(agent.roleKey)) throw new Error(`Invalid role key: ${agent.roleKey}`);
      if (keys.has(agent.roleKey)) throw new Error(`Duplicate role key: ${agent.roleKey}`);
      keys.add(agent.roleKey);
      if (args.projectId ? agent.kind === "head" : agent.kind !== "head") throw new Error("A workspace head publishes without a project; a project team without a head");
    }
    let existing: Doc<"workspaceAgents">[];
    if (args.projectId) {
      const project = await ctx.db.get(args.projectId);
      if (!project || project.teamId !== args.teamId) throw new Error("Project not found");
      const member = await projectMember(ctx, project, user);
      if (!member || member.role === "viewer") throw new Error("No edit access to this project");
      existing = await ctx.db.query("workspaceAgents").withIndex("by_projectId", (q) => q.eq("projectId", args.projectId)).take(500);
    } else {
      existing = (await ctx.db.query("workspaceAgents").withIndex("by_teamId", (q) => q.eq("teamId", args.teamId)).take(1_000))
        .filter((agent) => agent.kind === "head");
    }
    const byRole = new Map(existing.filter((agent) => agent.archivedAt === undefined && agent.roleKey).map((agent) => [agent.roleKey!, agent]));
    const out = [];
    for (const input of args.agents) {
      const found = byRole.get(input.roleKey);
      if (found) {
        out.push({ roleKey: input.roleKey, agentId: found._id, created: false });
        continue;
      }
      const agentId = await insertAgent(ctx, {
        ...cleanDefinition(input), teamId: args.teamId, projectId: args.projectId, kind: input.kind, roleKey: input.roleKey, userId: user._id,
        mascotExpression: input.mascotExpression, mascotBody: input.mascotBody, modelIntent: input.modelIntent,
      });
      if (args.projectId) {
        await ctx.db.insert("projectAgents", {
          teamId: args.teamId, projectId: args.projectId, agentId, role: input.kind === "chief" ? "chief" : "sub", permissions: [],
        });
      }
      out.push({ roleKey: input.roleKey, agentId, created: true });
    }
    return out;
  },
});

/** Edits a shared definition. With baseVersion, a stale edit is refused instead of overwriting someone else's change. */
export const update = mutation({
  args: {
    sessionToken: v.string(), agentId: v.id("workspaceAgents"), baseVersion: v.optional(v.number()),
    patch: v.object({
      name: v.optional(v.string()), title: v.optional(v.string()), description: v.optional(v.string()), soul: v.optional(v.string()),
      color: v.optional(v.string()), mascotExpression: v.optional(v.string()), mascotBody: v.optional(v.string()),
      look: v.optional(avatarLook), modelIntent: v.optional(modelIntent), approvalCeiling: v.optional(v.string()),
    }),
  },
  returns: v.object({ soulVersion: v.number() }),
  handler: async (ctx, args) => {
    const { agent, access } = await requireAgent(ctx, args.agentId, args.sessionToken);
    if (!access.canEdit) throw new Error("Only the creator or an admin can edit this agent");
    if (agent.archivedAt !== undefined) throw new Error("This agent is archived");
    const version = agent.soulVersion ?? 1;
    if (args.baseVersion !== undefined && args.baseVersion !== version) throw new Error("Someone else changed this agent; sync and try again");
    const next: Partial<Doc<"workspaceAgents">> = cleanDefinition(args.patch);
    if (args.patch.mascotExpression !== undefined) next.mascotExpression = args.patch.mascotExpression.slice(0, 64);
    if (args.patch.mascotBody !== undefined) next.mascotBody = args.patch.mascotBody.slice(0, 64);
    if (args.patch.modelIntent) next.modelIntent = args.patch.modelIntent;
    if (next.color) next.avatarColor = next.color;
    const changed = Object.entries(next).some(([key, value]) => JSON.stringify(agent[key as keyof typeof agent]) !== JSON.stringify(value));
    if (!changed) return { soulVersion: version };
    await ctx.db.patch(agent._id, { ...next, soulVersion: version + 1, updatedBy: access.user._id, updatedAt: Date.now() });
    return { soulVersion: version + 1 };
  },
});

export const avatarUploadUrl = mutation({
  args: { sessionToken: v.string(), agentId: v.id("workspaceAgents") },
  returns: v.string(),
  handler: async (ctx, args) => {
    const { access } = await requireAgent(ctx, args.agentId, args.sessionToken);
    if (!access.canEdit) throw new Error("Only the creator or an admin can edit this agent");
    return issueUpload(ctx, args.sessionToken, { kind: "agent", agentId: args.agentId });
  },
});

export const setAvatar = mutation({
  args: { sessionToken: v.string(), agentId: v.id("workspaceAgents"), storageId: v.union(v.id("_storage"), v.null()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { agent, access } = await requireAgent(ctx, args.agentId, args.sessionToken);
    if (!access.canEdit) throw new Error("Only the creator or an admin can edit this agent");
    if (args.storageId) {
      const meta = await storageMetadata(ctx, args.storageId);
      if (!meta || meta.size > 5 * 1024 * 1024 || !meta.contentType?.startsWith("image/")) throw new Error("Upload an image under 5 MB");
      await admitStorageReference(ctx, args.storageId, access.user, agent.projectId ? { kind: "project", projectId: agent.projectId } : { kind: "workspace", teamId: agent.teamId });
    }
    await ctx.db.patch(agent._id, {
      avatarStorageId: args.storageId ?? undefined, soulVersion: (agent.soulVersion ?? 1) + 1, updatedBy: access.user._id, updatedAt: Date.now(),
    });
    return null;
  },
});

export const archive = mutation({
  args: { sessionToken: v.string(), agentId: v.id("workspaceAgents") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { agent, access } = await requireAgent(ctx, args.agentId, args.sessionToken);
    if (!access.canEdit) throw new Error("Only the creator or an admin can archive this agent");
    if (agent.archivedAt === undefined) await ctx.db.patch(agent._id, { archivedAt: Date.now(), updatedBy: access.user._id, updatedAt: Date.now() });
    return null;
  },
});

/** A member's desktop announces what it can run, never how: engine kinds, model ids and computer names only. */
export const publishHost = mutation({
  args: {
    sessionToken: v.string(), teamId: v.id("teams"), name: v.string(),
    engines: v.array(v.string()), models: v.array(v.string()), computers: v.array(v.string()),
    /** "server": an always-on Origin server (a cloud machine or SSH box) rather than someone's desktop. */
    kind: v.optional(v.union(v.literal("local"), v.literal("server"))),
  },
  returns: v.id("agentHosts"),
  handler: async (ctx, args) => {
    const { member, user } = await requireTeamMember(ctx, args.teamId, args.sessionToken);
    await requireSharedAgents(ctx, args.teamId);
    const name = clipped(args.name, 80, "Name") || "Desktop";
    const list = (values: string[]) => [...new Set(values.map((value) => value.trim().slice(0, 120)).filter(Boolean))].slice(0, 100);
    const capabilities = { engines: list(args.engines), models: list(args.models), computers: list(args.computers), capacity: 1 };
    const now = Date.now();
    const hosts = await ctx.db.query("agentHosts").withIndex("by_teamId", (q) => q.eq("teamId", args.teamId)).take(500);
    const kind = args.kind ?? "local";
    const mine = hosts.find((host) => host.ownerUserId === user._id && host.name === name && host.kind === kind);
    if (mine) {
      await ctx.db.patch(mine._id, { capabilities, online: true, heartbeatAt: now });
      return mine._id;
    }
    return ctx.db.insert("agentHosts", {
      teamId: args.teamId, ownerUserId: user._id, ownerMembershipId: member._id, name, kind, shared: false, online: true, revoked: false,
      heartbeatAt: now, capabilities, activeRuns: 0, createdAt: now,
    });
  },
});
