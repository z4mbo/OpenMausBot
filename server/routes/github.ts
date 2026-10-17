import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { DATA_DIR } from "../config.ts";
import { convexOriginClient, defaultOriginCloudFile, readOriginCloud, type OriginCloudClient } from "../origin-cloud.ts";
import { parseCookies } from "../request-auth.ts";
import { permissionNotice } from "../github/app.ts";
import { BodyTooLarge, readBoundedJson, readBoundedText } from "../github/http-body.ts";
import { createTaskPR, syncPREvent, syncPRPage } from "../github/prs.ts";
import { githubHeaders, parseGitHubRepo, repoName } from "../github/repo.ts";
import {
  appConfig, convexSiteUrl, createIntegrationBridge, exchangeGitHubToken, githubAuthorizeUrl, githubEnvFrom, githubRequest, originUrl,
  GitHubHttpError, verifyIntegration, workspaceGitHubToken, type GitHubEnv, type GitHubService,
} from "../github/service.ts";
import { createGitHubStore, RateLimited, type GithubState } from "../github/store.ts";
import { approvePullRequest, listPullRequests, mergeAndComplete, withProjectGitHub } from "../github/review.ts";
import {
  createGitHubTask, createProjectRepository, DRAFT_STAYS_LOCAL, mirrorTasks, mirrorUnlinkedPage, removalSentence, removeGitHubIssue, syncGitHubEvent, syncGitHubPage,
  syncLinkedTask, type MirrorResult,
} from "../github/sync.ts";
import { parseGitHubEvent, verifyGitHubSignature, WEBHOOK_EVENTS, WEBHOOK_MAX_BYTES } from "../github/webhook.ts";
import { isRepositoryName } from "../../shared/github-repo-name.ts";
import { isDraftColumn } from "../../shared/origin-columns.ts";
import { PASS, type PublicRouteHandler, type RouteHandler } from "./table.ts";

type Args = Record<string, unknown>;
type BoardColumn = { _id: string; title: string; isDraft?: boolean };
type Project = { _id: string; teamId?: string; repoUrl?: string; memberRole?: string; ownerEmail?: string; githubWorkspaceAccess?: boolean; githubTaskMode?: string };
type OriginUser = { _id: string; email: string };
type WorkspaceUser = OriginUser & { teamId: string; workspaceRole: string; slug: string };

const STATE_COOKIE = "origin.github";
const ADMIN_ROLES = new Set(["owner", "admin"]);
const MINUTE = 60_000;
const MIRROR_BATCH = 20;

export interface GitHubServiceOptions {
  dataDir?: string;
  env?: GitHubEnv;
  /** The Convex URL the person's Origin sign-in shared with this server; ORIGIN_CONVEX_URL is the fallback. */
  sharedConvexUrl?: () => string | undefined;
  /** The server's own public URL, used when ORIGIN_PUBLIC_URL is unset. */
  serverPublicUrl?: () => string | null;
  fetch?: typeof fetch;
  connect?: (url: string) => OriginCloudClient;
  now?: () => number;
}

export function createGitHubService(options: GitHubServiceOptions = {}): () => GitHubService {
  const env = options.env ?? githubEnvFrom(process.env);
  const sharedConvexUrl = options.sharedConvexUrl ?? (() => readOriginCloud(defaultOriginCloudFile()).url);
  const now = options.now ?? Date.now;
  const fetcher = options.fetch ?? fetch;
  const connect = options.connect ?? convexOriginClient;
  const store = createGitHubStore(join(options.dataDir ?? DATA_DIR, "origin-github"), now);
  const convexUrl = () => sharedConvexUrl() ?? env.convexUrl;
  let client: { url: string; client: OriginCloudClient } | undefined;
  const service: GitHubService = {
    store, env, fetch: fetcher, now,
    publicUrl: () => env.publicUrl ?? options.serverPublicUrl?.() ?? undefined,
    convex() {
      const url = convexUrl();
      if (!url) throw new Error("Sign in to Origin first: this server has no Origin backend address");
      if (client?.url !== url) client = { url, client: connect(url) };
      return client.client;
    },
    bridge: createIntegrationBridge({ fetch: fetcher, now, secret: () => env.integrationSecret, siteUrl: () => convexSiteUrl(env, convexUrl()) }),
  };
  return () => service;
}

export interface GitHubRouteDeps {
  service(): GitHubService;
  /** Defaults to fire-and-forget; tests pass a collector to await the work. */
  background?: (work: Promise<void>) => void;
  /** Other periodic integration work run on each Convex tick. */
  tickJobs?: ReadonlyArray<() => Promise<unknown>>;
}

const runInBackground = (work: Promise<void>) => { work.catch((error: unknown) => console.warn("GitHub background work failed", error instanceof Error ? error.message : error)); };

function originSession(req: IncomingMessage, body?: Args): string {
  const header = req.headers["x-origin-session"];
  const value = Array.isArray(header) ? header[0] : header;
  if (value?.trim()) return value.trim();
  return typeof body?.sessionToken === "string" ? body.sessionToken : "";
}

