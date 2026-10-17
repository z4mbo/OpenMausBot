import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { appJwt, installationToken, permissionNotice } from "./app.ts";
import { checksSummary, readPRSnapshot, taskBranch } from "./prs.ts";
import type { GitHubService } from "./service.ts";
import { createGitHubStore } from "./store.ts";
import { withoutControlCharacters } from "./sync.ts";

const NOW = Date.parse("2026-10-17T12:00:00Z");
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs1", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const folders: string[] = [];
const closers: (() => void)[] = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

type Reply = { status?: number; body?: unknown };

function service(routes: Record<string, (body: string) => Reply>) {
  const dir = mkdtempSync(join(tmpdir(), "omb-github-app-"));
  folders.push(dir);
  const store = createGitHubStore(dir, () => NOW);
  closers.push(() => store.close());
  const requests: string[] = [];
  const fetcher = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const key = `${init.method ?? "GET"} ${String(input)}`;
    requests.push(key);
    const route = routes[key];
    if (!route) return Response.json({}, { status: key.startsWith("DELETE") ? 204 : 404 });
    const reply = route(typeof init.body === "string" ? init.body : "");
    return Response.json(reply.body ?? {}, { status: reply.status ?? 200 });
  }) as typeof fetch;
  const github: GitHubService = {
    store, fetch: fetcher, now: () => NOW, publicUrl: () => "http://origin.test",
    env: { clientId: "cid", clientSecret: "cs", appId: 7, appPrivateKey: privateKey },
    convex: () => { throw new Error("no Convex in this test"); },
    bridge: async () => { throw new Error("no bridge in this test"); },
  };
  return { github, requests };
}

const installation = (permissions: Record<string, string>) => () => ({ body: { id: 99, account: { id: 42, login: "octo" }, permissions } });

describe("GitHub App credentials", () => {
  it("signs a JWT that lives at most ten minutes", () => {
    const { github } = service({});
    const [, payload] = appJwt(github).split(".");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as { iat: number; exp: number; iss: string };
    expect(claims.iss).toBe("7");
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(600);
  });

  it("asks for reapproval when the installation lacks PR permissions", async () => {
    const { github } = service({ "GET https://api.github.com/repos/acme/widgets/installation": installation({ contents: "read", pull_requests: "write", checks: "read" }) });
    await expect(installationToken(github, "https://github.com/acme/widgets")).rejects.toThrow(permissionNotice);
  });

  it("revokes a token scoped to an unexpected repository", async () => {
    const { github, requests } = service({
      "GET https://api.github.com/repos/acme/widgets/installation": installation({ contents: "write", pull_requests: "write", checks: "read" }),
      "POST https://api.github.com/app/installations/99/access_tokens": () => ({ status: 201, body: { token: "ghs_x", expires_at: new Date(NOW + 3_600_000).toISOString(), repositories: [{ full_name: "acme/other" }] } }),
    });
    await expect(installationToken(github, "https://github.com/acme/widgets")).rejects.toThrow("Unexpected installation token scope");
    expect(requests.at(-1)).toBe("DELETE https://api.github.com/installation/token");
  });

  it("refuses an installation owned by a different GitHub account", async () => {
    const { github } = service({ "GET https://api.github.com/repos/acme/widgets/installation": installation({ contents: "write", pull_requests: "write", checks: "read" }) });
    await expect(installationToken(github, "https://github.com/acme/widgets", false, { id: 1, login: "mallory" })).rejects.toThrow("does not belong");
  });
});

describe("PR snapshots", () => {
  const pr = (headSha: string) => ({
    number: 3, html_url: "https://github.com/acme/widgets/pull/3", node_id: "PR_1", state: "open", draft: false, updated_at: "2026-10-17T11:00:00Z",
    head: { ref: "origin/ORI-ABCD-task", sha: headSha, repo: { full_name: "acme/widgets" } }, base: { sha: "b".repeat(40), repo: { full_name: "acme/widgets" } },
  });

  it("refuses a snapshot whose head moved while checks were read", async () => {
    let reads = 0;
    const { github } = service({
      "GET https://api.github.com/repos/acme/widgets/pulls/3": () => ({ body: pr(reads++ === 0 ? "a".repeat(40) : "c".repeat(40)) }),
      [`GET https://api.github.com/repos/acme/widgets/commits/${"a".repeat(40)}/check-runs?filter=latest&per_page=100`]: () => ({ body: { total_count: 0, check_runs: [] } }),
      "POST https://api.github.com/graphql": () => ({ body: { data: { node: { reviewDecision: "APPROVED" } } } }),
    });
    await expect(readPRSnapshot(github, "https://github.com/acme/widgets", 3, "token")).rejects.toThrow("PR changed while synchronizing");
  });

  it("summarises check runs and names task branches", () => {
    expect(checksSummary([{ status: "completed", conclusion: "failure" }], true)).toBe("failure");
    expect(checksSummary([{ status: "completed", conclusion: "success" }], true)).toBe("unknown");
    expect(checksSummary([{ status: "queued", conclusion: null }], false)).toBe("pending");
    expect(checksSummary([], false)).toBe("none");
    expect(taskBranch({ _id: "k17abcd", title: "Fix the Login!" })).toBe("origin/ORI-ABCD-fix-the-login");
    expect(withoutControlCharacters("a\u0000\u0001b\u009fc")).toBe("a b c");
  });
});
