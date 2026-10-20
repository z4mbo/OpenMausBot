// An in-memory GitHub REST API for the shared-integration tests and fixtures:
// one App, its installations, user and installation tokens with GitHub's
// scoping rules, repositories, issues and pull requests. It runs on WebCrypto
// alone, so the edge-runtime Convex tests and a Node fixture server share it.

type Json = Record<string, unknown>;
export type Permissions = Record<string, string>;

export interface FakeRepository {
  id: number; owner: string; name: string; private: boolean; description: string; issues: FakeIssue[]; pulls: FakePull[]; collaborators: Map<string, string>;
  /** Branch name to head commit; every repository starts with `main`. */
  branches: Map<string, string>;
  /** Branch protection as Origin last set it, by branch. */
  protection: Map<string, Json>;
}
export interface FakeIssue { number: number; title: string; body: string; state: "open" | "closed"; updated_at: string; author: string }
export interface FakePull { number: number; title: string; body: string; state: "open" | "closed"; draft: boolean; merged: boolean; merged_at: string | null; merge_commit_sha: string | null; head: { ref: string; sha: string }; base: { ref: string; sha: string }; author?: string; reviews?: { login: string; state: string }[]; updated_at?: string }
interface Installation { id: number; account: { id: number; login: string; type: "User" | "Organization" } }
interface IssuedToken { kind: "installation"; installationId: number; repositories: string[] | null; permissions: Permissions; expiresAt: number }
interface UserToken { kind: "user"; login: string; id: number; refresh?: string }

export interface FakeGitHub {
  readonly appId: number;
  readonly privateKeyPem: string;
  readonly slug: string;
  repos: Map<string, FakeRepository>;
  calls: { method: string; path: string; body: Json | null; token: string | null }[];
  /** Commits written through the contents API, with who wrote them. */
  commits: { repo: string; branch: string; message: string; author: string }[];
  user(login: string, id: number): string;
  install(login: string, id: number, type?: "User" | "Organization"): number;
  addRepository(owner: string, name: string, options?: { private?: boolean; description?: string }): FakeRepository;
  /** Accounts on a paid plan, where private repositories can have branch protection. */
  paid: Set<string>;
  /** A person finishing GitHub's device sign-in for the code Origin showed them. */
  approveDevice(userCode: string, login: string, id: number): void;
  /** The permissions and repositories an issued installation token carries. */
  tokenScope(token: string): { repositories: string[] | null; permissions: Permissions } | null;
  handle(request: Request): Promise<Response>;
}

const base64url = (bytes: Uint8Array) => btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join("")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromBase64url = (text: string) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));
const random = (prefix: string) => `${prefix}${base64url(crypto.getRandomValues(new Uint8Array(24))).replace(/[^A-Za-z0-9]/g, "x")}`;
const sha = () => Array.from(crypto.getRandomValues(new Uint8Array(20)), (byte) => byte.toString(16).padStart(2, "0")).join("");

/** The same RSA key as PKCS#1 PEM, which is what GitHub hands out for an App. */
function pkcs1Pem(pkcs8: Uint8Array): string {
  let offset = 0;
  const length = () => {
    const first = pkcs8[offset++];
    if (first < 0x80) return first;
    let value = 0;
    for (let i = 0; i < (first & 0x7f); i++) value = (value << 8) | pkcs8[offset++];
    return value;
  };
  const skip = () => { const size = length(); offset += size; };
  offset++; length();
  offset++; skip();
  offset++; skip();
  offset++;
  const size = length();
  const body = btoa(Array.from(pkcs8.subarray(offset, offset + size), (byte) => String.fromCharCode(byte)).join(""));
  return `-----BEGIN RSA PRIVATE KEY-----\n${body.match(/.{1,64}/g)!.join("\n")}\n-----END RSA PRIVATE KEY-----\n`;
}