async function requireUser(service: GitHubService, sessionToken: string): Promise<OriginUser> {
  if (!sessionToken) throw new Error("Login required");
  const user = await service.convex().query("auth:me", { sessionToken }) as OriginUser | null;
  if (!user) throw new Error("Login required");
  return user;
}

async function requireWorkspace(service: GitHubService, sessionToken: string, teamId: string): Promise<WorkspaceUser> {
  if (!teamId) throw new Error("Workspace required");
  const convex = service.convex();
  const [user, access] = await Promise.all([
    requireUser(service, sessionToken),
    convex.query("workspaces:access", { sessionToken, teamId }) as Promise<{ teamId: string; role: string; slug: string }>,
  ]);
  return { ...user, teamId: access.teamId, workspaceRole: access.role, slug: access.slug };
}

async function githubProject(service: GitHubService, sessionToken: string, projectId: string | null | undefined, write = false) {
  if (!projectId) throw new Error("Project required");
  const user = await requireUser(service, sessionToken);
  const convex = service.convex();
  const project = await convex.query("projects:get", { sessionToken, projectId }) as Project;
  if (write && project.memberRole === "viewer") throw new Error("Edit role required");
  const repo = parseGitHubRepo(project.repoUrl);
  const name = repo ? repoName(repo) : null;
  const saved = name ? service.store.connectionInfo(project._id, name) : null;
  const credential = saved ? await service.bridge<{ credentialAllowed: boolean }>("context", { projectId, credentialOwner: saved.connectedBy }) : null;
  const token = name && credential?.credentialAllowed ? service.store.connectionToken(project._id, name) : undefined;
  const owner = service.env.legacyOwnerEmail;
  const legacyToken = owner && user.email.toLowerCase() === owner && project.ownerEmail?.toLowerCase() === owner ? service.env.legacyToken : undefined;
  const workspace = project.teamId ? await convex.query("integrations:status", { sessionToken, teamId: project.teamId }) as { connectedBy: string | null } : null;
  const workspaceToken = !token && project.githubWorkspaceAccess && workspace?.connectedBy && project.teamId ? await workspaceGitHubToken(service, project.teamId, workspace.connectedBy) : undefined;
  return { project, user, token: token || workspaceToken || legacyToken, repo: name };
}

function failure(res: ServerResponse, json: (res: ServerResponse, status: number, body: unknown) => void, error: unknown, fallback: string, status = 400) {
  const code = error instanceof BodyTooLarge ? 413 : error instanceof RateLimited ? 429 : status;
  json(res, code, { error: error instanceof Error ? error.message : fallback });
}

function stateCookie(service: GitHubService, browser: string | null): string {
  const secure = service.publicUrl()?.startsWith("https:") ? "; Secure" : "";
  return browser === null
    ? `${STATE_COOKIE}=; Path=/api/github; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
    : `${STATE_COOKIE}=${browser}; Path=/api/github; HttpOnly; SameSite=Lax; Max-Age=900${secure}`;
}

function redirect(res: ServerResponse, location: string, cookie?: string) {
  res.writeHead(302, { location, "cache-control": "no-store", "referrer-policy": "no-referrer", ...(cookie ? { "set-cookie": cookie } : {}) });
  res.end();
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

function page(res: ServerResponse, status: number, title: string, body: string, options: { cookie?: string; formAction?: string } = {}) {
  const csp = `default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action ${options.formAction ?? "'none'"}`;
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer", "content-security-policy": csp,
    ...(options.cookie ? { "set-cookie": options.cookie } : {}),
  });
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><body style="font:15px system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 16px"><h1 style="font-size:20px">${escapeHtml(title)}</h1>${body}</body>`);
}

function appManifest(origin: string) {
  return {
    name: "Origin Workspace", url: origin, public: true,
    redirect_url: `${origin}/api/github/setup/callback`, callback_urls: [`${origin}/api/github/oauth/callback`],
    setup_url: `${origin}/api/github/oauth/install`, request_oauth_on_install: false,
    hook_attributes: { url: `${origin}/api/github/webhook`, active: true },
    default_permissions: { administration: "write", issues: "write", contents: "write", pull_requests: "write", checks: "read", metadata: "read" },
    default_events: ["issues", "pull_request", "pull_request_review", "check_suite", "check_run"],
  };
}

const isSetupOwner = (service: GitHubService, email: string) => Boolean(service.env.legacyOwnerEmail) && email.toLowerCase() === service.env.legacyOwnerEmail;

