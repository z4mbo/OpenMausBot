import { execFile } from "node:child_process";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { OriginCloudClient, OriginCloudState } from "../origin-cloud.ts";
import { projectFolderState } from "../origin-project-folders.ts";
import { PASS, type PublicRouteHandler } from "../routes/table.ts";
import { pushToken } from "./app.ts";
import { loopbackGitHubOrigin } from "./broker.ts";
import { readBoundedText } from "./http-body.ts";
import { parseGitHubRepo, repoName } from "./repo.ts";
import type { GitHubService } from "./service.ts";

export const GIT_CREDENTIAL_ROUTE = "/api/origin/git-credential";
const CAPABILITY_HEADER = "x-origin-git";
const HELPER_KEY = "credential.https://github.com.helper";
const PROJECTS_TTL_MS = 60_000;
const TOKEN_MARGIN_MS = 5 * 60_000;

export type GitRun = (args: readonly string[], cwd: string) => Promise<{ ok: boolean; stdout: string }>;

export interface ProjectGitDeps {
  service(): GitHubService;
  cloud(): OriginCloudState;
  connect(url: string): OriginCloudClient;
  /** The port this server listens on, which the helper calls back on. */
  port: number;
  dataDir: string;
  /** The Node runtime git starts the helper with. */
  node?: string;
  git?: GitRun;
}

const runGit: GitRun = (args, cwd) => new Promise((resolve) => {
  execFile("git", [...args], { cwd, timeout: 10 * 60_000, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }, (error, stdout) => resolve({ ok: !error, stdout: String(stdout) }));
});

function helperSource(port: number, capability: string): string {
  return `const http = require("node:http");
if (process.argv[2] !== "get") process.exit(0);
let input = "";
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const fields = {};
  for (const line of input.split(/\\r?\\n/)) { const at = line.indexOf("="); if (at > 0) fields[line.slice(0, at)] = line.slice(at + 1); }
  if (fields.protocol !== "https" || fields.host !== "github.com" || !fields.path) process.exit(0);
  const body = JSON.stringify({ path: fields.path });
  const request = http.request({ host: "127.0.0.1", port: ${port}, path: ${JSON.stringify(GIT_CREDENTIAL_ROUTE)}, method: "POST", timeout: 30000,
    headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body), ${JSON.stringify(CAPABILITY_HEADER)}: ${JSON.stringify(capability)} } }, (response) => {
    let out = "";
    response.on("data", (chunk) => { out += chunk; });
    response.on("end", () => { if (response.statusCode === 200) process.stdout.write(out); process.exit(0); });
  });
  request.on("error", () => process.exit(0));
  request.on("timeout", () => { request.destroy(); process.exit(0); });
  request.end(body);
});
`;
}

const loopback = (address: string | undefined) => address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";

/**
 * Git access to each Origin project's repository from its folder on this computer. Git asks a credential helper that
 * calls this server back; the server answers with a short-lived contents-only token for that repository, so no token
 * ever reaches a prompt, a command line or a remote URL. Security: the helper proves itself with a capability that
 * lives in this server's data folder and changes on every start. Anything running as this person can read that file
 * and get the token for a linked project's repository, which agents can already push to through git.
 */
