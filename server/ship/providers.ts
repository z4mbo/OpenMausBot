import { SHIP_PROVIDER_LABEL, type DeploymentState, type ShipAction, type ShipDeployment, type ShipTarget } from "../../shared/origin-ship.ts";

export type ProviderHost = "vercel" | "netlify" | "cloudflare" | "github";
type Json = Record<string, unknown>;

const BASES: Record<ProviderHost, string> = {
  vercel: "https://api.vercel.com",
  netlify: "https://api.netlify.com/api/v1",
  cloudflare: "https://api.cloudflare.com/client/v4",
  github: "https://api.github.com",
};
const HOST_LABEL: Record<ProviderHost, string> = { vercel: "Vercel", netlify: "Netlify", cloudflare: "Cloudflare", github: "GitHub" };
const TIMEOUT_MS = 20_000;
export const DEPLOYMENTS_SHOWN = 20;

export interface ShipHttp {
  fetch: typeof fetch;
  /** Test hook: every provider request goes to `${origin}/<provider>` on this computer instead. */
  origin?: string;
}

/** A provider refusal worded for the person; it never carries the token. */
export class ShipError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

const record = (value: unknown): Json => (value && typeof value === "object" && !Array.isArray(value) ? value as Json : {});
const list = (value: unknown): Json[] => (Array.isArray(value) ? value.map(record) : []);
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const time = (value: unknown): number => typeof value === "number" ? value : Number.isFinite(Date.parse(text(value))) ? Date.parse(text(value)) : 0;
const https = (value: string) => !value ? undefined : /^https?:\/\//.test(value) ? value : `https://${value}`;

function providerMessage(body: Json): string {
  const candidates = [record(body.error).message, body.message, list(body.errors)[0]?.message, body.error];
  return (candidates.find((value) => typeof value === "string" && value.trim()) as string | undefined)?.trim().slice(0, 200) ?? "";
}

/** One JSON (or form) request to a provider's API; null for an empty answer such as 204. */
export async function providerRequest<T = Json>(http: ShipHttp, host: ProviderHost, path: string, token: string, init: { method?: string; body?: unknown } = {}): Promise<T | null> {
  const base = http.origin ? `${http.origin}/${host}` : BASES[host];
  const form = init.body instanceof FormData;
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: host === "github" ? "application/vnd.github+json" : "application/json", "User-Agent": "origin-ship" };
  if (host === "github") headers["X-GitHub-Api-Version"] = "2022-11-28";
  if (init.body !== undefined && !form) headers["Content-Type"] = "application/json";
  let response: Response;
  try {
    response = await http.fetch(`${base}${path}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"), headers, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS),
      ...(init.body !== undefined ? { body: form ? init.body as FormData : JSON.stringify(init.body) } : {}),
    });
  } catch {
    throw new ShipError(`${HOST_LABEL[host]} did not answer. Try again in a moment.`);
  }
  const raw = await response.text();
  let body: unknown = null;
  try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
  if (!response.ok) {
    const detail = providerMessage(record(body)).replaceAll(token, "[redacted]");
    const label = HOST_LABEL[host];
    if (response.status === 401) throw new ShipError(host === "github" ? "Reconnect GitHub in workspace settings" : `${label} did not accept the token saved in Settings > Integrations.`, 401);
    if (response.status === 403) throw new ShipError(host === "github" ? "GitHub refused: the Origin GitHub App needs Actions: write on this repository to run workflows." : `${label} refused: the token cannot do this${detail ? ` (${detail})` : ""}.`, 403);
    if (response.status === 404) throw new ShipError(`${label} has no such project, site or deployment. Check the target's settings.`, 404);
    if (response.status === 429) throw new ShipError(`${label} is rate limiting requests. Try again in a minute.`, 429);
    throw new ShipError(`${label} answered ${response.status}${detail ? `: ${detail}` : ""}.`, response.status >= 500 ? 502 : 400);
  }
  return body as T | null;
}

const ACTIONS_WHEN_DONE: DeploymentState[] = ["ready", "error", "canceled"];

/** A provider's deployments of one target, newest first, and what can be done to each. */
export interface ProviderClient {
  deployments(target: ShipTarget, token: string): Promise<ShipDeployment[]>;
  /** Starts the action and says what it started, in a sentence. */
  act(target: ShipTarget, token: string, action: ShipAction, deployment: ShipDeployment | undefined, repo: { owner: string; repo: string } | null): Promise<string>;
}

function vercelQuery(target: ShipTarget, params: Record<string, string> = {}) {
  const query = new URLSearchParams({ ...params, ...(target.account ? { teamId: target.account } : {}) }).toString();
  return query ? `?${query}` : "";
}