/** The routes the Origin client calls; each carries the caller's Origin session in `x-origin-session`. */
export function createGitHubRoutes(deps: Pick<GitHubRouteDeps, "service">): RouteHandler {
  return async ({ req, res, url, path, method, json }) => {
    if (!path.startsWith("/api/github/")) return PASS;
    const service = deps.service();
    const { store } = service;
    const query = (name: string) => url.searchParams.get(name) || undefined;
    res.setHeader("cache-control", "no-store");

    if (path === "/api/github/connection" && ["GET", "POST", "DELETE"].includes(method)) {
      try {
        const sessionToken = originSession(req);
        const context = () => githubProject(service, sessionToken, query("projectId"));
        const { project, user, repo, token } = await context();
        if (method === "GET") {
          const projectConnection = repo ? store.connectionInfo(project._id, repo) : null;
          const workspace = project.teamId && project.githubWorkspaceAccess && token ? store.workspaceInfo(project.teamId) : null;
          const status = workspace && project.teamId ? await service.convex().query("integrations:status", { sessionToken, teamId: project.teamId }) as { connectedBy: string | null } : null;
          const connection = projectConnection ? { ...projectConnection, source: "project" }
            : workspace && status?.connectedBy === workspace.connected_by ? { login: workspace.login, source: "workspace" } : null;
          return json(res, 200, { connection });
        }
        if (!ADMIN_ROLES.has(project.memberRole ?? "")) throw new Error(`A project admin must ${method === "POST" ? "connect" : "disconnect"} GitHub`);
        if (method === "DELETE") {
          store.deleteConnection(project._id);
          return json(res, 200, { connection: null });
        }
        if (!repo) throw new Error("Add a GitHub repository in project settings first");
        store.limit(`github-connect:${user._id}`, 10, MINUTE);
        const body = await readBoundedJson(req);
        const personal = body.token;
        if (typeof personal !== "string" || personal.length < 20 || personal.length > 500 || /\s/.test(personal)) throw new Error("Enter a valid GitHub access token");
        const options = { headers: githubHeaders(personal), signal: AbortSignal.timeout(15_000) };
        const account = await service.fetch("https://api.github.com/user", options);
        if (!account.ok) throw new Error("GitHub could not verify this token. Check that it has not expired.");
        const { login } = await account.json() as { login: string };
        const repository = await service.fetch(`https://api.github.com/repos/${repo}`, options);
        if (!repository.ok) throw new Error("This token cannot access the repository. Select this repository when creating the token and check organization approval.");
        const current = await context();
        if (current.user._id !== user._id || current.repo !== repo || !ADMIN_ROLES.has(current.project.memberRole ?? "")) throw new Error("Repository access changed. Reload and reconnect GitHub.");
        store.saveConnection(project._id, repo, login, personal, user._id);
        return json(res, 200, { connection: store.connectionInfo(project._id, repo) });
      } catch (error) { return failure(res, json, error, "GitHub connection failed"); }
    }

    if (path === "/api/github/issues" && method === "POST") {
      try {
        const body = await readBoundedJson(req);
        if (typeof body.projectId !== "string" || typeof body.taskId !== "string") throw new Error("Project and issue required");
        const sessionToken = originSession(req, body);
        const { user, project, token } = await githubProject(service, sessionToken, body.projectId, true);
        store.limit(`github-create:${user._id}`, 20, MINUTE);
        const convex = service.convex();
        if (!token && project.teamId && project.repoUrl && !project.githubWorkspaceAccess) {
          const workspace = await convex.query("integrations:status", { sessionToken, teamId: project.teamId }) as { connectedBy: string | null };
          // Creating an issue as a workspace admin also approves the repository; the mutation checks workspace admin, not the project role.
          if (workspace.connectedBy) await convex.mutation("integrations:approveRepository", { sessionToken, projectId: project._id, repoUrl: project.repoUrl });
        }
        const details = await convex.query("tasks:details", { sessionToken, projectId: project._id, taskId: body.taskId }) as { task: { columnId: string; githubTaskMode?: string }; columns: BoardColumn[] };
        if (details.columns.some((column) => column._id === details.task.columnId && isDraftColumn(column))) throw new Error(DRAFT_STAYS_LOCAL);
        const asPullRequest = details.task.githubTaskMode === "pull_request" || (!details.task.githubTaskMode && project.githubTaskMode === "pull_request");
        return json(res, 200, asPullRequest ? await createTaskPR(service, sessionToken, body.projectId, body.taskId) : await createGitHubTask(service, body.projectId, body.taskId));
      } catch (error) { return failure(res, json, error, "GitHub issue creation failed"); }
    }

    if (path === "/api/github/issues/delete" && method === "POST") {
      try {
        const body = JSON.parse(await readBoundedText(req, 2_000)) as Args;
        if (typeof body.projectId !== "string" || typeof body.taskId !== "string") throw new Error("Project and issue required");
        const sessionToken = originSession(req, body);
        const { user, project } = await githubProject(service, sessionToken, body.projectId, true);
        store.limit(`github-delete:${user._id}`, 20, MINUTE);
        const key = `delete-issue:${body.taskId}`;
        if (!store.lockJob(key)) throw new Error("This issue is already being deleted");
        try {
          const convex = service.convex();
          const details = await convex.query("tasks:details", { sessionToken, projectId: project._id, taskId: body.taskId }) as { task: { githubIssueUrl?: string } };
          const github = details.task.githubIssueUrl ? await removeGitHubIssue(service, project._id, body.taskId, details.task.githubIssueUrl) : null;
          try {
            await convex.mutation("tasks:deleteTask", { sessionToken, projectId: project._id, taskId: body.taskId });
          } catch (error) {
            const reason = error instanceof Error ? error.message : "unknown error";
            return json(res, 502, { error: `${github ? `${removalSentence(github)}, but ` : ""}Origin could not delete the issue: ${reason}`, github });
          }
          return json(res, 200, { github, message: github ? `Deleted the issue; ${removalSentence(github)}.` : "Deleted the issue." });
        } finally { store.saveJob(key, "done"); }
      } catch (error) { return failure(res, json, error, "Issue deletion failed"); }
    }

    if (path === "/api/github/pull-requests" && method === "POST") {
      try {
        const body = JSON.parse(await readBoundedText(req, 2_000)) as Args;
        if (typeof body.projectId !== "string" || typeof body.taskId !== "string") throw new Error("Project and task required");
        const sessionToken = originSession(req, body);
        const { user } = await githubProject(service, sessionToken, body.projectId, true);
        store.limit(`github-pr:${user._id}`, 20, MINUTE);
        return json(res, 200, await createTaskPR(service, sessionToken, body.projectId, body.taskId));
      } catch (error) { return failure(res, json, error, "PR creation failed"); }
    }

    if (path === "/api/github/repo" && method === "POST") {
      try {
        const sessionToken = originSession(req);
        const user = await requireWorkspace(service, sessionToken, query("teamId") ?? "");
        if (!ADMIN_ROLES.has(user.workspaceRole)) return json(res, 403, { error: "A workspace admin must create the repository" });
        const projectId = query("projectId");
        if (!projectId) throw new Error("Project required");
        const requested = JSON.parse(await readBoundedText(req, 2_000) || "{}") as Args;
        const name = typeof requested.name === "string" ? requested.name.trim() : undefined;
        if (name !== undefined && !isRepositoryName(name)) throw new Error("Use a repository name of up to 100 letters, digits, dots, dashes or underscores");
        const project = await service.convex().query("projects:get", { sessionToken, projectId }) as Project;
        if (project.teamId !== user.teamId) return json(res, 404, { error: "Project not found" });
        if (project.repoUrl) return json(res, 200, { state: "ready", repoUrl: project.repoUrl });
        if (!store.workspaceInfo(user.teamId)) return json(res, 409, { error: "Connect GitHub to this workspace first" });
        store.limit(`github-create-repo:${user._id}`, 10, MINUTE);
        const result = await createProjectRepository(service, projectId, true, name);
        const status = { error: 400, awaiting_connection: 409, working: 202, ready: 200 }[result.state];
        return json(res, status, result);
      } catch (error) { return failure(res, json, error, "Request failed"); }
    }

    if (path === "/api/github/repo" && method === "GET") {
      try {
        const { user, project, token } = await githubProject(service, originSession(req), query("projectId"));
        store.limit(`github-read:${user._id}`, 60, MINUTE);
        return json(res, 200, await readRepository(service, project.repoUrl, token));
      } catch (error) { return failure(res, json, error, "Request failed"); }
    }

    if (path === "/api/github/repos" && method === "GET") {
      try {
        const sessionToken = originSession(req);
        const user = await requireWorkspace(service, sessionToken, query("teamId") ?? "");
        if (!ADMIN_ROLES.has(user.workspaceRole)) return json(res, 403, { error: "A workspace admin chooses the repository" });
        const status = await service.convex().query("integrations:status", { sessionToken, teamId: user.teamId }) as { connectedBy: string | null; login: string | null };
        const token = status.connectedBy ? await workspaceGitHubToken(service, user.teamId, status.connectedBy) : undefined;
        if (!token) return json(res, 409, { error: "Connect GitHub to this workspace first" });
        store.limit(`github-read:${user._id}`, 60, MINUTE);
        const rows = await githubRequest<{ full_name: string; html_url: string; private: boolean }[]>(service, "/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member", token);
        return json(res, 200, { login: status.login, repositories: rows.map((row) => ({ fullName: row.full_name, url: row.html_url, private: row.private })) });
      } catch (error) { return failure(res, json, error, "Could not list repositories"); }
    }

    if (path === "/api/github/mirror" && method === "POST") {
      try {
        const body = JSON.parse(await readBoundedText(req, 20_000) || "{}") as Args;
        if (typeof body.projectId !== "string") throw new Error("Project required");
        const sessionToken = originSession(req, body);
        const { user, project } = await githubProject(service, sessionToken, body.projectId, true);
        if (!project.repoUrl) return json(res, 200, { results: [] });
        store.limit(`github-mirror:${user._id}`, 12, MINUTE);
        const board = await service.convex().query("tasks:board", { sessionToken, projectId: project._id }) as {
          columns: BoardColumn[]; tasks: { _id: string; columnId: string; done: boolean; githubIssueNumber?: number }[];
        };
        const wanted = Array.isArray(body.taskIds) ? new Set(body.taskIds.filter((id): id is string => typeof id === "string")) : null;
        const drafts = new Set(board.columns.filter(isDraftColumn).map((column) => column._id));
        const open = board.tasks.filter((task) => !task.done && (!wanted || wanted.has(task._id)));
        const taskIds = open.filter((task) => !task.githubIssueNumber && !drafts.has(task.columnId)).slice(0, MIRROR_BATCH).map((task) => task._id);
        const results = await mirrorTasks(service, project._id, taskIds);
        if (wanted) results.push(...open.filter((task) => !task.githubIssueNumber && drafts.has(task.columnId)).map((task) => ({ taskId: task._id, error: DRAFT_STAYS_LOCAL })));
        const linked = wanted ? open.flatMap((task) => (task.githubIssueNumber ? [{ taskId: task._id, issueNumber: task.githubIssueNumber }] : [])) : [];
        for (const { taskId, issueNumber } of linked.slice(0, MIRROR_BATCH)) {
          results.push(await syncLinkedTask(service, project._id, taskId, issueNumber).then(
            (): MirrorResult => ({ taskId, issueNumber }),
            (error: unknown): MirrorResult => ({ taskId, issueNumber, error: error instanceof Error ? error.message : "GitHub issue sync failed" }),
          ));
        }
        return json(res, 200, { results });
      } catch (error) { return failure(res, json, error, "GitHub issue mirroring failed"); }
    }

    if (path === "/api/github/pull-requests/review" && method === "POST") {
      try {
        const body = JSON.parse(await readBoundedText(req, 20_000)) as Args;
        if (typeof body.projectId !== "string" || !Number.isSafeInteger(body.number) || Number(body.number) < 1) throw new Error("Project and pull request required");
        if (body.action !== "approve" && body.action !== "merge") throw new Error("action must be approve or merge");
        const sessionToken = originSession(req, body);
        const { user, project } = await githubProject(service, sessionToken, body.projectId, true);
        if (!ADMIN_ROLES.has(project.memberRole ?? "")) return json(res, 403, { error: "A project admin approves and merges pull requests" });
        store.limit(`github-review:${user._id}`, 20, MINUTE);
        const number = Number(body.number);
        const comment = typeof body.body === "string" ? body.body.slice(0, 4_000) : "";
        const headSha = typeof body.headSha === "string" ? body.headSha : undefined;
        const result = await withProjectGitHub<object>(service, project._id, (token, repoUrl) => body.action === "approve"
          ? approvePullRequest(service, repoUrl, number, token, comment || "Approved in Origin.")
          : mergeAndComplete(service, project._id, repoUrl, number, token, headSha).then(({ sha, completed }) => ({ merged: true, sha, completed })));
        return json(res, 200, result);
      } catch (error) { return failure(res, json, error, "Pull request review failed"); }
    }

    if (path === "/api/github/setup" && method === "POST") {
      try {
        const sessionToken = originSession(req);
        const user = await requireWorkspace(service, sessionToken, query("teamId") ?? "");
        if (!isSetupOwner(service, user.email) || !ADMIN_ROLES.has(user.workspaceRole)) throw new Error("Origin administrator required");
        if (appConfig(service)) throw new Error("GitHub App is already configured");
        store.limit(`github-setup:${user._id}`, 3, MINUTE);
        const { state, browser } = store.createState({ teamId: user.teamId, userId: user._id, sessionToken, slug: user.slug, mode: "setup" });
        const ticket = store.createTicket({ state, browser, mode: "setup" });
        return json(res, 200, { url: `${originUrl(service)}/api/github/setup/begin?ticket=${ticket}` });
      } catch (error) { return failure(res, json, error, "Setup failed", 403); }
    }

    if (path === "/api/github/oauth/start" && method === "POST") {
      try {
        const sessionToken = originSession(req);
        const user = await requireWorkspace(service, sessionToken, query("teamId") ?? "");
        if (!ADMIN_ROLES.has(user.workspaceRole)) throw new Error("Workspace admin access required");
        store.limit(`github-connect:${user._id}`, 10, MINUTE);
        if (!appConfig(service)) throw new Error("The Origin GitHub App has not been configured yet");
        const projectId = query("projectId");
        if (projectId) {
          const project = await service.convex().query("projects:get", { sessionToken, projectId }) as Project;
          if (project.teamId !== user.teamId) throw new Error("Project not found");
        }
        const { state, browser } = store.createState({ teamId: user.teamId, userId: user._id, slug: user.slug, sessionToken, mode: "connect", ...(projectId ? { projectId } : {}) });
        const ticket = store.createTicket({ state, browser, mode: "connect" });
        return json(res, 200, { url: `${originUrl(service)}/api/github/oauth/begin?ticket=${ticket}` });
      } catch (error) { return failure(res, json, error, "Could not connect"); }
    }

    if (path === "/api/github/workspace" && method === "GET") {
      try {
        const user = await requireWorkspace(service, originSession(req), query("teamId") ?? "");
        const config = appConfig(service);
        const connection = store.workspaceInfo(user.teamId);
        return json(res, 200, {
          configured: Boolean(config), canSetup: isSetupOwner(service, user.email), login: connection?.login ?? null,
          prPermissionNotice: config ? permissionNotice : null, permissionApprovalUrl: "https://github.com/settings/installations",
          installationUrl: config?.slug ? `https://github.com/apps/${config.slug}/installations/new` : null,
        });
      } catch { return json(res, 403, { error: "Workspace access required" }); }
    }

    if (path === "/api/github/workspace" && method === "DELETE") {
      try {
        const sessionToken = originSession(req);
        const user = await requireWorkspace(service, sessionToken, query("teamId") ?? "");
        if (!ADMIN_ROLES.has(user.workspaceRole)) throw new Error("Admin role required");
        await service.convex().mutation("integrations:configure", { sessionToken, teamId: user.teamId, disconnect: true });
        store.disconnectWorkspace(user.teamId);
        return json(res, 200, { ok: true });
      } catch { return json(res, 403, { error: "Workspace admin access required" }); }
    }
    return PASS;
  };
}

