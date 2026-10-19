import type { IncomingMessage } from "node:http";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { defaultOriginCloudFile, readOriginCloud } from "./origin-cloud.ts";
import { requestOrigin } from "./request-auth.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";
import { normalizeOriginBackendUrl, resolveOriginSiteAddress } from "../shared/origin-site-address.ts";

type Args = Record<string, unknown>;

export interface OriginConvex {
  query(name: string, args: Args): Promise<unknown>;
  mutation(name: string, args: Args): Promise<unknown>;
  action(name: string, args: Args): Promise<unknown>;
}

export function convexClient(url: string): OriginConvex {
  const client = new ConvexHttpClient(url, { logger: false });
  return {
    query: (name, args) => client.query(makeFunctionReference<"query">(name), args),
    mutation: (name, args) => client.mutation(makeFunctionReference<"mutation">(name), args),
    action: (name, args) => client.action(makeFunctionReference<"action">(name), args),
  };
}

/** The Convex deployment this server signs people in against: the one its Origin connection uses, else OMB_ORIGIN_CONVEX_URL. */
export function configuredConvexUrl(file = defaultOriginCloudFile()): string | null {
  return readOriginCloud(file).url ?? (process.env.OMB_ORIGIN_CONVEX_URL?.trim().replace(/\/+$/, "") || null);
}

/** The person-readable reason inside a Convex error, or a generic one when the error carries none. */
export function originErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error);
  const uncaught = /Uncaught Error: ([^\n]+)/.exec(message);
  return uncaught ? uncaught[1].trim().slice(0, 300) : fallback;
}

/** The address people outside this machine reach the app on: the configured public URL, else the address this request used. */
export function appAddress(req: IncomingMessage, publicUrl: () => string | null): string | null {
  return publicUrl()?.replace(/\/+$/, "") || requestOrigin(req);
}

type InviteAddress = { origin: string | null; convexUrl: string | null; centralMail: boolean };

async function invitationAddress(client: OriginConvex, convexUrl: string): Promise<InviteAddress> {
  try {
    const result = await client.query("workspaces:inviteAddress", {}) as { origin?: unknown; convexUrl?: unknown } | null;
    if (typeof result?.convexUrl !== "string" || normalizeOriginBackendUrl(result.convexUrl) !== convexUrl || typeof result.origin !== "string") return { origin: null, convexUrl, centralMail: false };
    const origin = resolveOriginSiteAddress({ convexUrl, siteUrl: result.origin });
    if (!origin || origin !== normalizeOriginBackendUrl(result.origin)) return { origin: null, convexUrl, centralMail: false };
    return { origin, convexUrl, centralMail: true };
  } catch {
    return { origin: resolveOriginSiteAddress({ convexUrl }), convexUrl, centralMail: false };
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES = new Set(["admin", "member", "viewer"]);
const ID = /^[a-z0-9]{1,64}$/;

export interface OriginInviteRouteDeps {
  publicUrl(): string | null;
  convexUrl?: () => string | null;
  connect?: (url: string) => OriginConvex;
}

export function createOriginInviteRoutes(deps: OriginInviteRouteDeps): RouteHandler {
  const convexUrl = deps.convexUrl ?? (() => configuredConvexUrl());
  const connect = deps.connect ?? convexClient;
  return async ({ req, res, path, method, json, readBody }) => {
    if (path === "/api/origin/app-address" && method === "GET") {
      return json(res, 200, { origin: deps.publicUrl()?.replace(/\/+$/, "") || null });
    }
    if (path === "/api/origin/invite-address" && method === "GET") {
      const url = normalizeOriginBackendUrl(convexUrl());
      const address = url ? await invitationAddress(connect(url), url) : { origin: null, convexUrl: null };
      return json(res, 200, { origin: address.origin, convexUrl: address.convexUrl });
    }
    if (path !== "/api/origin/invites" || method !== "POST") return PASS;
    const body = await readBody(req, 16_000).catch(() => null) as Args | null;
    if (!body || typeof body !== "object") return json(res, 400, { error: "body must be a JSON object" });
    const sessionToken = typeof body.sessionToken === "string" ? body.sessionToken.trim() : "";
    const teamId = typeof body.teamId === "string" ? body.teamId : "";
    const projectId = typeof body.projectId === "string" && body.projectId ? body.projectId : undefined;
    const role = typeof body.role === "string" ? body.role : "member";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!sessionToken || sessionToken.length > 1_024) return json(res, 401, { error: "Sign in to Origin first" });
    if (!ID.test(teamId) || (projectId && !ID.test(projectId))) return json(res, 400, { error: "teamId must be an Origin workspace id" });
    if (!ROLES.has(role)) return json(res, 400, { error: "role must be admin, member or viewer" });
    if (email && (!EMAIL.test(email) || email.length > 254)) return json(res, 400, { error: "Enter a valid email address" });
    const url = normalizeOriginBackendUrl(convexUrl());
    if (!url) return json(res, 409, { error: "This server is not connected to Origin. Sign in to Origin in the app first." });
    if (body.convexUrl !== undefined && (typeof body.convexUrl !== "string" || normalizeOriginBackendUrl(body.convexUrl) !== url)) return json(res, 409, { error: "Origin's connection changed. Refresh the invitation and try again." });
    const client = connect(url);
    const address = await invitationAddress(client, url);
    if (!address.origin) return json(res, 409, { error: "The invitation website is not configured for this Origin backend" });
    if (email && !address.centralMail) return json(res, 503, { error: "Update the Origin backend before sending invitation email" });
    try {
      const args = { sessionToken, teamId, role, ...(projectId ? { projectId } : {}) };
      if (email) {
        const result = await client.action("workspaces:sendEmailInvite", { ...args, email }) as { token: string; expiresAt: number; inviteLink: string; sent: boolean; deliveryStatus: string };
        if (!result || !/^[a-f0-9]{64}$/.test(result.token) || !Number.isFinite(result.expiresAt) || result.inviteLink !== `${address.origin}/join/${result.token}` || !["not_configured", "failed", "accepted"].includes(result.deliveryStatus) || result.sent !== (result.deliveryStatus === "accepted")) return json(res, 502, { error: "Origin returned an invalid invitation response" });
        return json(res, 200, { token: result.token, expiresAt: result.expiresAt, inviteLink: result.inviteLink, sent: result.sent, deliveryStatus: result.deliveryStatus });
      }
      const invite = await client.mutation("workspaces:createInvite", args) as { token: string; expiresAt: number };
      return json(res, 200, { token: invite.token, expiresAt: invite.expiresAt, inviteLink: `${address.origin}/join/${invite.token}`, sent: false, deliveryStatus: "not_requested" });
    } catch (error) {
      return json(res, 400, { error: originErrorMessage(error, "Origin could not create the invitation") });
    }
  };
}