function vercelState(state: string): DeploymentState {
  if (state === "READY") return "ready";
  if (state === "ERROR" || state === "DELETED") return "error";
  if (state === "CANCELED") return "canceled";
  if (state === "QUEUED") return "queued";
  return "building";
}

function vercel(http: ShipHttp): ProviderClient {
  const project = async (target: ShipTarget, token: string) => record(await providerRequest(http, "vercel", `/v9/projects/${encodeURIComponent(target.ref)}${vercelQuery(target)}`, token));
  return {
    async deployments(target, token) {
      const [info, data] = await Promise.all([
        project(target, token).catch(() => ({} as Json)),
        providerRequest(http, "vercel", `/v6/deployments${vercelQuery(target, { projectId: target.ref, limit: String(DEPLOYMENTS_SHOWN) })}`, token),
      ]);
      const currentId = text(record(record(info.targets).production).id);
      return list(record(data).deployments).map((row): ShipDeployment => {
        const meta = record(row.meta);
        const state = vercelState(text(row.readyState) || text(row.state));
        const production = row.target === "production";
        const current = Boolean(currentId) && text(row.uid) === currentId;
        const actions: ShipDeployment["actions"] = [];
        if (state === "ready" && production && !current) actions.push("rollback");
        if (state === "ready" && !production) actions.push("promote");
        if (ACTIONS_WHEN_DONE.includes(state)) actions.push("redeploy");
        const pr = Number(text(meta.githubPrId));
        return {
          id: text(row.uid), state, url: https(text(row.url)), inspectUrl: https(text(row.inspectorUrl)), createdAt: time(row.created ?? row.createdAt), production, current,
          ...(text(meta.githubCommitSha) ? { commitSha: text(meta.githubCommitSha) } : {}), ...(text(meta.githubCommitMessage) ? { commitMessage: text(meta.githubCommitMessage).split("\n")[0] } : {}),
          ...(text(meta.githubCommitRef) ? { branch: text(meta.githubCommitRef) } : {}), ...(Number.isSafeInteger(pr) && pr > 0 ? { pullRequest: pr } : {}), actions,
        };
      });
    },
    async act(target, token, action, deployment, repo) {
      const info = await project(target, token);
      const id = text(info.id) || target.ref;
      const name = text(info.name) || target.ref;
      if (action === "deploy") {
        if (!repo) throw new ShipError("Link the project's GitHub repository before deploying from Vercel.", 409);
        await providerRequest(http, "vercel", `/v13/deployments${vercelQuery(target, { forceNew: "1" })}`, token, {
          body: { name, project: id, target: "production", gitSource: { type: "github", org: repo.owner, repo: repo.repo, ref: target.branch } },
        });
        return `Vercel is building ${target.branch} for production.`;
      }
      if (!deployment) throw new ShipError("Pick a deployment.", 400);
      if (action === "redeploy") {
        await providerRequest(http, "vercel", `/v13/deployments${vercelQuery(target, { forceNew: "1" })}`, token, {
          body: { name, deploymentId: deployment.id, ...(deployment.production ? { target: "production" } : {}) },
        });
        return "Vercel is rebuilding that deployment.";
      }
      const route = action === "promote" ? `/v10/projects/${encodeURIComponent(id)}/promote/${encodeURIComponent(deployment.id)}` : `/v9/projects/${encodeURIComponent(id)}/rollback/${encodeURIComponent(deployment.id)}`;
      await providerRequest(http, "vercel", `${route}${vercelQuery(target)}`, token, { method: "POST" });
      return action === "promote" ? "Vercel is promoting that deployment to production." : "Vercel is rolling production back to that deployment.";
    },
  };
}

function netlifyState(state: string, error: string): DeploymentState {
  if (state === "ready") return "ready";
  if (state === "error" || state === "rejected") return /cancel/i.test(error) ? "canceled" : "error";
  if (state === "new" || state === "enqueued") return "queued";
  return "building";
}

