// Loopback stand-ins for the Vercel, Cloudflare Pages and GitHub APIs Ship calls, so
// the Ship fixture deploys, rolls back and releases without reaching the network.
// A new deployment builds for BUILD_MS and then becomes ready and, for production,
// live; every request is recorded for the check.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

type Json = Record<string, unknown>;
type Deployment = { id: string; production: boolean; state: "BUILDING" | "READY" | "ERROR"; branch: string; sha: string; message: string; created: number; pr?: number };

const BUILD_MS = 6_000;
const minutes = (count: number) => Date.now() - count * 60_000;

export interface FakeShipProviders {
  origin: string;
  requests: { method: string; path: string; auth: string; body: unknown }[];
  close(): Promise<void>;
}

export async function startFakeShipProviders(): Promise<FakeShipProviders> {
  const requests: FakeShipProviders["requests"] = [];
  let counter = 0;
  const vercel: Deployment[] = [
    { id: "dpl_preview42", production: false, state: "READY", branch: "dark-mode", sha: "9f3c2a1", message: "Dark mode for the dashboard", created: minutes(18), pr: 42 },
    { id: "dpl_live", production: true, state: "READY", branch: "main", sha: "b71e004", message: "Pricing page copy", created: minutes(60 * 5) },
    { id: "dpl_prev", production: true, state: "READY", branch: "main", sha: "4a0d9e2", message: "Faster sign-up form", created: minutes(60 * 26) },
    { id: "dpl_failed", production: true, state: "ERROR", branch: "main", sha: "e11b7c3", message: "Upgrade the build tooling", created: minutes(60 * 30) },
  ];
  let vercelLive = "dpl_live";
  const cloudflare: Deployment[] = [
    { id: "cf-live", production: true, state: "READY", branch: "main", sha: "b71e004", message: "Pricing page copy", created: minutes(60 * 5) },
    { id: "cf-old", production: true, state: "READY", branch: "main", sha: "4a0d9e2", message: "Faster sign-up form", created: minutes(60 * 27) },
  ];
  let cloudflareLive = "cf-live";
  const runs: Deployment[] = [{ id: "7001", production: true, state: "READY", branch: "main", sha: "b71e004", message: "Release build", created: minutes(60 * 5) }];
  const releases: Json[] = [];

  const settle = (list: Deployment[], promote: (id: string) => void) => {
    for (const row of list) if (row.state === "BUILDING" && Date.now() - row.created > BUILD_MS) {
      row.state = "READY";
      if (row.production) promote(row.id);
    }
  };
  const build = (list: Deployment[], from: Partial<Deployment> & { production: boolean }) => {
    const row: Deployment = { id: `new${++counter}`, state: "BUILDING", branch: "main", sha: "c0ffee1", message: "Merge the dark mode work", created: Date.now(), ...from };
    list.unshift(row);
    return row;
  };

  const read = async (req: IncomingMessage) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    if (!raw) return undefined;
    if ((req.headers["content-type"] ?? "").includes("multipart/form-data")) return Object.fromEntries([...raw.matchAll(/name="([^"]+)"\r\n\r\n([^\r]*)/g)].map((match) => [match[1], match[2]]));
    try { return JSON.parse(raw) as unknown; } catch { return raw; }
  };
  const send = (res: ServerResponse, status: number, body?: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(body === undefined ? "" : JSON.stringify(body));
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const path = url.pathname;
    const body = await read(req);
    requests.push({ method: req.method ?? "GET", path: `${path}${url.search}`, auth: String(req.headers.authorization ?? ""), body });
    settle(vercel, (id) => { vercelLive = id; });
    settle(cloudflare, (id) => { cloudflareLive = id; });
    settle(runs, () => undefined);
    const get = req.method === "GET";

    if (path === "/vercel/v9/projects/launch-web" && get) return send(res, 200, { id: "prj_launch", name: "launch-web", targets: { production: { id: vercelLive } } });
    if (path === "/vercel/v6/deployments" && get) {
      return send(res, 200, {
        deployments: vercel.map((row) => ({
          uid: row.id, url: `${row.id.replace("_", "-")}.vercel.app`, created: row.created, readyState: row.state, target: row.production ? "production" : null,
          inspectorUrl: `vercel.com/acme/launch-web/${row.id}`, meta: { githubCommitRef: row.branch, githubCommitSha: row.sha, githubCommitMessage: row.message, ...(row.pr ? { githubPrId: String(row.pr) } : {}) },
        })),
      });
    }
    if (path === "/vercel/v13/deployments" && req.method === "POST") {
      const input = body as Json;
      const from = typeof input.deploymentId === "string" ? vercel.find((row) => row.id === input.deploymentId) : undefined;
      return send(res, 200, { id: build(vercel, { production: input.target === "production", ...(from ? { sha: from.sha, message: from.message, branch: from.branch } : {}) }).id });
    }
    const vercelMove = /^\/vercel\/v(?:9|10)\/projects\/prj_launch\/(rollback|promote)\/([\w-]+)$/.exec(path);
    if (vercelMove && req.method === "POST") {
      const row = vercel.find((candidate) => candidate.id === vercelMove[2]);
      if (!row) return send(res, 404, { error: { message: "Deployment not found" } });
      if (vercelMove[1] === "promote") row.production = true;
      vercelLive = row.id;
      return send(res, 201, {});
    }

    const pages = "/cloudflare/accounts/acc123/pages/projects/launch-docs";
    if (path === pages && get) return send(res, 200, { success: true, result: { name: "launch-docs", canonical_deployment: { id: cloudflareLive } } });
    if (path === `${pages}/deployments` && get) {
      return send(res, 200, {
        success: true,
        result: cloudflare.map((row) => ({
          id: row.id, url: `https://${row.id}.launch-docs.pages.dev`, environment: row.production ? "production" : "preview", created_on: new Date(row.created).toISOString(),
          latest_stage: row.state === "READY" ? { name: "deploy", status: "success" } : row.state === "ERROR" ? { name: "build", status: "failure" } : { name: "build", status: "active" },
          deployment_trigger: { metadata: { branch: row.branch, commit_hash: row.sha, commit_message: row.message } }, aliases: row.production ? null : [`https://${row.branch}.launch-docs.pages.dev`],
        })),
      });
    }
    if (path === `${pages}/deployments` && req.method === "POST") return send(res, 200, { success: true, result: { id: build(cloudflare, { production: true, branch: String((body as Json)?.branch ?? "main") }).id } });
    const cfMove = new RegExp(`^${pages}/deployments/([\\w-]+)/(rollback|retry)$`).exec(path);
    if (cfMove && req.method === "POST") {
      const row = cloudflare.find((candidate) => candidate.id === cfMove[1]);
      if (!row) return send(res, 404, { success: false, errors: [{ message: "Deployment not found" }] });
      if (cfMove[2] === "rollback") cloudflareLive = row.id;
      else build(cloudflare, { production: row.production, sha: row.sha, message: row.message });
      return send(res, 200, { success: true, result: {} });
    }

    const repo = "/github/repos/acme/launch";
    if (path === repo && get) return send(res, 200, { default_branch: "main" });
    if (path === `${repo}/releases/latest` && get) return releases.length ? send(res, 200, releases[0]) : send(res, 200, { tag_name: "v1.3.2" });
    if (path === `${repo}/commits/v1.3.2` && get) return send(res, 200, { commit: { committer: { date: new Date(minutes(60 * 24 * 6)).toISOString() } } });
    if (path === `${repo}/pulls` && get) {
      const merged = (number: number, title: string, days: number, author: string, labels: string[] = []) => ({ number, title, html_url: `https://github.com/acme/launch/pull/${number}`, merged_at: new Date(minutes(60 * 24 * days)).toISOString(), user: { login: author }, labels: labels.map((name) => ({ name })), body: "" });
      return send(res, 200, [
        merged(41, "feat: dark mode for the dashboard", 1, "ada", ["enhancement"]),
        merged(40, "fix: sign-up form keeps the email after an error", 2, "kai"),
        merged(39, "Faster project switching", 3, "ada"),
        merged(37, "chore: bump vite", 4, "dependabot"),
        merged(30, "Released last week", 9, "ada"),
      ]);
    }
    if (path === `${repo}/releases` && req.method === "POST") {
      const input = body as Json;
      const release = { tag_name: input.tag_name, name: input.name, body: input.body, html_url: `https://github.com/acme/launch/releases/tag/${String(input.tag_name)}` };
      releases.unshift(release);
      return send(res, 201, release);
    }
    if (path === `${repo}/actions/workflows/mobile.yml/runs` && get) {
      return send(res, 200, {
        workflow_runs: runs.map((row) => ({
          id: Number(row.id), status: row.state === "BUILDING" ? "in_progress" : "completed", conclusion: row.state === "READY" ? "success" : row.state === "ERROR" ? "failure" : null,
          head_branch: row.branch, head_sha: row.sha, display_title: row.message, created_at: new Date(row.created).toISOString(), html_url: `https://github.com/acme/launch/actions/runs/${row.id}`,
        })),
      });
    }
    if (path === `${repo}/actions/workflows/mobile.yml/dispatches` && req.method === "POST") {
      build(runs, { id: String(7001 + ++counter), production: true, message: "Release build" });
      return send(res, 204);
    }
    return send(res, 404, { message: `The fake has no ${req.method} ${path}` });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("The fake providers have no port");
  return { origin: `http://127.0.0.1:${address.port}`, requests, close: () => new Promise((resolve) => server.close(() => resolve())) };
}
