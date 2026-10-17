import type { IncomingMessage } from "node:http";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { defaultOriginCloudFile, readOriginCloud } from "./origin-cloud.ts";
import { requestOrigin } from "./request-auth.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";

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

export interface InviteMail {
  to: string;
  teamName: string;
  inviterName: string;
  link: string;
}

export type SendInviteMail = (mail: InviteMail) => Promise<boolean>;

/** Sends through Resend when ORIGIN_RESEND_API_KEY is set; returns false when mail is not configured or delivery failed. */
export function resendInviteMail(fetchImpl: typeof fetch = fetch, env: NodeJS.ProcessEnv = process.env): SendInviteMail {
  return async ({ to, teamName, inviterName, link }) => {
    const key = env.ORIGIN_RESEND_API_KEY?.trim();
    if (!key) return false;
    try {
      const response = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({
          from: env.ORIGIN_INVITE_FROM?.trim() || "Origin <onboarding@resend.dev>",
          to,
          subject: `Join ${teamName} on Origin`,
          text: `${inviterName} invited you to ${teamName}.\n\nJoin the workspace: ${link}\n\nThis invitation expires in 7 days.`,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES = new Set(["admin", "member", "viewer"]);
const ID = /^[a-z0-9]{1,64}$/;

export interface OriginInviteRouteDeps {
  publicUrl(): string | null;
  convexUrl?: () => string | null;
  connect?: (url: string) => OriginConvex;
  sendMail?: SendInviteMail;
}

export function createOriginInviteRoutes(deps: OriginInviteRouteDeps): RouteHandler {
  const convexUrl = deps.convexUrl ?? (() => configuredConvexUrl());
  const connect = deps.connect ?? convexClient;
  const sendMail = deps.sendMail ?? resendInviteMail();
  return async ({ req, res, path, method, json, readBody }) => {
    if (path === "/api/origin/app-address" && method === "GET") {
      return json(res, 200, { origin: deps.publicUrl()?.replace(/\/+$/, "") || null });
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
    const url = convexUrl();
    if (!url) return json(res, 409, { error: "This server is not connected to Origin. Sign in to Origin in the app first." });
    const base = appAddress(req, deps.publicUrl);
    if (!base) return json(res, 500, { error: "This server has no address to put in an invitation link" });
    const client = connect(url);
    let invite: { token: string; expiresAt: number; teamName: string };
    let inviter = "";
    try {
      invite = await client.mutation("workspaces:createInvite", { sessionToken, teamId, role, ...(projectId ? { projectId } : {}), ...(email ? { email } : {}) }) as typeof invite;
      if (email) {
        const me = await client.query("auth:me", { sessionToken }) as { name?: string; email?: string } | null;
        inviter = me?.name || me?.email || "";
      }
    } catch (error) {
      return json(res, 400, { error: originErrorMessage(error, "Origin could not create the invitation") });
    }
    const link = `${base}/join/${invite.token}`;
    const sent = email ? await sendMail({ to: email, teamName: invite.teamName, inviterName: inviter || "A teammate", link }) : false;
    return json(res, 200, { token: invite.token, expiresAt: invite.expiresAt, inviteLink: link, sent });
  };
}