export async function createFakeGitHub(options: { appId?: number; slug?: string; clientId?: string; clientSecret?: string } = {}): Promise<FakeGitHub> {
  const appId = options.appId ?? 4242;
  const slug = options.slug ?? "origin-workspace";
  const keys = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const privateKeyPem = pkcs1Pem(new Uint8Array(await crypto.subtle.exportKey("pkcs8", keys.privateKey)));
  const users = new Map<string, number>();
  const installations = new Map<number, Installation>();
  const tokens = new Map<string, IssuedToken | UserToken>();
  const repos = new Map<string, FakeRepository>();
  const calls: FakeGitHub["calls"] = [];
  const commits: FakeGitHub["commits"] = [];
  const devices = new Map<string, { userCode: string; approved?: { login: string; id: number } }>();
  let nextId = 1000;

  const verifyJwt = async (token: string) => {
    const [header, payload, signature] = token.split(".");
    if (!signature) return false;
    const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", keys.publicKey, fromBase64url(signature), new TextEncoder().encode(`${header}.${payload}`));
    const claims = JSON.parse(new TextDecoder().decode(fromBase64url(payload))) as { iss?: string; exp?: number };
    return valid && claims.iss === String(appId) && (claims.exp ?? 0) * 1000 > Date.now();
  };

  const reply = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const repoJson = (repo: FakeRepository) => ({ id: repo.id, name: repo.name, full_name: `${repo.owner}/${repo.name}`, html_url: `https://github.com/${repo.owner}/${repo.name}`, description: repo.description, owner: { login: repo.owner }, private: repo.private, default_branch: "main" });
  const issueJson = (repo: FakeRepository, issue: FakeIssue) => ({ ...issue, html_url: `https://github.com/${repo.owner}/${repo.name}/issues/${issue.number}`, user: { login: issue.author } });
  const pullJson = (repo: FakeRepository, pull: FakePull) => ({
    ...pull, user: { login: pull.author ?? `${slug}[bot]` }, html_url: `https://github.com/${repo.owner}/${repo.name}/pull/${pull.number}`, node_id: `PR_${pull.number}`, updated_at: pull.updated_at ?? new Date().toISOString(), mergeable: true,
    head: { ...pull.head, repo: { full_name: `${repo.owner}/${repo.name}` } }, base: { ...pull.base, repo: { full_name: `${repo.owner}/${repo.name}` } },
  });

  const repoAccess = (token: IssuedToken | UserToken | undefined, repo: FakeRepository, permission: string, level: "read" | "write") => {
    if (!token) return !repo.private && level === "read";
    if (token.kind === "user") return token.login.toLowerCase() === repo.owner.toLowerCase() || (repo.collaborators.has(token.login.toLowerCase()) && (level === "read" || repo.collaborators.get(token.login.toLowerCase()) !== "pull"));
    if (token.expiresAt < Date.now()) return false;
    const installation = installations.get(token.installationId);
    if (installation?.account.login.toLowerCase() !== repo.owner.toLowerCase()) return false;
    if (token.repositories && !token.repositories.includes(repo.name.toLowerCase())) return false;
    if (permission === "metadata" && level === "read") return true;
    const granted = token.permissions[permission];
    return level === "read" ? granted === "read" || granted === "write" : granted === "write";
  };

  const actor = (token: IssuedToken | UserToken | undefined) => (token?.kind === "user" ? token.login : `${slug}[bot]`);
  const denied = () => reply(403, { message: "Resource not accessible by integration" });
  const fake: FakeGitHub = {
    appId, privateKeyPem, slug, repos, calls, commits, paid: new Set(),
    user(login, id) {
      users.set(login.toLowerCase(), id);
      const token = random("ghu_");
      tokens.set(token, { kind: "user", login, id, refresh: random("ghr_") });
      return token;
    },
    install(login, id, type = "User") {
      const installationId = nextId++;
      installations.set(installationId, { id: installationId, account: { id, login, type } });
      return installationId;
    },
    addRepository(owner, name, extra = {}) {
      const repo: FakeRepository = { id: nextId++, owner, name, private: extra.private ?? true, description: extra.description ?? "", issues: [], pulls: [], collaborators: new Map(), branches: new Map([["main", sha()]]), protection: new Map() };
      repos.set(`${owner}/${name}`.toLowerCase(), repo);
      return repo;
    },
    approveDevice(userCode, login, id) {
      for (const device of devices.values()) if (device.userCode === userCode) device.approved = { login, id };
    },
    tokenScope(token) {
      const issued = tokens.get(token);
      return issued?.kind === "installation" ? { repositories: issued.repositories, permissions: issued.permissions } : null;
    },
    async handle(request) {
      const url = new URL(request.url);
      const path = url.pathname;
      const method = request.method.toUpperCase();
      const text = method === "GET" ? "" : await request.text();
      const body = text ? JSON.parse(text) as Json : null;
      const bearer = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? null;
      calls.push({ method, path: `${path}${url.search}`, body, token: bearer });
      const token = bearer ? tokens.get(bearer) : undefined;
      if (bearer && !token && !bearer.startsWith("eyJ")) return reply(401, { message: "Bad credentials" });

      if (method === "POST" && path === "/login/device/code") {
        const deviceCode = random("dc_");
        const userCode = `${random("").slice(0, 4).toUpperCase()}-${String(nextId++).slice(-4)}`;
        devices.set(deviceCode, { userCode });
        return reply(200, { device_code: deviceCode, user_code: userCode, verification_uri: "https://github.com/login/device", expires_in: 900, interval: 5 });
      }
      if (method === "POST" && path === "/login/oauth/access_token" && body?.grant_type === "urn:ietf:params:oauth:grant-type:device_code") {
        const device = devices.get(String(body.device_code));
        if (!device) return reply(200, { error: "expired_token" });
        if (!device.approved) return reply(200, { error: "authorization_pending" });
        devices.delete(String(body.device_code));
        users.set(device.approved.login.toLowerCase(), device.approved.id);
        const issued = random("ghu_");
        tokens.set(issued, { kind: "user", login: device.approved.login, id: device.approved.id, refresh: random("ghr_") });
        return reply(200, { access_token: issued, token_type: "bearer" });
      }
      if (method === "DELETE" && /^\/applications\/[^/]+\/token$/.test(path)) {
        tokens.delete(String(body?.access_token ?? ""));
        return reply(204);
      }
      if (method === "POST" && path === "/login/oauth/access_token") {
        const entry = [...tokens.entries()].find(([, value]) => value.kind === "user" && value.refresh === body?.refresh_token);
        if (!entry) return reply(200, { error: "bad_refresh_token" });
        const user = entry[1] as UserToken;
        tokens.delete(entry[0]);
        const next = random("ghu_");
        tokens.set(next, { ...user, refresh: random("ghr_") });
        return reply(200, { access_token: next, refresh_token: (tokens.get(next) as UserToken).refresh, expires_in: 28_800 });
      }
      if (path.startsWith("/app/") || /^\/users\/[^/]+\/installation$/.test(path) || /^\/repos\/[^/]+\/[^/]+\/installation$/.test(path)) {
        if (!bearer || !await verifyJwt(bearer)) return reply(401, { message: "A JSON web token could not be decoded" });
        const user = /^\/users\/([^/]+)\/installation$/.exec(path)?.[1];
        if (user) {
          const found = [...installations.values()].find((row) => row.account.login.toLowerCase() === decodeURIComponent(user).toLowerCase());
          return found ? reply(200, { ...found, suspended_at: null, app_slug: slug, permissions: { administration: "write", issues: "write", contents: "write", pull_requests: "write", checks: "read", actions: "write" } }) : reply(404, { message: "Not Found" });
        }
        const owner = /^\/repos\/([^/]+)\/([^/]+)\/installation$/.exec(path);
        if (owner) {
          const found = repos.has(`${decodeURIComponent(owner[1])}/${decodeURIComponent(owner[2])}`.toLowerCase()) ? [...installations.values()].find((row) => row.account.login.toLowerCase() === decodeURIComponent(owner[1]).toLowerCase()) : undefined;
          return found ? reply(200, { ...found, suspended_at: null, app_slug: slug, permissions: { administration: "write", issues: "write", contents: "write", pull_requests: "write", checks: "read", actions: "write" } }) : reply(404, { message: "Not Found" });
        }
        const minted = /^\/app\/installations\/(\d+)\/access_tokens$/.exec(path);
        if (minted && method === "POST") {
          const installation = installations.get(Number(minted[1]));
          if (!installation) return reply(404, { message: "Not Found" });
          const names = Array.isArray(body?.repositories) ? (body!.repositories as string[]).map((name) => name.toLowerCase()) : null;
          if (names?.some((name) => !repos.has(`${installation.account.login}/${name}`.toLowerCase()))) return reply(422, { message: "There is at least one repository that does not exist or is not accessible" });
          const issued = random("ghs_");
          const expiresAt = Date.now() + 60 * 60_000;
          tokens.set(issued, { kind: "installation", installationId: installation.id, repositories: names, permissions: (body?.permissions as Permissions) ?? {}, expiresAt });
          return reply(201, { token: issued, expires_at: new Date(expiresAt).toISOString(), ...(names ? { repositories: names.map((name) => ({ full_name: `${installation.account.login}/${repos.get(`${installation.account.login}/${name}`)!.name}` })) } : {}) });
        }
        if (path === "/app") return reply(200, { id: appId, slug });
        return reply(404, { message: "Not Found" });
      }
      if (method === "DELETE" && path === "/installation/token") {
        if (bearer) tokens.delete(bearer);
        return reply(204);
      }
      if (method === "GET" && path === "/user") return token?.kind === "user" ? reply(200, { id: token.id, login: token.login }) : reply(401, { message: "Requires authentication" });
      if (method === "GET" && path === "/user/installations") {
        if (token?.kind !== "user") return reply(401, { message: "Requires authentication" });
        return reply(200, { installations: [...installations.values()].map((row) => ({ ...row, app_slug: slug, suspended_at: null, permissions: { administration: "write" } })) });
      }
      if (method === "GET" && path === "/user/repos") {
        if (token?.kind !== "user") return reply(401, { message: "Requires authentication" });
        return reply(200, [...repos.values()].filter((repo) => repoAccess(token, repo, "metadata", "read")).map(repoJson));
      }
      const create = path === "/user/repos" ? token?.kind === "user" ? token.login : null : /^\/orgs\/([^/]+)\/repos$/.exec(path)?.[1];
      if (method === "POST" && create !== undefined) {
        if (!create) return reply(403, { message: "Resource not accessible by integration" });
        const owner = decodeURIComponent(create);
        if (path.startsWith("/orgs/")) {
          const installation = token?.kind === "installation" ? installations.get(token.installationId) : undefined;
          if (installation?.account.login.toLowerCase() !== owner.toLowerCase() || token?.kind !== "installation" || token.permissions.administration !== "write") return reply(403, { message: "Resource not accessible by integration" });
        }
        const name = String(body?.name ?? "");
        if (repos.has(`${owner}/${name}`.toLowerCase())) return reply(422, { message: "Repository creation failed.", errors: [{ field: "name", message: "name already exists on this account" }] });
        const repo = fake.addRepository(owner, name, { private: body?.private !== false, description: String(body?.description ?? "") });
        return reply(201, repoJson(repo));
      }
      if (method === "POST" && path === "/graphql") return reply(200, { data: { node: { reviewDecision: null }, repository: { pullRequest: { closingIssuesReferences: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } } } });

      const match = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(path);
      if (!match) return reply(404, { message: "Not Found" });
      const repo = repos.get(`${decodeURIComponent(match[1])}/${decodeURIComponent(match[2])}`.toLowerCase());
      const rest = match[3] ?? "";
      if (!repo || !repoAccess(token, repo, "metadata", "read") && !repoAccess(token, repo, "contents", "read") && !repoAccess(token, repo, "issues", "read")) return reply(404, { message: "Not Found" });
      if (method === "GET" && rest === "") return reply(200, repoJson(repo));
      const collaborator = /^\/collaborators\/([^/]+)$/.exec(rest);
      if (rest === "/invitations" && method === "GET") return reply(200, []);
      if (collaborator && method === "DELETE") {
        if (!repoAccess(token, repo, "administration", "write")) return reply(403, { message: "Resource not accessible by integration" });
        repo.collaborators.delete(decodeURIComponent(collaborator[1]).toLowerCase());
        return reply(204);
      }
      if (collaborator && method === "PUT") {
        if (!repoAccess(token, repo, "administration", "write")) return reply(403, { message: "Resource not accessible by integration" });
        repo.collaborators.set(decodeURIComponent(collaborator[1]).toLowerCase(), String(body?.permission ?? "push"));
        return reply(201, { id: nextId++ });
      }
      if (rest === "/issues" && method === "POST") {
        if (!repoAccess(token, repo, "issues", "write")) return reply(403, { message: "Resource not accessible by integration" });
        const issue: FakeIssue = { number: repo.issues.length + repo.pulls.length + 1, title: String(body?.title ?? ""), body: String(body?.body ?? ""), state: "open", updated_at: new Date().toISOString(), author: token?.kind === "user" ? token.login : `${slug}[bot]` };
        repo.issues.push(issue);
        return reply(201, issueJson(repo, issue));
      }
      if (rest === "/issues" && method === "GET") return reply(200, repo.issues.map((issue) => issueJson(repo, issue)).reverse());
      const issueMatch = /^\/issues\/(\d+)$/.exec(rest);
      if (issueMatch) {
        const issue = repo.issues.find((candidate) => candidate.number === Number(issueMatch[1]));
        if (!issue) return reply(404, { message: "Not Found" });
        if (method === "PATCH") {
          if (!repoAccess(token, repo, "issues", "write")) return reply(403, { message: "Resource not accessible by integration" });
          if (body?.state === "open" || body?.state === "closed") issue.state = body.state;
          issue.updated_at = new Date(Date.now() + 1000).toISOString();
        }
        return reply(200, issueJson(repo, issue));
      }
      if (/^\/issues\/\d+\/comments$/.test(rest) && method === "POST") return reply(201, { id: nextId++ });
      if (rest === "/pulls" && method === "GET") return reply(200, repo.pulls.map((pull) => pullJson(repo, pull)));
      if (rest === "/pulls" && method === "POST") {
        if (!repoAccess(token, repo, "pull_requests", "write")) return denied();
        const head = String(body?.head ?? ""), base = String(body?.base ?? "");
        if (!repo.branches.has(head) || !repo.branches.has(base)) return reply(422, { message: "Validation Failed", errors: [{ field: "head", code: "invalid" }] });
        const pull: FakePull = { number: repo.issues.length + repo.pulls.length + 1, title: String(body?.title ?? ""), body: String(body?.body ?? ""), state: "open", draft: body?.draft === true, merged: false, merged_at: null, merge_commit_sha: null, head: { ref: head, sha: repo.branches.get(head)! }, base: { ref: base, sha: repo.branches.get(base)! }, author: actor(token), reviews: [], updated_at: new Date().toISOString() };
        repo.pulls.push(pull);
        return reply(201, pullJson(repo, pull));
      }
      const branchRef = /^\/git\/refs?\/heads\/(.+)$/.exec(rest);
      if (branchRef && method === "GET") {
        const branch = decodeURIComponent(branchRef[1]);
        return repo.branches.has(branch) ? reply(200, { ref: `refs/heads/${branch}`, object: { sha: repo.branches.get(branch) } }) : reply(404, { message: "Not Found" });
      }
      if (branchRef && method === "PATCH") {
        const branch = decodeURIComponent(branchRef[1]);
        if (!repoAccess(token, repo, "contents", "write")) return denied();
        if (repo.protection.has(branch)) return reply(422, { message: "Protected branch update failed" });
        repo.branches.set(branch, String(body?.sha ?? sha()));
        return reply(200, { ref: `refs/heads/${branch}`, object: { sha: repo.branches.get(branch) } });
      }
      if (rest === "/git/refs" && method === "POST") {
        if (!repoAccess(token, repo, "contents", "write")) return denied();
        const branch = String(body?.ref ?? "").replace(/^refs\/heads\//, "");
        if (repo.branches.has(branch)) return reply(422, { message: "Reference already exists" });
        repo.branches.set(branch, String(body?.sha ?? sha()));
        return reply(201, { ref: `refs/heads/${branch}`, object: { sha: repo.branches.get(branch) } });
      }
      const contents = /^\/contents\/(.+)$/.exec(rest);
      if (contents && method === "GET") return reply(404, { message: "Not Found" });
      if (contents && method === "PUT") {
        if (!repoAccess(token, repo, "contents", "write")) return denied();
        const branch = String(body?.branch ?? "main");
        if (!repo.branches.has(branch)) return reply(404, { message: "Branch not found" });
        if (repo.protection.has(branch)) return reply(409, { message: "Changes must be made through a pull request." });
        const commit = sha();
        repo.branches.set(branch, commit);
        for (const pull of repo.pulls) if (pull.head.ref === branch && pull.state === "open") pull.head.sha = commit;
        commits.push({ repo: `${repo.owner}/${repo.name}`, branch, message: String(body?.message ?? ""), author: actor(token) });
        return reply(201, { commit: { sha: commit } });
      }
      const protection = /^\/branches\/([^/]+)\/protection$/.exec(rest);
      if (protection) {
        const branch = decodeURIComponent(protection[1]);
        if (!repoAccess(token, repo, "administration", method === "GET" ? "read" : "write")) return denied();
        if (repo.private && !fake.paid.has(repo.owner.toLowerCase())) return reply(403, { message: "Upgrade to GitHub Pro or make this repository public to enable this feature." });
        if (method === "PUT") repo.protection.set(branch, body ?? {});
        return repo.protection.has(branch) ? reply(200, { url: `https://api.github.com/repos/${repo.owner}/${repo.name}/branches/${branch}/protection`, ...repo.protection.get(branch) }) : reply(404, { message: "Branch not protected" });
      }
      const reviews = /^\/pulls\/(\d+)\/reviews$/.exec(rest);
      const reviewed = reviews ? repo.pulls.find((candidate) => candidate.number === Number(reviews[1])) : undefined;
      if (reviews && method === "GET") return reviewed ? reply(200, (reviewed.reviews ?? []).map((row) => ({ user: { login: row.login }, state: row.state }))) : reply(404, { message: "Not Found" });
      if (reviews && method === "POST") {
        if (!reviewed) return reply(404, { message: "Not Found" });
        if (!repoAccess(token, repo, "pull_requests", "write")) return denied();
        const event = String(body?.event ?? "COMMENT");
        if (event === "APPROVE" && reviewed.author === actor(token)) return reply(422, { message: "Unprocessable Entity", errors: ["Can not approve your own pull request"] });
        (reviewed.reviews ??= []).push({ login: actor(token), state: event === "APPROVE" ? "APPROVED" : event === "REQUEST_CHANGES" ? "CHANGES_REQUESTED" : "COMMENTED" });
        return reply(200, { id: nextId++ });
      }
      if (/^\/pulls\/\d+\/files$/.test(rest)) return reply(200, []);
      const merge = /^\/pulls\/(\d+)\/merge$/.exec(rest);
      if (merge && method === "PUT") {
        const pull = repo.pulls.find((candidate) => candidate.number === Number(merge[1]));
        if (!pull) return reply(404, { message: "Not Found" });
        if (!repoAccess(token, repo, "contents", "write")) return denied();
        const rule = repo.protection.get(pull.base.ref) as { required_pull_request_reviews?: { required_approving_review_count?: number } } | undefined;
        const approvals = new Set((pull.reviews ?? []).filter((row) => row.state === "APPROVED" && row.login !== pull.author).map((row) => row.login)).size;
        if (rule && approvals < (rule.required_pull_request_reviews?.required_approving_review_count ?? 0)) return reply(405, { message: "At least 1 approving review is required by reviewers with write access." });
        if (body?.sha && body.sha !== pull.head.sha) return reply(409, { message: "Head branch was modified" });
        const commit = sha();
        Object.assign(pull, { state: "closed", merged: true, merged_at: new Date().toISOString(), merge_commit_sha: commit, updated_at: new Date(Date.now() + 1000).toISOString() });
        repo.branches.set(pull.base.ref, commit);
        return reply(200, { sha: commit, merged: true, message: "Pull Request successfully merged" });
      }
      const pullMatch = /^\/pulls\/(\d+)$/.exec(rest);
      if (pullMatch && method === "GET") {
        const pull = repo.pulls.find((candidate) => candidate.number === Number(pullMatch[1]));
        return pull ? reply(200, pullJson(repo, pull)) : reply(404, { message: "Not Found" });
      }
      if (/^\/commits\/[a-f0-9]+\/check-runs$/.test(rest)) return reply(200, { total_count: 0, check_runs: [] });
      if (rest === "/commits") return reply(200, []);
      return reply(404, { message: "Not Found" });
    },
  };
  return fake;
}

/** Adds a merged pull request that closes `issue`, as GitHub records it after a merge. */
export function mergedPull(repo: FakeRepository, issue: number): FakePull {
  const pull: FakePull = { number: repo.issues.length + repo.pulls.length + 1, title: "Work", body: `Closes #${issue}`, state: "closed", draft: false, merged: true, merged_at: new Date().toISOString(), merge_commit_sha: sha(), head: { ref: "work", sha: sha() }, base: { ref: "main", sha: sha() } };
  repo.pulls.push(pull);
  return pull;
}