function netlify(http: ShipHttp): ProviderClient {
  const site = (target: ShipTarget, token: string) => providerRequest(http, "netlify", `/sites/${encodeURIComponent(target.ref)}`, token).then(record);
  return {
    async deployments(target, token) {
      const [info, rows] = await Promise.all([
        site(target, token).catch(() => ({} as Json)),
        providerRequest(http, "netlify", `/sites/${encodeURIComponent(target.ref)}/deploys?per_page=${DEPLOYMENTS_SHOWN}`, token),
      ]);
      const currentId = text(record(info.published_deploy).id);
      const admin = text(info.admin_url);
      return list(rows).map((row): ShipDeployment => {
        const state = netlifyState(text(row.state), text(row.error_message));
        const production = row.context === "production";
        const current = Boolean(currentId) && text(row.id) === currentId;
        const pr = Number(row.review_id);
        return {
          id: text(row.id), state, url: https(text(record(row.links).permalink) || text(row.deploy_ssl_url)), createdAt: time(row.created_at), production, current,
          ...(admin ? { inspectUrl: `${admin}/deploys/${text(row.id)}` } : {}), ...(text(row.commit_ref) ? { commitSha: text(row.commit_ref) } : {}),
          ...(text(row.title) ? { commitMessage: text(row.title).split("\n")[0] } : {}), ...(text(row.branch) ? { branch: text(row.branch) } : {}),
          ...(Number.isSafeInteger(pr) && pr > 0 ? { pullRequest: pr } : {}),
          actions: state === "ready" && production && !current ? ["rollback"] : [],
        };
      });
    },
    async act(target, token, action, deployment) {
      if (action === "deploy" || action === "redeploy") {
        await providerRequest(http, "netlify", `/sites/${encodeURIComponent(target.ref)}/builds`, token, { body: {} });
        return "Netlify is building the site's production branch.";
      }
      if (!deployment) throw new ShipError("Pick a deployment.", 400);
      await providerRequest(http, "netlify", `/sites/${encodeURIComponent(target.ref)}/deploys/${encodeURIComponent(deployment.id)}/restore`, token, { method: "POST" });
      return "Netlify is publishing that deploy to production.";
    },
  };
}

function cloudflareState(stage: Json): DeploymentState {
  const name = text(stage.name), status = text(stage.status);
  if (status === "failure") return "error";
  if (status === "canceled") return "canceled";
  if (name === "deploy" && status === "success") return "ready";
  if (name === "queued") return "queued";
  return "building";
}

function cloudflare(http: ShipHttp): ProviderClient {
  const base = (target: ShipTarget) => `/accounts/${encodeURIComponent(target.account ?? "")}/pages/projects/${encodeURIComponent(target.ref)}`;
  return {
    async deployments(target, token) {
      const [info, rows] = await Promise.all([
        providerRequest(http, "cloudflare", base(target), token).then((body) => record(record(body).result), () => ({} as Json)),
        providerRequest(http, "cloudflare", `${base(target)}/deployments`, token),
      ]);
      const currentId = text(record(info.canonical_deployment).id);
      return list(record(rows).result).slice(0, DEPLOYMENTS_SHOWN).map((row): ShipDeployment => {
        const meta = record(record(row.deployment_trigger).metadata);
        const state = cloudflareState(record(row.latest_stage));
        const production = row.environment === "production";
        const current = Boolean(currentId) && text(row.id) === currentId;
        const alias = Array.isArray(row.aliases) ? text(row.aliases[0]) : "";
        const actions: ShipDeployment["actions"] = [];
        if (state === "ready" && production && !current) actions.push("rollback");
        if (ACTIONS_WHEN_DONE.includes(state)) actions.push("redeploy");
        return {
          id: text(row.id), state, url: https(alias || text(row.url)), createdAt: time(row.created_on), production, current,
          inspectUrl: `https://dash.cloudflare.com/${encodeURIComponent(target.account ?? "")}/pages/view/${encodeURIComponent(target.ref)}/${encodeURIComponent(text(row.id))}`,
          ...(text(meta.commit_hash) ? { commitSha: text(meta.commit_hash) } : {}), ...(text(meta.commit_message) ? { commitMessage: text(meta.commit_message).split("\n")[0] } : {}),
          ...(text(meta.branch) ? { branch: text(meta.branch) } : {}), actions,
        };
      });
    },
    async act(target, token, action, deployment) {
      if (action === "deploy") {
        const form = new FormData();
        form.set("branch", target.branch);
        await providerRequest(http, "cloudflare", `${base(target)}/deployments`, token, { body: form });
        return `Cloudflare Pages is building ${target.branch} for production.`;
      }
      if (!deployment) throw new ShipError("Pick a deployment.", 400);
      if (action === "promote") throw new ShipError("Cloudflare Pages promotes by deploying the production branch.", 400);
      await providerRequest(http, "cloudflare", `${base(target)}/deployments/${encodeURIComponent(deployment.id)}/${action === "redeploy" ? "retry" : "rollback"}`, token, { method: "POST" });
      return action === "redeploy" ? "Cloudflare Pages is retrying that deployment." : "Cloudflare Pages is rolling production back to that deployment.";
    },
  };
}

export type KeyedProvider = "vercel" | "netlify" | "cloudflare";

export function providerClients(http: ShipHttp): Record<KeyedProvider, ProviderClient> {
  return { vercel: vercel(http), netlify: netlify(http), cloudflare: cloudflare(http) };
}

export function actionLabel(provider: ShipTarget["provider"], action: ShipAction): string {
  if (action === "deploy") return `deploy to ${SHIP_PROVIDER_LABEL[provider]}`;
  return action === "redeploy" ? "redeploy" : action === "promote" ? "promote to production" : "roll back production";
}
