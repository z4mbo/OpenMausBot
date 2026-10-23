import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { requireAgent, requireSharedAgents } from "./lib/agentAccess";
import { hostOnline } from "./lib/agentRunner";
import { requireTeamMember } from "./lib/permissions";

const hostView = v.object({
  _id: v.id("agentHosts"), name: v.string(), kind: v.string(), ownerUserId: v.id("users"), ownerName: v.string(),
  mine: v.boolean(), shared: v.boolean(), online: v.boolean(), models: v.array(v.string()),
});

async function view(ctx: QueryCtx, host: Doc<"agentHosts">, me: Doc<"users">["_id"], now: number) {
  const owner = await ctx.db.get(host.ownerUserId);
  return {
    _id: host._id, name: host.name, kind: host.kind, ownerUserId: host.ownerUserId, ownerName: owner?.name || owner?.email || "Someone",
    mine: host.ownerUserId === me, shared: host.shared, online: hostOnline(host, now), models: host.capabilities.models.slice(0, 20),
  };
}

/** The computers and servers that can run this workspace's agents: every member's own, and others' that they shared. */
export const list = query({
  args: { sessionToken: v.string(), teamId: v.id("teams") },
  returns: v.array(hostView),
  handler: async (ctx, args) => {
    const { user } = await requireTeamMember(ctx, args.teamId, args.sessionToken);
    const now = Date.now();
    const hosts = await ctx.db.query("agentHosts").withIndex("by_teamId", (q) => q.eq("teamId", args.teamId)).take(200);
    const out = [];
    for (const host of hosts) {
      if (host.revoked || (host.ownerUserId !== user._id && !host.shared)) continue;
      out.push(await view(ctx, host, user._id, now));
    }
    return out.sort((a, b) => Number(b.mine) - Number(a.mine) || Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
  },
});

/** Where an agent runs: the sender's own app (null), or one shared computer or server for everyone. */
export const runsOn = query({
  args: { sessionToken: v.string(), agentId: v.id("workspaceAgents") },
  returns: v.object({ host: v.union(hostView, v.null()), canEdit: v.boolean() }),
  handler: async (ctx, args) => {
    const { agent, access } = await requireAgent(ctx, args.agentId, args.sessionToken);
    const host = agent.defaultHostId ? await ctx.db.get(agent.defaultHostId) : null;
    return { host: host && !host.revoked ? await view(ctx, host, access.user._id, Date.now()) : null, canEdit: access.canEdit };
  },
});

/** Picks where an agent runs. Choosing your own computer shares it for this; someone else's must already be shared. */
export const setRunsOn = mutation({
  args: { sessionToken: v.string(), agentId: v.id("workspaceAgents"), hostId: v.union(v.id("agentHosts"), v.null()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { agent, access } = await requireAgent(ctx, args.agentId, args.sessionToken);
    await requireSharedAgents(ctx, agent.teamId);
    if (!access.canEdit) throw new Error("Only people who can edit this agent can choose where it runs");
    const now = Date.now();
    if (args.hostId === null) {
      await ctx.db.patch(agent._id, { defaultHostId: undefined, updatedBy: access.user._id, updatedAt: now });
      return null;
    }
    const host = await ctx.db.get(args.hostId);
    if (!host || host.teamId !== agent.teamId || host.revoked) throw new Error("That computer is not in this workspace");
    const mine = host.ownerUserId === access.user._id;
    if (!mine && !host.shared) throw new Error("Its owner has not offered that computer for agents yet");
    if (mine && !host.shared) await ctx.db.patch(host._id, { shared: true });
    await ctx.db.patch(agent._id, { defaultHostId: host._id, updatedBy: access.user._id, updatedAt: now });
    return null;
  },
});

/** The owner offers or withdraws their computer; withdrawing sends its agents back to running on each sender's app. */
export const share = mutation({
  args: { sessionToken: v.string(), hostId: v.id("agentHosts"), shared: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const host = await ctx.db.get(args.hostId);
    if (!host) throw new Error("Computer not found");
    const { user } = await requireTeamMember(ctx, host.teamId, args.sessionToken);
    if (host.ownerUserId !== user._id) throw new Error("Only its owner can share this computer");
    await ctx.db.patch(host._id, { shared: args.shared });
    if (!args.shared) {
      for (const agent of await ctx.db.query("workspaceAgents").withIndex("by_teamId", (q) => q.eq("teamId", host.teamId)).take(500)) {
        if (agent.defaultHostId === host._id) await ctx.db.patch(agent._id, { defaultHostId: undefined, updatedAt: Date.now() });
      }
    }
    return null;
  },
});