export function createProjectGit(deps: ProjectGitDeps) {
  const capability = randomBytes(32).toString("hex");
  const helperFile = join(deps.dataDir, "origin-git", "credential-helper.cjs");
  mkdirSync(join(deps.dataDir, "origin-git"), { recursive: true, mode: 0o700 });
  writeFileSync(helperFile, helperSource(deps.port, capability), { mode: 0o600 });
  const node = (deps.node ?? process.execPath).replace(/\\/g, "/");
  const helperCommand = `!ELECTRON_RUN_AS_NODE=1 "${node}" "${helperFile.replace(/\\/g, "/")}"`;
  const git = deps.git ?? runGit;
  const tokens = new Map<string, { token: string; expiresAt: string }>();
  let projects: { at: number; identity: string; byRepo: Map<string, { projectId: string; repoUrl: string }> } | null = null;
  const identity = () => {
    const { url, sessionToken } = deps.cloud();
    return createHash("sha256").update(`${url ?? ""}|${sessionToken ?? ""}`).digest("hex");
  };

  const linkedRepositories = async () => {
    const who = identity();
    if (projects && projects.identity === who && Date.now() - projects.at < PROJECTS_TTL_MS) return projects.byRepo;
    tokens.clear();
    const { url, sessionToken, projects: links } = deps.cloud();
    const byRepo = new Map<string, { projectId: string; repoUrl: string }>();
    if (url && sessionToken) {
      const client = deps.connect(url);
      await Promise.all([...new Set(Object.values(links))].map(async (projectId) => {
        const doc = await client.query("projects:get", { projectId, sessionToken }).catch(() => null) as { repoUrl?: unknown } | null;
        const repo = parseGitHubRepo(typeof doc?.repoUrl === "string" ? doc.repoUrl : null);
        if (repo) byRepo.set(repoName(repo), { projectId, repoUrl: `https://github.com/${repo.owner}/${repo.repo}` });
      }));
    }
    projects = { at: Date.now(), identity: who, byRepo };
    return byRepo;
  };

  const credentialFor = async (path: string): Promise<string | null> => {
    const repo = parseGitHubRepo(path.replace(/^\/+/, ""));
    const linked = repo ? (await linkedRepositories()).get(repoName(repo)) : undefined;
    if (!linked) return null;
    const key = `${identity()}:${linked.projectId}:${repoName(repo!)}`;
    const cached = tokens.get(key);
    const fresh = cached && Date.parse(cached.expiresAt) - Date.now() > TOKEN_MARGIN_MS ? cached : await pushToken(deps.service(), linked.projectId, linked.repoUrl);
    tokens.set(key, fresh);
    return `username=x-access-token\npassword=${fresh.token}\n`;
  };

  const routes: PublicRouteHandler = async ({ req, res, path, method }) => {
    if (path !== GIT_CREDENTIAL_ROUTE || method !== "POST") return PASS;
    const offered = Buffer.from(String(req.headers[CAPABILITY_HEADER] ?? ""));
    const expected = Buffer.from(capability);
    if (!loopback(req.socket.remoteAddress) || offered.length !== expected.length || !timingSafeEqual(offered, expected)) {
      res.writeHead(401, { "content-type": "text/plain" });
      return void res.end();
    }
    let answer: string | null = null;
    try {
      const body = JSON.parse(await readBoundedText(req, 2_000)) as { path?: unknown };
      answer = typeof body.path === "string" ? await credentialFor(body.path) : null;
    } catch (error) {
      console.warn("origin git credential:", error instanceof Error ? error.message : error);
    }
    res.writeHead(answer ? 200 : 404, { "content-type": "text/plain", "cache-control": "no-store" });
    res.end(answer ?? "");
  };

  const configure = async (folder: string) => {
    await git(["config", "--local", "--unset-all", HELPER_KEY], folder);
    for (const value of ["", helperCommand]) await git(["config", "--local", "--add", HELPER_KEY, value], folder);
    await git(["config", "--local", "credential.https://github.com.useHttpPath", "true"], folder);
  };

  const gitIdentity = async (): Promise<{ name: string; email: string } | null> => {
    const { url, sessionToken } = deps.cloud();
    if (!url || !sessionToken) return null;
    const found = await deps.connect(url).query("githubLinks:gitIdentity", { sessionToken }).catch(() => null) as { name?: unknown; email?: unknown } | null;
    const clean = (value: unknown) => (typeof value === "string" ? value.replace(/[\r\n<>]+/g, " ").trim() : "");
    const name = clean(found?.name), email = clean(found?.email);
    return name && email ? { name, email } : null;
  };

  /** Commits made in the folder carry this person's identity: their linked GitHub account's address, or their Origin one. */
  const sign = async (folder: string, who: { name: string; email: string } | null) => {
    if (!who) return;
    for (const [key, value] of [["user.name", who.name], ["user.email", who.email]] as const) {
      const current = await git(["config", "--local", "--get", key], folder);
      if (current.stdout.trim() !== value) await git(["config", "--local", key, value], folder);
    }
  };

  /** Gives each project folder git access to its repository, cloning into a folder that is still empty. */
  const prepare = async (folders: Record<string, string>) => {
    const byRepo = await linkedRepositories();
    const who = byRepo.size ? await gitIdentity() : null;
    for (const { projectId, repoUrl } of byRepo.values()) {
      const folder = folders[projectId];
      if (!folder) continue;
      const state = projectFolderState(folder);
      if (state.kind === "empty") {
        const source = `${repoUrl.replace("https://github.com", loopbackGitHubOrigin() ?? "https://github.com")}.git`;
        const cloned = await git(["-c", `${HELPER_KEY}=`, "-c", `${HELPER_KEY}=${helperCommand}`, "-c", "credential.https://github.com.useHttpPath=true", "clone", source, "."], folder);
        if (cloned.ok) {
          await configure(folder);
          await sign(folder, who);
        }
        continue;
      }
      if (state.kind !== "checkout") continue;
      const remote = await git(["remote", "get-url", "origin"], folder);
      const current = remote.ok ? parseGitHubRepo(remote.stdout.trim()) : null;
      const wanted = parseGitHubRepo(repoUrl);
      if (!current || !wanted || repoName(current) !== repoName(wanted)) continue;
      const helpers = await git(["config", "--local", "--get-all", HELPER_KEY], folder);
      if (!helpers.stdout.split("\n").includes(helperCommand)) await configure(folder);
      await sign(folder, who);
    }
  };

  return { routes, prepare, helperCommand, invalidate: () => { projects = null; tokens.clear(); } };
}

export type ProjectGit = ReturnType<typeof createProjectGit>;
