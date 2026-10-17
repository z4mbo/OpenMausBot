import { createHash, createHmac, randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { json, readBody } from "./harness/http.ts";
import { configuredConvexUrl, convexClient, originErrorMessage, type OriginConvex } from "./origin-invites.ts";
import { feedbackPage, joinPage, unavailablePage } from "./origin-public-html.ts";
import { requestOrigin, requestSource } from "./request-auth.ts";

export { createOriginInviteRoutes } from "./origin-invites.ts";

type Args = Record<string, unknown>;

export interface PublicRouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  path: string;
  method: string;
}

/** A fixed-window counter per key, bounded so a flood of new keys cannot grow it without limit. */
export class WindowLimiter {
  private readonly hits = new Map<string, { count: number; expires: number }>();
  private readonly maximum: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly maxKeys: number;

  constructor(maximum: number, windowMs: number, now: () => number = Date.now, maxKeys = 10_000) {
    this.maximum = maximum;
    this.windowMs = windowMs;
    this.now = now;
    this.maxKeys = maxKeys;
  }

  allow(key: string): boolean {
    const now = this.now();
    const current = this.hits.get(key);
    if (!current || current.expires <= now) {
      if (this.hits.size >= this.maxKeys) this.prune(now);
      if (this.hits.size >= this.maxKeys) return false;
      this.hits.set(key, { count: 1, expires: now + this.windowMs });
      return true;
    }
    current.count += 1;
    return current.count <= this.maximum;
  }

  private prune(now: number) {
    for (const [key, entry] of this.hits) if (entry.expires <= now) this.hits.delete(key);
  }
}

export type FeedbackSubmit = (args: { slug: string; title: string; body: string; kind: "bug" | "idea" }) => Promise<void>;