type IssueRow = { number: number; title?: string; state?: "open" | "closed"; html_url?: string; updated_at?: string; user?: { login?: string }; pull_request?: unknown };
type CommitRow = { sha: string; html_url: string; commit: { message: string; author?: { name?: string; date?: string } } };

async function readRepository(service: GitHubService, repoUrl: string | undefined, token: string | undefined) {
  const repo = parseGitHubRepo(repoUrl);
  if (!repo) throw new Error("Add a valid GitHub repo URL in Settings.");
  const base = `https://api.github.com/repos/${repo.owner}/${repo.repo}`;
  const options = { headers: githubHeaders(token), signal: AbortSignal.timeout(15_000) };
  const [issuesResponse, pulls, commitsResponse] = await Promise.all([
    service.fetch(`${base}/issues?state=all&per_page=50`, options),
    listPullRequests(service, `https://github.com/${repo.owner}/${repo.repo}`, token).catch((error: unknown) => error instanceof GitHubHttpError ? error.status : 0),
    service.fetch(`${base}/commits?per_page=30`, options),
  ]);
  if (!issuesResponse.ok || typeof pulls === "number") {
    const status = !issuesResponse.ok ? issuesResponse.status : Number(pulls);
    throw new Error(status === 404 ? "Repository not found or access unavailable. Check the repository URL and workspace connection in repository settings."
      : status === 401 ? "Your GitHub connection has expired. Reconnect in repository settings."
      : status === 403 ? "GitHub denied access. Check the workspace connection, organization approval or rate limits."
      : `GitHub sync failed (${status}).`);
  }
  const at = (value?: string) => (value ? Date.parse(value) || service.now() : service.now());
  const web = `https://github.com/${repo.owner}/${repo.repo}`;
  const issues = (await issuesResponse.json() as IssueRow[]).filter((issue) => !issue.pull_request).map((issue) => ({
    number: issue.number, title: issue.title || `Issue #${issue.number}`, state: issue.state === "closed" ? "closed" : "open",
    url: issue.html_url || `${web}/issues/${issue.number}`, author: issue.user?.login, updatedAt: at(issue.updated_at),
  }));
  const pullRequests = pulls;
  const commits = commitsResponse.ok ? (await commitsResponse.json() as CommitRow[]).map((item) => ({
    sha: item.sha, url: item.html_url, message: item.commit.message.split("\n")[0], author: item.commit.author?.name || "GitHub", committedAt: at(item.commit.author?.date),
  })) : [];
  return {
    repo: `${repo.owner}/${repo.repo}`, tokenConfigured: Boolean(token), commits,
    commitsError: commitsResponse.ok || commitsResponse.status === 409 ? "" : "Commits unavailable. Check the token's Contents read permission.",
    issues, pullRequests, hosted: "origin-local",
  };
}

