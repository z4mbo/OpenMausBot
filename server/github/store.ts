import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type GitHubAppConfig = { clientId: string; clientSecret: string; slug?: string; webhookSecret?: string; appId?: number; privateKey?: string };
export type TokenRecord = { access_token: string; refresh_token?: string; expires_at?: number };
export type WorkspaceConnection = { team: string; login: string; account_id: number; connected_by: string };
export type GithubState = {
  teamId: string;
  sessionToken: string;
  userId: string;
  slug: string;
  mode: "connect" | "setup";
  verifier: string;
  installationAttempted?: boolean;
  projectId?: string;
};
export type GithubJob = { state: string; payload: string | null; updated: number };
export type BrowserTicket = { state: string; browser: string; mode: GithubState["mode"] };

const STATE_TTL_MS = 15 * 60_000;
const JOB_LEASE_MS = 90_000;

export const hashSecret = (value: string) => createHash("sha256").update(value).digest("hex");

/**
 * Security: tokens, App credentials and OAuth states are sealed with AES-256-GCM under a key file that never leaves
 * `dir`; each value's purpose is bound as associated data, so a ciphertext cannot be replayed into another row.
 */
export function createGitHubStore(dir: string, now: () => number = Date.now) {
  let database: DatabaseSync | undefined;
  let key: Buffer | undefined;

  const db = () => {
    if (database) return database;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    database = new DatabaseSync(join(dir, "integrations.sqlite"));
    database.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS github_connections (project TEXT PRIMARY KEY, repo TEXT NOT NULL, login TEXT NOT NULL, encrypted TEXT NOT NULL, connected_by TEXT NOT NULL, updated INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS github_workspace (team TEXT PRIMARY KEY, login TEXT NOT NULL, account_id INTEGER NOT NULL, connected_by TEXT NOT NULL, encrypted TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS github_app (id INTEGER PRIMARY KEY CHECK(id=1), encrypted TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS github_oauth_states (hash TEXT PRIMARY KEY, browser_hash TEXT NOT NULL, encrypted TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS github_tickets (hash TEXT PRIMARY KEY, encrypted TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS github_jobs (key TEXT PRIMARY KEY, state TEXT NOT NULL, payload TEXT, updated INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS request_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);`);
    return database;
  };

  const sealKey = () => {
    if (key) return key;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = join(dir, "integrations.key");
    try { writeFileSync(file, randomBytes(32), { flag: "wx", mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    const value = readFileSync(file);
    if (value.length !== 32) throw new Error("GitHub connection storage is unavailable");
    key = value;
    return key;
  };

  const seal = (value: string, purpose: string) => {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", sealKey(), iv);
    cipher.setAAD(Buffer.from(purpose));
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
  };

  const open = (value: string, purpose: string) => {
    const data = Buffer.from(value, "base64");
    const decipher = createDecipheriv("aes-256-gcm", sealKey(), data.subarray(0, 12));
    decipher.setAAD(Buffer.from(purpose));
    decipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8");
  };

  const statePurpose = (state: string) => `github-state:${hashSecret(state)}`;

  return {
    saveConnection(project: string, repo: string, login: string, token: string, connectedBy: string) {
      db().prepare("INSERT INTO github_connections VALUES(?,?,?,?,?,?) ON CONFLICT(project) DO UPDATE SET repo=excluded.repo,login=excluded.login,encrypted=excluded.encrypted,connected_by=excluded.connected_by,updated=excluded.updated")
        .run(project, repo, login, seal(token, `${project}:${repo}`), connectedBy, now());
    },
    connectionInfo(project: string, repo: string) {
      const row = db().prepare("SELECT login,updated,connected_by FROM github_connections WHERE project=? AND repo=?").get(project, repo) as { login: string; updated: number; connected_by: string } | undefined;
      return row ? { login: row.login, updatedAt: row.updated, connectedBy: row.connected_by } : null;
    },
    connectionToken(project: string, repo: string) {
      const row = db().prepare("SELECT encrypted FROM github_connections WHERE project=? AND repo=?").get(project, repo) as { encrypted: string } | undefined;
      return row ? open(row.encrypted, `${project}:${repo}`) : undefined;
    },
    deleteConnection(project: string) { db().prepare("DELETE FROM github_connections WHERE project=?").run(project); },

    savedApp(): GitHubAppConfig | null {
      const row = db().prepare("SELECT encrypted FROM github_app WHERE id=1").get() as { encrypted: string } | undefined;
      return row ? JSON.parse(open(row.encrypted, "github-app")) as GitHubAppConfig : null;
    },
    saveApp(config: GitHubAppConfig) {
      db().prepare("INSERT INTO github_app VALUES(1,?) ON CONFLICT(id) DO UPDATE SET encrypted=excluded.encrypted").run(seal(JSON.stringify(config), "github-app"));
    },

    workspaceInfo(team: string): WorkspaceConnection | null {
      return (db().prepare("SELECT team,login,account_id,connected_by FROM github_workspace WHERE team=?").get(team) as WorkspaceConnection | undefined) ?? null;
    },
    /** The sealed token row, compared by value to detect a reconnect during a refresh. */
    workspaceSealed(team: string, connectedBy: string) {
      const row = db().prepare("SELECT * FROM github_workspace WHERE team=? AND connected_by=?").get(team, connectedBy) as (WorkspaceConnection & { encrypted: string }) | undefined;
      return row ? { ...row, token: () => JSON.parse(open(row.encrypted, `github-team:${team}`)) as TokenRecord } : null;
    },
    saveWorkspace(team: string, login: string, accountId: number, connectedBy: string, token: TokenRecord) {
      db().prepare("INSERT INTO github_workspace VALUES(?,?,?,?,?) ON CONFLICT(team) DO UPDATE SET login=excluded.login,account_id=excluded.account_id,connected_by=excluded.connected_by,encrypted=excluded.encrypted")
        .run(team, login, accountId, connectedBy, seal(JSON.stringify(token), `github-team:${team}`));
    },
    disconnectWorkspace(team: string) { db().prepare("DELETE FROM github_workspace WHERE team=?").run(team); },

    createState(value: Omit<GithubState, "verifier">) {
      const state = randomBytes(32).toString("base64url"), browser = randomBytes(32).toString("base64url"), verifier = randomBytes(32).toString("base64url");
      db().prepare("DELETE FROM github_oauth_states WHERE expires < ?").run(now());
      db().prepare("INSERT INTO github_oauth_states VALUES(?,?,?,?)").run(hashSecret(state), hashSecret(browser), seal(JSON.stringify({ ...value, verifier }), statePurpose(state)), now() + STATE_TTL_MS);
      return { state, browser, challenge: createHash("sha256").update(verifier).digest("base64url") };
    },
    consumeState(state: string, browser: string, mode: GithubState["mode"]): GithubState {
      const row = db().prepare("DELETE FROM github_oauth_states WHERE hash=? AND browser_hash=? AND expires>? RETURNING encrypted").get(hashSecret(state), hashSecret(browser), now()) as { encrypted: string } | undefined;
      if (!row) throw new Error("GitHub connection request expired. Start again from Settings.");
      const result = JSON.parse(open(row.encrypted, statePurpose(state))) as GithubState;
      if (result.mode !== mode) throw new Error("Invalid connection request");
      return result;
    },
    peekState(state: string, browser: string): GithubState {
      const row = db().prepare("SELECT encrypted FROM github_oauth_states WHERE hash=? AND browser_hash=? AND expires>?").get(hashSecret(state), hashSecret(browser), now()) as { encrypted: string } | undefined;
      if (!row) throw new Error("GitHub connection request expired");
      return JSON.parse(open(row.encrypted, statePurpose(state))) as GithubState;
    },

    /** A single-use link that hands the browser cookie of a new state to whichever browser opens it. */
    createTicket(value: BrowserTicket) {
      const ticket = randomBytes(32).toString("base64url");
      db().prepare("DELETE FROM github_tickets WHERE expires < ?").run(now());
      db().prepare("INSERT INTO github_tickets VALUES(?,?,?)").run(hashSecret(ticket), seal(JSON.stringify(value), `github-ticket:${hashSecret(ticket)}`), now() + STATE_TTL_MS);
      return ticket;
    },
    consumeTicket(ticket: string, mode: GithubState["mode"]): BrowserTicket {
      const row = db().prepare("DELETE FROM github_tickets WHERE hash=? AND expires>? RETURNING encrypted").get(hashSecret(ticket), now()) as { encrypted: string } | undefined;
      if (!row) throw new Error("GitHub connection link expired. Start again from Settings.");
      const result = JSON.parse(open(row.encrypted, `github-ticket:${hashSecret(ticket)}`)) as BrowserTicket;
      if (result.mode !== mode) throw new Error("Invalid connection request");
      return result;
    },

    readJob(key: string): GithubJob | undefined {
      return db().prepare("SELECT state,payload,updated FROM github_jobs WHERE key=?").get(key) as GithubJob | undefined;
    },
    saveJob(key: string, state: string, payload?: unknown) {
      db().prepare("INSERT INTO github_jobs VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET state=excluded.state,payload=excluded.payload,updated=excluded.updated")
        .run(key, state, payload === undefined ? null : JSON.stringify(payload), now());
    },
    /** True when this caller now holds the job; a lease older than 90s counts as abandoned. */
    lockJob(key: string) {
      const row = db().prepare("INSERT INTO github_jobs VALUES(?,'working',NULL,?) ON CONFLICT(key) DO UPDATE SET state='working',updated=excluded.updated WHERE github_jobs.state!='working' OR github_jobs.updated<? RETURNING key")
        .get(key, now(), now() - JOB_LEASE_MS);
      return Boolean(row);
    },

    limit(key: string, maximum: number, durationMs: number) {
      const at = now();
      const row = db().prepare("INSERT INTO request_limits(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires<? THEN 1 ELSE count+1 END, expires=CASE WHEN expires<? THEN ? ELSE expires END RETURNING count")
        .get(key, at + durationMs, at, at, at + durationMs) as { count: number };
      if (row.count > maximum) throw new RateLimited();
    },

    close() { database?.close(); database = undefined; },
  };
}

export class RateLimited extends Error {
  constructor() { super("Too many requests. Please try again shortly."); }
}

export type GitHubStore = ReturnType<typeof createGitHubStore>;

export function jobPayload(job: GithubJob | undefined): Record<string, unknown> {
  return job?.payload ? JSON.parse(job.payload) as Record<string, unknown> : {};
}