/** Convex HTTP actions live on the deployment's site host: `.convex.site` in the cloud, the next port on a local backend. */
export function convexSiteUrl(convexUrl: string): string | null {
  try {
    const url = new URL(convexUrl);
    if (url.hostname.endsWith(".convex.cloud")) url.hostname = url.hostname.replace(/\.convex\.cloud$/, ".convex.site");
    else if (url.port) url.port = String(Number(url.port) + 1);
    else return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Submits through the deployment's signed /integrations bridge; ORIGIN_INTEGRATION_SECRET must match the deployment's. */
export function integrationFeedback(options: { convexUrl(): string | null; env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch }): FeedbackSubmit | null {
  const env = options.env ?? process.env;
  const secret = env.ORIGIN_INTEGRATION_SECRET?.trim();
  if (!secret || secret.length < 32) return null;
  const fetchImpl = options.fetchImpl ?? fetch;
  return async (args) => {
    const convexUrl = options.convexUrl();
    const site = env.ORIGIN_CONVEX_SITE_URL?.trim().replace(/\/+$/, "") || (convexUrl ? convexSiteUrl(convexUrl) : null);
    if (!site) throw new Error("Origin is not connected");
    const body = JSON.stringify({ at: Date.now(), operation: "feedback", args });
    const signature = createHmac("sha256", secret).update(body).digest("hex");
    const response = await fetchImpl(`${site}/integrations`, {
      method: "POST",
      body,
      headers: { "content-type": "application/json", "x-origin-signature": signature },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Feedback bridge answered ${response.status}`);
  };
}

const PORTAL_SLUG = /^[a-f0-9]{32}$/;
const INVITE_TOKEN = /^[A-Za-z0-9]{16,128}$/;
const FEEDBACK_MAX_BYTES = 12_000;
const JOIN_MAX_BYTES = 8_000;
const JOIN_PATH = /^\/join\/([^/]+)$/;
const JOIN_API = /^\/api\/origin\/public\/join\/([^/]+)$/;
const FEEDBACK_PATH = /^\/feedback\/([^/]+)$/;
const FEEDBACK_API = "/api/origin/public/feedback";

export interface OriginPublicDeps {
  publicUrl(): string | null;
  convexUrl?: () => string | null;
  connect?: (url: string) => OriginConvex;
  submitFeedback?: FeedbackSubmit | null;
  feedbackLimiter?: WindowLimiter;
  joinLimiter?: WindowLimiter;
}

const text = (value: unknown, max: number) => (typeof value === "string" && value.length <= max ? value : null);

/** Unauthenticated: the invitation page and the public feedback form, plus the two JSON endpoints they post to. */
export function createOriginPublicRoutes(deps: OriginPublicDeps): (ctx: PublicRouteContext) => Promise<boolean> {
  const convexUrl = deps.convexUrl ?? (() => configuredConvexUrl());
  const connect = deps.connect ?? convexClient;
  const submitFeedback = deps.submitFeedback === undefined ? integrationFeedback({ convexUrl }) : deps.submitFeedback;
  const feedbackLimiter = deps.feedbackLimiter ?? new WindowLimiter(5, 3_600_000);
  const joinLimiter = deps.joinLimiter ?? new WindowLimiter(20, 900_000);
  const salt = randomBytes(32);
  const sourceKey = (req: IncomingMessage) => createHash("sha256").update(salt).update(requestSource(req)).digest("hex");

  /** Security: a cross-site page must not post here; the Origin header has to name this app. */
  const fromThisApp = (req: IncomingMessage) => {
    const origin = req.headers.origin?.trim().toLowerCase();
    if (!origin) return false;
    const allowed = [requestOrigin(req), deps.publicUrl()?.replace(/\/+$/, "").toLowerCase()];
    return allowed.includes(origin);
  };

  const html = (res: ServerResponse, status: number, page: { html: string; nonce: string }) => {
    res.writeHead(status, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-frame-options": "DENY",
      "x-robots-tag": "noindex, nofollow",
      "content-security-policy": `default-src 'none'; script-src 'nonce-${page.nonce}'; style-src 'nonce-${page.nonce}'; connect-src 'self'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
    });
    res.end(page.html);
  };

  const showJoin = async (res: ServerResponse, token: string) => {
    const url = convexUrl();
    if (!url) return html(res, 503, unavailablePage("Invitations are not available", "This app is not connected to Origin yet."));
    if (!INVITE_TOKEN.test(token)) return html(res, 404, unavailablePage("Invitation unavailable", "This link may have expired or been revoked."));
    let invite: { name: string; role: string; email?: string } | null;
    try {
      invite = await connect(url).query("workspaces:invitePreview", { token }) as typeof invite;
    } catch {
      return html(res, 502, unavailablePage("Origin did not answer", "Try this link again in a moment."));
    }
    if (!invite) return html(res, 404, unavailablePage("Invitation unavailable", "This link may have expired or been revoked."));
    return html(res, 200, joinPage({ token, name: invite.name, role: invite.role, email: invite.email ?? null }));
  };

  const join = async (req: IncomingMessage, res: ServerResponse, token: string) => {
    if (!fromThisApp(req)) return json(res, 403, { error: "Request rejected" });
    if (!joinLimiter.allow(sourceKey(req))) return json(res, 429, { error: "Too many attempts. Try again in a few minutes." });
    const url = convexUrl();
    if (!url) return json(res, 503, { error: "This app is not connected to Origin yet." });
    if (!INVITE_TOKEN.test(token)) return json(res, 404, { error: "This invitation has expired or was revoked" });
    const body = await readBody(req, JOIN_MAX_BYTES).catch(() => null) as Args | null;
    if (!body || typeof body !== "object") return json(res, 400, { error: "Invalid request" });
    const mode = body.mode;
    const email = text(body.email, 254)?.trim() ?? "";
    const password = text(body.password, 128) ?? "";
    const name = text(body.name, 100)?.trim() ?? "";
    const client = connect(url);
    try {
      let sessionToken: string;
      if (mode === "session" || mode === "me") {
        sessionToken = text(body.sessionToken, 1_024)?.trim() ?? "";
        const me = sessionToken ? await client.query("auth:me", { sessionToken }) as { email?: string } | null : null;
        if (!me?.email) return json(res, 401, { error: "Your Origin sign-in has expired" });
        if (mode === "me") return json(res, 200, { email: me.email });
      } else if (mode === "signin") {
        if (!email || !password) return json(res, 400, { error: "Enter your email and password" });
        sessionToken = (await client.action("auth:login", { email, password }) as { sessionToken: string }).sessionToken;
      } else if (mode === "signup") {
        if (!email || !password || !name) return json(res, 400, { error: "Enter your name, email and password" });
        sessionToken = (await client.action("auth:signup", { email, password, name, inviteToken: token }) as { sessionToken: string }).sessionToken;
      } else {
        return json(res, 400, { error: "Invalid request" });
      }
      const joined = await client.mutation("workspaces:acceptInvite", { sessionToken, token }) as { slug: string };
      return json(res, 200, { sessionToken, url, slug: joined.slug });
    } catch (error) {
      return json(res, 400, { error: originErrorMessage(error, "Origin could not complete this. Try again.") });
    }
  };

  const showFeedback = async (res: ServerResponse, slug: string) => {
    const url = convexUrl();
    if (!url || !submitFeedback) return html(res, 503, unavailablePage("This feedback form is unavailable", "Feedback is not set up on this app yet."));
    if (!PORTAL_SLUG.test(slug)) return html(res, 404, unavailablePage("This feedback form is unavailable", "Check the link you were given."));
    let portal: { title: string; description: string } | null;
    try {
      portal = await connect(url).query("feedback:publicPortal", { slug }) as typeof portal;
    } catch {
      return html(res, 502, unavailablePage("Origin did not answer", "Try again in a moment."));
    }
    if (!portal) return html(res, 404, unavailablePage("This feedback form is unavailable", "Check the link you were given."));
    return html(res, 200, feedbackPage({ slug, title: portal.title, description: portal.description }));
  };

  const feedback = async (req: IncomingMessage, res: ServerResponse) => {
    if (!fromThisApp(req)) return json(res, 403, { error: "Request rejected" });
    if (Number(req.headers["content-length"] || 0) > FEEDBACK_MAX_BYTES) return json(res, 413, { error: "Feedback is too long" });
    const body: unknown = await readBody(req, FEEDBACK_MAX_BYTES).catch((error: unknown) => error);
    if (body instanceof Error) {
      const tooLong = (body as { status?: number }).status === 413;
      return json(res, tooLong ? 413 : 400, { error: tooLong ? "Feedback is too long" : "Invalid feedback" });
    }
    if (!body || typeof body !== "object") return json(res, 400, { error: "Invalid feedback" });
    if (!submitFeedback) return json(res, 503, { error: "Feedback is not set up on this app yet." });
    if ((body as Args).website) return json(res, 200, { ok: true });
    const { slug, title, body: details, kind } = body as Args;
    if (typeof slug !== "string" || !PORTAL_SLUG.test(slug) || typeof title !== "string" || !title.trim() || title.length > 180
      || typeof details !== "string" || !details.trim() || details.length > 8_000 || (kind !== "bug" && kind !== "idea")) {
      return json(res, 400, { error: "Invalid feedback" });
    }
    if (!feedbackLimiter.allow(sourceKey(req))) return json(res, 429, { error: "Too many messages from your address. Try again later." });
    try {
      await submitFeedback({ slug, title, body: details, kind });
      return json(res, 200, { ok: true });
    } catch {
      return json(res, 400, { error: "Unable to send feedback. Check your message or try again later." });
    }
  };

  return async ({ req, res, path, method }) => {
    let match: RegExpExecArray | null;
    if (method === "GET" && (match = JOIN_PATH.exec(path))) { await showJoin(res, match[1]); return true; }
    if (method === "GET" && (match = FEEDBACK_PATH.exec(path))) { await showFeedback(res, match[1]); return true; }
    if (method === "POST" && (match = JOIN_API.exec(path))) { await join(req, res, match[1]); return true; }
    if (method === "POST" && path === FEEDBACK_API) { await feedback(req, res); return true; }
    return false;
  };
}
