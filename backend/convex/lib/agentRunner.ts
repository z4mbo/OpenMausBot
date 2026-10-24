import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { agentAccess } from "./agentAccess";

export { runnerOf } from "./agentAccess";

type Ctx = QueryCtx | MutationCtx;

/** A host that announced itself this recently is taken to be on; desktops announce every minute while signed in. */
export const HOST_ONLINE_MS = 3 * 60_000;

export const hostOnline = (host: Pick<Doc<"agentHosts">, "online" | "heartbeatAt" | "revoked">, now: number) =>
  !host.revoked && host.online && now - host.heartbeatAt <= HOST_ONLINE_MS;

export type Runner = { userId: Id<"users">; membershipId: Id<"teamMembers">; hostId: Id<"agentHosts">; hostName: string; hostKind: Doc<"agentHosts">["kind"]; ownerName: string };

/** Where the agent's runs go: its chosen host when that host is shared, on, and its owner may still use the agent; null runs on the sender's app. */
export async function chosenRunner(ctx: Ctx, agent: Doc<"workspaceAgents">, now: number): Promise<{ runner: Runner | null; unavailable?: string }> {
  if (!agent.defaultHostId) return { runner: null };
  const host = await ctx.db.get(agent.defaultHostId);
  if (!host || host.teamId !== agent.teamId || host.revoked || !host.shared) return { runner: null };
  const owner = await ctx.db.get(host.ownerUserId);
  const ownerName = owner?.name || owner?.email || "a teammate";
  if (!hostOnline(host, now)) return { runner: null, unavailable: `${ownerName}'s ${host.kind === "local" ? "computer" : "server"} (${host.name}) is offline` };
  const access = owner && owner.status === "active" ? await agentAccess(ctx, agent, owner) : null;
  if (!access?.canSend) return { runner: null, unavailable: `${ownerName} can no longer run ${agent.name}` };
  return { runner: { userId: host.ownerUserId, membershipId: access.membership._id, hostId: host._id, hostName: host.name, hostKind: host.kind, ownerName } };
}