async function requireSetupAdmin(service: GitHubService, state: GithubState) {
  const user = await requireUser(service, state.sessionToken);
  const access = await service.convex().query("workspaces:access", { sessionToken: state.sessionToken, teamId: state.teamId }) as { role: string };
  if (user._id !== state.userId || !isSetupOwner(service, user.email) || !ADMIN_ROLES.has(access.role) || appConfig(service)) throw new Error("Setup unavailable");
}

async function requireStateAdmin(service: GitHubService, state: GithubState) {
  const access = await service.convex().query("workspaces:access", { sessionToken: state.sessionToken, teamId: state.teamId }) as { role: string };
  if (!ADMIN_ROLES.has(access.role)) throw new Error("Workspace admin access required");
}

async function retryAwaitingRepositories(service: GitHubService, state: GithubState) {
  try {
    const projects = await service.convex().query("projects:listForUser", { sessionToken: state.sessionToken, teamId: state.teamId }) as { _id: string; repoUrl?: string; githubRepoState?: string }[];
    for (const project of projects) {
      if (!project.repoUrl && project.githubRepoState === "awaiting_connection") await service.convex().mutation("integrations:retryRepo", { sessionToken: state.sessionToken, projectId: project._id });
    }
  } catch { console.warn("GitHub connected; pending repository retries can be started from the project"); }
}

