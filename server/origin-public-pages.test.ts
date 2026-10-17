import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import type { OriginConvex } from "./origin-invites.ts";
import { convexSiteUrl, createOriginPublicRoutes, integrationFeedback, WindowLimiter, type FeedbackSubmit } from "./origin-public-pages.ts";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

const TOKEN = "b".repeat(64);
const SLUG = "c".repeat(32);

type Call = { name: string; args: Record<string, unknown> };

function fakeConvex(answers: Record<string, unknown>) {
  const calls: Call[] = [];
  const answer = async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    const value = answers[name];
    if (value instanceof Error) throw value;
    return typeof value === "function" ? (value as (a: Record<string, unknown>) => unknown)(args) : value ?? null;
  };
  const client: OriginConvex = { query: answer, mutation: answer, action: answer };
  return { client, calls };
}

const ANSWERS = {
  "workspaces:invitePreview": ({ token }: Record<string, unknown>) => (token === TOKEN ? { name: "GGs <script>", role: "member" } : null),
  "feedback:publicPortal": ({ slug }: Record<string, unknown>) => (slug === SLUG ? { title: "Kai feedback", description: "Tell us" } : null),
  "auth:login": { sessionToken: "sess-login" },
  "auth:signup": { sessionToken: "sess-signup" },
  "auth:me": ({ sessionToken }: Record<string, unknown>) => (sessionToken === "sess-old" ? { email: "old@x.dev" } : null),
  "workspaces:acceptInvite": { slug: "ggs" },
};

async function start(options: { convexUrl?: string | null; submit?: FeedbackSubmit | null; feedbackLimit?: number; answers?: Record<string, unknown> } = {}) {
  const fake = fakeConvex(options.answers ?? ANSWERS);
  const submitted: unknown[] = [];
  const handle = createOriginPublicRoutes({
    publicUrl: () => null,
    convexUrl: () => (options.convexUrl === undefined ? "http://convex.test" : options.convexUrl),
    connect: () => fake.client,
    submitFeedback: options.submit === undefined ? async (args) => { submitted.push(args); } : options.submit,
    feedbackLimiter: new WindowLimiter(options.feedbackLimit ?? 5, 3_600_000),
  });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!await handle({ req, res, path: url.pathname, method: req.method ?? "GET" })) {
      res.writeHead(404);
      res.end("next");
    }
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = async (path: string, body: unknown, origin: string | null = base) => {
    const response = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: typeof body === "string" ? body : JSON.stringify(body) });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  };
  return { base, post, calls: fake.calls, submitted };
}

