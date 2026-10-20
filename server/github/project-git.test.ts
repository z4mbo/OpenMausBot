import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { json, readBody } from "../harness/http.ts";
import type { OriginCloudClient } from "../origin-cloud.ts";
import { dispatchRoutes } from "../routes/table.ts";
import { createProjectGit, GIT_CREDENTIAL_ROUTE, type GitRun } from "./project-git.ts";
import type { GitHubService } from "./service.ts";
import { createGitHubStore } from "./store.ts";

const folders: string[] = [];
const servers: Server[] = [];
const closers: (() => void)[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  for (const close of closers.splice(0)) close();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

const temp = (name: string) => {
  const dir = mkdtempSync(join(tmpdir(), `omb-project-git-${name}-`));
  folders.push(dir);
  return dir;
};

const PROJECTS: Record<string, string> = { p1: "https://github.com/octo/app", p2: "https://github.com/octo/other" };
const TOKEN = `ghs_${"a".repeat(36)}`;

function harness(options: { port?: number; git?: GitRun } = {}) {
  const dataDir = temp("data");
  const store = createGitHubStore(join(dataDir, "github"));
  closers.push(() => store.close());
  const minted: unknown[] = [];
  const service = {
    store, env: {}, fetch, now: Date.now, publicUrl: () => undefined,
    convex: () => { throw new Error("unused"); },
    bridge: async (operation: string, args: unknown) => {
      minted.push({ operation, args });
      return { token: TOKEN, expiresAt: new Date(Date.now() + 3_600_000).toISOString(), repoUrl: PROJECTS[(args as { projectId: string }).projectId] };
    },
  } as unknown as GitHubService;
  const client = { query: async (_name: string, args: Record<string, unknown>) => ({ repoUrl: PROJECTS[String(args.projectId)] }), mutation: async () => null } as OriginCloudClient;
  const git = createProjectGit({
    service: () => service, connect: () => client, port: options.port ?? 1, dataDir, ...(options.git ? { git: options.git } : {}),
    cloud: () => ({ url: "http://convex.test", sessionToken: "s".repeat(64), projects: { bot1: "p1" } }),
  });
  return { git, minted, dataDir };
}

async function serve(routes: ReturnType<typeof createProjectGit>["routes"]): Promise<number> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    void dispatchRoutes([routes], { req, res, url, path: url.pathname, method: req.method ?? "GET", json, readBody }).then((done) => { if (!done) { res.writeHead(404); res.end(); } });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as { port: number }).port;
}

describe("git access to a project's repository", () => {
  it("answers git's credential helper only for a linked repository and only with the capability", async () => {
    let port = 0;
    const holder = { routes: null as null | ReturnType<typeof createProjectGit>["routes"] };
    port = await serve(async (ctx) => holder.routes!(ctx));
    const { git, minted } = harness({ port });
    holder.routes = git.routes;
    const post = (headers: Record<string, string>, path: string) => fetch(`http://127.0.0.1:${port}${GIT_CREDENTIAL_ROUTE}`, { method: "POST", headers, body: JSON.stringify({ path }) });
    expect((await post({}, "octo/app.git")).status).toBe(401);
    expect((await post({ "x-origin-git": "f".repeat(64) }, "octo/app.git")).status).toBe(401);

    const repo = temp("checkout");
    execFileSync("git", ["init", "-q"], { cwd: repo });
    execFileSync("git", ["remote", "add", "origin", "https://github.com/octo/app.git"], { cwd: repo });
    await git.prepare({ p1: repo });
    const fill = (path: string) => new Promise<{ stdout: string }>((resolve) => {
      const child = spawn("git", ["credential", "fill"], { cwd: repo, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
      let stdout = "";
      child.stdout.on("data", (chunk) => { stdout += String(chunk); });
      child.on("close", () => resolve({ stdout }));
      child.stdin.end(`protocol=https\nhost=github.com\npath=${path}\n\n`);
    });
    const answered = await fill("octo/app.git");
    expect(answered.stdout).toContain(`password=${TOKEN}`);
    expect(answered.stdout).toContain("username=x-access-token");
    expect(minted).toEqual([{ operation: "githubToken", args: { projectId: "p1", access: "push" } }]);
    expect((await fill("octo/app.git")).stdout).toContain(`password=${TOKEN}`);
    expect(minted).toHaveLength(1);
    expect((await fill("someone/else.git")).stdout).not.toContain("password=");
    const config = execFileSync("git", ["config", "--local", "--get-all", "credential.https://github.com.helper"], { cwd: repo, encoding: "utf8" });
    expect(config.split("\n")[0]).toBe("");
    expect(config).not.toContain(TOKEN);
  });

  it("clones into an empty project folder and leaves a checkout of another repository alone", async () => {
    const calls: { args: readonly string[]; cwd: string }[] = [];
    const git: GitRun = async (args, cwd) => { calls.push({ args, cwd }); return { ok: true, stdout: args[0] === "remote" ? "https://github.com/someone/else.git\n" : "" }; };
    const { git: projectGit } = harness({ git });
    const empty = temp("empty");
    await projectGit.prepare({ p1: empty });
    const clone = calls.find((call) => call.args.includes("clone"));
    expect(clone?.args.slice(-2)).toEqual(["https://github.com/octo/app.git", "."]);
    expect(clone?.args.join(" ")).not.toContain("ghs_");
    expect(calls.some((call) => call.args.includes("--add"))).toBe(true);

    calls.length = 0;
    const other = temp("other");
    mkdirSync(join(other, ".git"));
    writeFileSync(join(other, ".git", "HEAD"), "ref: refs/heads/main\n");
    await projectGit.prepare({ p1: other });
    expect(calls.map((call) => call.args[0])).toEqual(["remote"]);
  });
});