const DONE_BODY = "<p>You can close this window and return to Origin.</p>";

/**
 * The routes GitHub and Convex call, and the browser legs of the OAuth and App-manifest flows. Security: every one
 * answers before the session gate, so each proves its caller itself: the webhook by GitHub's HMAC, the tick by the
 * integration HMAC, a browser leg by a single-use state bound to this browser's cookie.
 */
export function createGitHubPublicRoutes(deps: GitHubRouteDeps): PublicRouteHandler {
  const background = deps.background ?? runInBackground;
  return async ({ req, res, url, path, method, json }) => {
    if (path === "/api/integrations/tick" && method === "POST") return tick(deps.service(), req, res, json, background, deps.tickJobs ?? []);
    if (path === "/api/github/webhook" && method === "POST") return webhook(deps.service(), req, res, json);
    if (method !== "GET" || !path.startsWith("/api/github/")) return PASS;
    const service = deps.service();
    const { store } = service;
    const param = (name: string) => url.searchParams.get(name) ?? "";
    const browser = parseCookies(req.headers.cookie).get(STATE_COOKIE) ?? "";

    if (path === "/api/github/oauth/begin") {
      try {
        const ticket = store.consumeTicket(param("ticket"), "connect");
        const pending = store.peekState(ticket.state, ticket.browser);
        return redirect(res, githubAuthorizeUrl(service, ticket.state, createHash("sha256").update(pending.verifier).digest("base64url")), stateCookie(service, ticket.browser));
      } catch { return page(res, 400, "GitHub connection expired", "<p>Start again from Origin's settings.</p>"); }
    }

    if (path === "/api/github/setup/begin") {
      try {
        const ticket = store.consumeTicket(param("ticket"), "setup");
        store.peekState(ticket.state, ticket.browser);
        const manifest = escapeHtml(JSON.stringify(appManifest(originUrl(service))));
        const action = `https://github.com/settings/apps/new?state=${encodeURIComponent(ticket.state)}`;
        return page(res, 200, "Create the Origin GitHub App",
          `<p>GitHub will ask you to name and create the App for this Origin server.</p><form method="post" action="${escapeHtml(action)}"><input type="hidden" name="manifest" value="${manifest}"><button type="submit" style="font:inherit;padding:8px 14px">Continue to GitHub</button></form>`,
          { cookie: stateCookie(service, ticket.browser), formAction: "https://github.com" });
      } catch { return page(res, 400, "GitHub setup expired", "<p>Start again from Origin's settings.</p>"); }
    }

    if (path === "/api/github/setup/callback") {
      try {
        const state = store.consumeState(param("state"), browser, "setup");
        await requireSetupAdmin(service, state);
        const code = param("code");
        if (!/^[a-zA-Z0-9]+$/.test(code)) throw new Error("Invalid setup code");
        const response = await service.fetch(`https://api.github.com/app-manifests/${code}/conversions`, { method: "POST", headers: { Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(15_000) });
        const app = await response.json() as { id?: number; client_id?: string; client_secret?: string; slug?: string; webhook_secret?: string; pem?: string };
        if (!response.ok || !app.client_id || !app.client_secret || !app.slug || !app.webhook_secret) throw new Error("GitHub App setup failed");
        await requireSetupAdmin(service, state);
        store.saveApp({ clientId: app.client_id, clientSecret: app.client_secret, slug: app.slug, webhookSecret: app.webhook_secret, appId: app.id, privateKey: app.pem });
        return page(res, 200, "GitHub App ready", DONE_BODY, { cookie: stateCookie(service, null) });
      } catch { return page(res, 400, "GitHub App setup failed", DONE_BODY, { cookie: stateCookie(service, null) }); }
    }

    if (path === "/api/github/oauth/install") {
      try {
        const state = param("state");
        const pending = store.peekState(state, browser);
        return redirect(res, githubAuthorizeUrl(service, state, createHash("sha256").update(pending.verifier).digest("base64url")));
      } catch { return page(res, 400, "GitHub connection expired", "<p>Start again from Origin's settings.</p>"); }
    }

    if (path === "/api/github/oauth/callback") {
      try {
        const pending = store.consumeState(param("state"), browser, "connect");
        const app = appConfig(service);
        const code = url.searchParams.get("code");
        if (!app || !code || url.searchParams.has("error")) throw new Error("GitHub connection cancelled");
        await requireStateAdmin(service, pending);
        const token = await exchangeGitHubToken(service, { client_id: app.clientId, client_secret: app.clientSecret, code, code_verifier: pending.verifier, redirect_uri: `${originUrl(service)}/api/github/oauth/callback` });
        const account = await githubRequest<{ id: number; login: string }>(service, "/user", token.access_token);
        if (app.slug) {
          const result = await githubRequest<{ installations: { account: { id: number }; app_slug: string; suspended_at: string | null; permissions: { administration?: string } }[] }>(service, "/user/installations?per_page=100", token.access_token);
          const installation = result.installations.find((item) => item.app_slug === app.slug && item.account.id === account.id && !item.suspended_at);
          if (!installation || installation.permissions.administration !== "write") {
            if (pending.installationAttempted) throw new Error("GitHub installation needs Administration write permission on your personal account");
            const next = store.createState({ teamId: pending.teamId, userId: pending.userId, slug: pending.slug, sessionToken: pending.sessionToken, mode: "connect", installationAttempted: true, ...(pending.projectId ? { projectId: pending.projectId } : {}) });
            return redirect(res, `https://github.com/apps/${app.slug}/installations/new?state=${encodeURIComponent(next.state)}`, stateCookie(service, next.browser));
          }
        }
        await requireStateAdmin(service, pending);
        await service.convex().mutation("integrations:configure", { sessionToken: pending.sessionToken, teamId: pending.teamId, login: account.login, autoCreate: true });
        store.saveWorkspace(pending.teamId, account.login, account.id, pending.userId, token);
        background(retryAwaitingRepositories(service, pending));
        return page(res, 200, "GitHub connected", DONE_BODY, { cookie: stateCookie(service, null) });
      } catch (error) {
        console.warn("GitHub authorization callback failed", error instanceof Error ? error.message : "Authorization rejected");
        return page(res, 400, "GitHub connection failed", DONE_BODY, { cookie: stateCookie(service, null) });
      }
    }
    return PASS;
  };
}

type Json = (res: ServerResponse, status: number, body: unknown) => void;

async function tick(service: GitHubService, req: IncomingMessage, res: ServerResponse, json: Json, background: (work: Promise<void>) => void, tickJobs: ReadonlyArray<() => Promise<unknown>>) {
  let payload: Args;
  try {
    const body = await readBoundedText(req, 100_000);
    const signature = req.headers["x-origin-signature"];
    payload = verifyIntegration(service.env.integrationSecret, body, typeof signature === "string" ? signature : "", service.now());
  } catch (error) {
    res.writeHead(error instanceof BodyTooLarge ? 413 : 401, { "content-type": "text/plain" });
    res.end("Request rejected");
    return;
  }
  if (typeof payload.projectId === "string") {
    await createProjectRepository(service, payload.projectId);
    return json(res, 200, { ok: true });
  }
  if (!service.store.lockJob("sync-lock")) return json(res, 200, { busy: true });
  background((async () => {
    try {
      const pending = await service.bridge<string[]>("pending", {});
      await Promise.all([
        ...(pending.length ? [createProjectRepository(service, pending[0])] : []),
        syncGitHubPage(service), syncPRPage(service), ...tickJobs.map((job) => Promise.resolve().then(job)),
        mirrorUnlinkedPage(service).catch((error: unknown) => console.warn("GitHub issue mirroring skipped", error instanceof Error ? error.message : error)),
      ]);
    } finally { service.store.saveJob("sync-lock", "done"); }
  })());
  return json(res, 202, { accepted: true });
}

async function webhook(service: GitHubService, req: IncomingMessage, res: ServerResponse, json: Json) {
  const text = (status: number, message: string) => { res.writeHead(status, { "content-type": "text/plain" }); res.end(message); };
  const secret = appConfig(service)?.webhookSecret;
  if (!secret) return text(503, "Unavailable");
  let body: string;
  try { body = await readBoundedText(req, WEBHOOK_MAX_BYTES); }
  catch (error) { return text(error instanceof BodyTooLarge ? 413 : 400, error instanceof BodyTooLarge ? "Too large" : "Invalid body"); }
  const header = (name: string) => { const value = req.headers[name]; return typeof value === "string" ? value : ""; };
  if (!verifyGitHubSignature(body, header("x-hub-signature-256"), secret)) return text(401, "Unauthorized");
  const kind = header("x-github-event");
  if (!WEBHOOK_EVENTS.has(kind)) return json(res, 200, { accepted: true });
  let event;
  try { event = parseGitHubEvent(body, kind, header("x-github-delivery")); }
  catch { return text(400, "Invalid event"); }
  const { deliveryId, fingerprint } = event;
  try {
    const lease = await service.bridge<number | null>("githubDelivery", { deliveryId, fingerprint });
    if (lease === null) return json(res, 200, { accepted: true, duplicate: true });
    if (kind === "issues") await syncGitHubEvent(service, event.repoUrl, event.numbers[0]);
    else await syncPREvent(service, event.repoUrl, event.numbers, event.headSha);
    await service.bridge("githubDelivery", { deliveryId, fingerprint, finishLease: lease });
    return json(res, 200, { accepted: true });
  } catch { return json(res, 503, { error: "GitHub sync pending; retry delivery or reconcile" }); }
}