describe("public invitation page", () => {
  it("renders the invitation with escaped names and strict headers", async () => {
    const app = await start();
    const response = await fetch(`${app.base}/join/${TOKEN}`);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain("Join GGs &lt;script&gt;");
    expect(html).not.toContain("GGs <script>");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("says an unknown or malformed invitation is unavailable", async () => {
    const app = await start();
    expect((await fetch(`${app.base}/join/${"d".repeat(64)}`)).status).toBe(404);
    expect((await fetch(`${app.base}/join/bad%20token`)).status).toBe(404);
  });

  it("explains when the app is not connected to Origin", async () => {
    const app = await start({ convexUrl: null });
    expect((await fetch(`${app.base}/join/${TOKEN}`)).status).toBe(503);
  });

  it("signs in, accepts and hands the session to the app", async () => {
    const app = await start();
    const result = await app.post(`/api/origin/public/join/${TOKEN}`, { mode: "signin", email: "a@x.dev", password: "pw" });
    expect(result).toEqual({ status: 200, body: { sessionToken: "sess-login", url: "http://convex.test", slug: "ggs" } });
    expect(app.calls.map((call) => call.name)).toEqual(["auth:login", "workspaces:acceptInvite"]);
    expect(app.calls[1].args).toEqual({ sessionToken: "sess-login", token: TOKEN });
  });

  it("creates the account against the invitation", async () => {
    const app = await start();
    const result = await app.post(`/api/origin/public/join/${TOKEN}`, { mode: "signup", email: "n@x.dev", password: "long-enough-pw", name: "New" });
    expect(result.body.sessionToken).toBe("sess-signup");
    expect(app.calls[0]).toEqual({ name: "auth:signup", args: { email: "n@x.dev", password: "long-enough-pw", name: "New", inviteToken: TOKEN } });
  });

  it("joins with a session the browser already holds, and rejects a stale one", async () => {
    const app = await start();
    expect((await app.post(`/api/origin/public/join/${TOKEN}`, { mode: "me", sessionToken: "sess-old" })).body).toEqual({ email: "old@x.dev" });
    expect((await app.post(`/api/origin/public/join/${TOKEN}`, { mode: "session", sessionToken: "sess-old" })).body.slug).toBe("ggs");
    expect((await app.post(`/api/origin/public/join/${TOKEN}`, { mode: "session", sessionToken: "gone" })).status).toBe(401);
  });

  it("passes Origin's reason through", async () => {
    const app = await start({ answers: { ...ANSWERS, "auth:login": new Error("Server Error\nUncaught Error: Invalid email or password\n at x") } });
    expect(await app.post(`/api/origin/public/join/${TOKEN}`, { mode: "signin", email: "a@x.dev", password: "no" })).toEqual({ status: 400, body: { error: "Invalid email or password" } });
  });

  it("refuses cross-site posts", async () => {
    const app = await start();
    expect((await app.post(`/api/origin/public/join/${TOKEN}`, { mode: "signin", email: "a", password: "b" }, "https://evil.example")).status).toBe(403);
    expect((await app.post(`/api/origin/public/join/${TOKEN}`, { mode: "signin", email: "a", password: "b" }, null)).status).toBe(403);
    expect(app.calls).toEqual([]);
  });
});

describe("public feedback form", () => {
  const entry = { slug: SLUG, kind: "bug", title: "Broken", body: "It broke" };

  it("renders an enabled portal", async () => {
    const app = await start();
    const response = await fetch(`${app.base}/feedback/${SLUG}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Kai feedback");
    expect((await fetch(`${app.base}/feedback/${"e".repeat(32)}`)).status).toBe(404);
    expect((await fetch(`${app.base}/feedback/not-a-slug`)).status).toBe(404);
  });

  it("is unavailable when feedback is not configured", async () => {
    const app = await start({ submit: null });
    expect((await fetch(`${app.base}/feedback/${SLUG}`)).status).toBe(503);
    expect((await app.post("/api/origin/public/feedback", entry)).status).toBe(503);
  });

  it("submits valid feedback", async () => {
    const app = await start();
    expect(await app.post("/api/origin/public/feedback", entry)).toEqual({ status: 200, body: { ok: true } });
    expect(app.submitted).toEqual([{ slug: SLUG, title: "Broken", body: "It broke", kind: "bug" }]);
  });

  it("swallows honeypot submissions", async () => {
    const app = await start();
    expect((await app.post("/api/origin/public/feedback", { ...entry, website: "spam.example" })).status).toBe(200);
    expect(app.submitted).toEqual([]);
  });

  it("rejects malformed, oversized and cross-site feedback", async () => {
    const app = await start();
    expect((await app.post("/api/origin/public/feedback", { ...entry, kind: "rant" })).status).toBe(400);
    expect((await app.post("/api/origin/public/feedback", { ...entry, slug: "x" })).status).toBe(400);
    expect((await app.post("/api/origin/public/feedback", "null")).status).toBe(400);
    expect((await app.post("/api/origin/public/feedback", { ...entry, body: "x".repeat(13_000) })).status).toBe(413);
    expect((await app.post("/api/origin/public/feedback", entry, "https://evil.example")).status).toBe(403);
    expect(app.submitted).toEqual([]);
  });

  it("limits submissions per address", async () => {
    const app = await start({ feedbackLimit: 2 });
    expect((await app.post("/api/origin/public/feedback", entry)).status).toBe(200);
    expect((await app.post("/api/origin/public/feedback", entry)).status).toBe(200);
    expect((await app.post("/api/origin/public/feedback", entry)).status).toBe(429);
    expect(app.submitted).toHaveLength(2);
  });

  it("leaves other paths to the rest of the server", async () => {
    const app = await start();
    expect(await (await fetch(`${app.base}/join`)).text()).toBe("next");
    expect(await (await fetch(`${app.base}/feedback/${SLUG}/x`)).text()).toBe("next");
  });
});

describe("WindowLimiter", () => {
  it("resets after the window", () => {
    let now = 0;
    const limiter = new WindowLimiter(1, 1_000, () => now);
    expect(limiter.allow("k")).toBe(true);
    expect(limiter.allow("k")).toBe(false);
    now = 1_000;
    expect(limiter.allow("k")).toBe(true);
  });

  it("stays bounded", () => {
    const limiter = new WindowLimiter(5, 1_000, () => 0, 2);
    expect(limiter.allow("a")).toBe(true);
    expect(limiter.allow("b")).toBe(true);
    expect(limiter.allow("c")).toBe(false);
  });
});

describe("integrationFeedback", () => {
  it("is off without a strong secret", () => {
    expect(integrationFeedback({ convexUrl: () => "http://127.0.0.1:3210", env: { ORIGIN_INTEGRATION_SECRET: "short" } })).toBeNull();
  });

  it("signs the feedback for the deployment's site host", async () => {
    const requests: { url: string; init: RequestInit }[] = [];
    const submit = integrationFeedback({
      convexUrl: () => "http://127.0.0.1:3210",
      env: { ORIGIN_INTEGRATION_SECRET: "s".repeat(64) },
      fetchImpl: async (url, init) => { requests.push({ url: String(url), init: init! }); return new Response("null"); },
    })!;
    await submit({ slug: SLUG, title: "T", body: "B", kind: "idea" });
    expect(requests[0].url).toBe("http://127.0.0.1:3211/integrations");
    const sent = JSON.parse(String(requests[0].init.body));
    expect(sent).toMatchObject({ operation: "feedback", args: { slug: SLUG, title: "T", body: "B", kind: "idea" } });
    expect((requests[0].init.headers as Record<string, string>)["x-origin-signature"]).toMatch(/^[a-f0-9]{64}$/);
  });

  it("maps cloud deployments to their site host", () => {
    expect(convexSiteUrl("https://happy-cat-123.convex.cloud")).toBe("https://happy-cat-123.convex.site");
    expect(convexSiteUrl("https://convex.example.org")).toBeNull();
  });
});
