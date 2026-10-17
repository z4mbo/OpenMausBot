import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ChildProcess } from "node:child_process";
import { afterAll, beforeAll, expect, it } from "vitest";
import { spawnWithSecrets } from "./cloud-home-start.ts";
import { cloudPairingSignature } from "./cloud-home.ts";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { freePortBlock } from "./testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const HOST = "omb-t-0123456789ab.fly.dev";
const secret = randomBytes(32).toString("base64url");
const VENICE = `venice-owner-${randomBytes(8).toString("hex")}`;
const OWNER_ANTHROPIC = `anthropic-owner-${randomBytes(8).toString("hex")}`;
let home = "";
let dataDir = "";
let dump = "";
let processDumps = "";
let base = "";
let child: ChildProcess;
let log = "";
let owner = "";

async function api(method: string, path: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      host: HOST, "x-forwarded-for": "203.0.113.9", "x-forwarded-proto": "https", origin: `https://${HOST}`,
      authorization: `Bearer ${owner}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, text, body: (() => { try { return JSON.parse(text); } catch { return null; } })() as any };
}

async function adminPairing(): Promise<string> {
  const body = JSON.stringify({ label: "OpenMausBot app (Cloud)", ttlSeconds: 300 });
  const timestamp = String(Math.floor(Date.now() / 1000)), nonce = randomBytes(16).toString("base64url");
  const response = await fetch(`${base}/api/cloud/pairing`, { method: "POST", headers: {
    host: HOST, "x-forwarded-for": "203.0.113.9", "x-forwarded-proto": "https", "content-type": "application/json",
    "x-omb-cloud-timestamp": timestamp, "x-omb-cloud-nonce": nonce, "x-omb-cloud-signature": `v1=${cloudPairingSignature(secret, timestamp, nonce, body)}`,
  }, body });
  const granted = await response.json() as { code: string };
  return (await api("POST", "/api/auth/pair", { code: granted.code })).body.token;
}

type AcpCapture = { pid: number; argv: string[]; env: Record<string, string> };
const captures = (): AcpCapture[] => readdirSync(processDumps).filter((name) => /^\d+\.json$/.test(name)).flatMap((name) => {
  try { return [JSON.parse(readFileSync(join(processDumps, name), "utf8")) as AcpCapture]; } catch { return []; }
});
const processIds = () => new Set(captures().map((capture) => capture.pid));
async function nextCatalogProcess(previous: ReadonlySet<number>): Promise<AcpCapture> {
  let captured: AcpCapture | undefined;
  await expect.poll(() => {
    captured = captures().find((entry) => !previous.has(entry.pid) && entry.argv.length === 1 && entry.argv[0] === "acp");
    return Boolean(captured);
  }, { timeout: 15_000 }).toBe(true);
  return captured!;
}
/** Existence alone can catch a half-written file on a busy runner (SyntaxError: Unexpected end). */
const written = (file: string, shape: "document" | "lines" = "document") => {
  try {
    const text = readFileSync(file, "utf8");
    JSON.parse(shape === "lines" ? text.trim().split("\n").at(-1)! : text);
    return true;
  } catch { return false; }
};

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "omb-opencode-keys-"));
  dataDir = join(home, ".openmausbot");
  mkdirSync(dataDir, { recursive: true });
  dump = join(home, "opencode.json");
  processDumps = join(home, "opencode-processes");
  mkdirSync(processDumps);
  const cli = join(home, "gated-acp.ts");
  writeFileSync(cli, `#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
const root = ${JSON.stringify(home)};
const parent = process.ppid;
async function waitFor(file) {
  while (!existsSync(file)) {
    try { process.kill(parent, 0); } catch { process.exit(0); }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
if (process.argv.includes("--version") && !process.env.VENICE_API_KEY) {
  const counter = root + "/version-count";
  const count = existsSync(counter) ? Number(readFileSync(counter, "utf8")) + 1 : 1;
  writeFileSync(counter, String(count));
  if (count === 2) {
    writeFileSync(root + "/old-probe-ready", JSON.stringify({ pid: process.pid }));
    await waitFor(root + "/old-probe-release");
  }
}
if (process.env.VENICE_API_KEY) await waitFor(root + "/keyed-probe-release");
await import(${JSON.stringify(pathToFileURL(join(SERVER_DIR, "testing", "fake-acp-cli.ts")).href)});
`, { mode: 0o755 });
  // Only OpenCode: nothing probes a CLI installed on this machine.
  writeFileSync(join(dataDir, "config.json"), JSON.stringify({
    instances: {
      opencodeGo: {
        driver: "opencodeGo", displayName: "OpenCode",
        config: { cli },
        environment: { FAKE_ACP_MODELS: "fixture/warm", FAKE_ACP_DUMP: dump, FAKE_ACP_DUMP_BY_PID: processDumps },
      },
    },
  }));
  const port = await freePortBlock([0, 1]);
  base = `http://127.0.0.1:${port}`;
  const offlinePrelude = `data:text/javascript,${encodeURIComponent('const real = globalThis.fetch; globalThis.fetch = async (url, init) => String(url).startsWith("http://127.0.0.1:") ? real(url, init) : new Response("offline fixture", { status: 503 });')}`;
  child = spawnWithSecrets(process.execPath, ["--import", offlinePrelude, join(SERVER_DIR, "index.ts")], {
    PATH: process.env.PATH, ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    HOME: home, USERPROFILE: home, OMB_DATA_DIR: dataDir, OMB_PORT: String(port), OMB_WEBHOOK_PORT: String(port + 1),
    OMB_CLOUD_ROLE: "home", OMB_CLOUD_MACHINE_ID: "3f9c2a4e-8b1d-4c6e-9a7f-2d5e8c1b0a93", OMB_CLOUD_ADMIN_URL: "https://cloud.example.test",
    OMB_PUBLIC_URL: `https://${HOST}`, OMB_CLOUD_SECRETS_FD: "3",
    // Provider keys in the server's own environment: never the owner's to spend from a bot.
    ANTHROPIC_API_KEY: "anthropic-server-own", OPENAI_API_KEY: "openai-server-own",
  }, { OMB_CLOUD_BOOTSTRAP_SECRET: secret }, undefined, true);
  for (const stream of [child.stdout, child.stderr]) stream?.on("data", (chunk) => { log += chunk; });
  const deadline = Date.now() + 20_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`the Cloud home exited:\n${log}`);
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {}
    if (Date.now() > deadline) throw new Error(`the Cloud home did not start:\n${log}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  owner = await adminPairing();
}, 40_000);

afterAll(async () => {
  if (child) await waitForExit(child, { signal: "SIGTERM" });
  if (home) await removeTempDir(home);
});

it("saves keys for any OpenCode provider on a Cloud, shows only their names, and hands them to OpenCode alone", async () => {
  expect(owner).toMatch(/^omb_sess_/);
  expect((await api("GET", "/api/config")).body.opencodeGo).toEqual({ configured: false, providerKeys: [] });
  const initial = await nextCatalogProcess(new Set());
  expect(initial.env.ANTHROPIC_API_KEY).toBeUndefined();
  expect(initial.env.OPENAI_API_KEY).toBeUndefined();

  await expect.poll(() => written(join(home, "old-probe-ready")), { timeout: 15_000 }).toBe(true);
  const stalePid = JSON.parse(readFileSync(join(home, "old-probe-ready"), "utf8")).pid as number;
  const beforeSave = processIds();
  const saved = await api("PUT", "/api/config", { opencodeGo: { providerKeys: { VENICE_API_KEY: VENICE, ANTHROPIC_API_KEY: OWNER_ANTHROPIC } } });
  expect(saved.status, saved.text).toBe(200);
  expect(saved.body.opencodeGo).toEqual({ configured: false, providerKeys: ["ANTHROPIC_API_KEY", "VENICE_API_KEY"] });
  const reread = await api("GET", "/api/config");
  for (const response of [saved.text, reread.text]) {
    expect(response).not.toContain(VENICE);
    expect(response).not.toContain(OWNER_ANTHROPIC);
  }
  expect(reread.body.opencodeGo.providerKeys).toEqual(["ANTHROPIC_API_KEY", "VENICE_API_KEY"]);
  writeFileSync(join(home, "old-probe-release"), "true");
  await expect.poll(() => captures().some((capture) => capture.pid === stalePid), { timeout: 15_000 }).toBe(true);
  const stale = captures().find((capture) => capture.pid === stalePid)!;
  expect(stale.argv).toEqual(["--version"]);
  expect(stale.env.VENICE_API_KEY).toBeUndefined();
  expect(stale.env.ANTHROPIC_API_KEY).toBeUndefined();
  writeFileSync(join(home, "keyed-probe-release"), "true");
  const savedCatalog = await nextCatalogProcess(beforeSave);
  expect(savedCatalog.env.VENICE_API_KEY).toBe(VENICE);
  expect(savedCatalog.env.ANTHROPIC_API_KEY).toBe(OWNER_ANTHROPIC);
  expect(savedCatalog.env.OPENAI_API_KEY).toBeUndefined();

  const { bot } = (await api("POST", "/api/bots", { name: "Venice bot", modelSelection: { instanceId: "opencodeGo", model: "fixture/warm" } })).body;
  const thread = (await api("POST", `/api/bots/${bot.id}/tasks`, { title: "Mine" })).body.task.threadId as string;
  const prompts = `${dump}.prompts.jsonl`;
  rmSync(prompts, { force: true });
  expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "Hello.", threadId: thread })).status).toBe(202);
  await expect.poll(() => written(prompts, "lines"), { timeout: 15_000 }).toBe(true);
  const turnPid = JSON.parse(readFileSync(prompts, "utf8").trim().split("\n").at(-1)!).pid as number;
  const turn = captures().find((capture) => capture.pid === turnPid)!;
  expect(turn.pid).toBe(turnPid);
  expect(turn.env.VENICE_API_KEY).toBe(VENICE);
  expect(turn.env.ANTHROPIC_API_KEY).toBe(OWNER_ANTHROPIC);
  expect(turn.env.OPENAI_API_KEY).toBeUndefined();
  await expect.poll(async () => (await api("GET", "/api/bots")).body.bots.find((entry: any) => entry.id === bot.id)
    ?.tasks.find((task: any) => task.threadId === thread)?.busy, { timeout: 15_000 }).toBe(false);

  const beforeRemoval = processIds();
  const removed = await api("PUT", "/api/config", { opencodeGo: { providerKeys: { VENICE_API_KEY: "" } } });
  expect(removed.status, removed.text).toBe(200);
  expect(removed.body.opencodeGo.providerKeys).toEqual(["ANTHROPIC_API_KEY"]);
  const removedCatalog = await nextCatalogProcess(beforeRemoval);
  expect(removedCatalog.env.VENICE_API_KEY).toBeUndefined();
  expect(removedCatalog.env.ANTHROPIC_API_KEY).toBe(OWNER_ANTHROPIC);
}, 90_000);

it("refuses a name OpenMaus keeps, in one plain line, and saves nothing", async () => {
  const before = readFileSync(join(dataDir, "config.json"), "utf8");
  const refused = await api("PUT", "/api/config", { opencodeGo: { providerKeys: { OMB_CLOUD_BOAT_TOKEN: "x-token", VENICE_API_KEY: VENICE } } });
  expect(refused.status).toBe(400);
  expect(refused.body.error).toBe("OpenMaus keeps OMB_CLOUD_BOAT_TOKEN for itself, so OpenCode can't be given it here. Put this key in opencode.json instead.");
  expect(readFileSync(join(dataDir, "config.json"), "utf8")).toBe(before);
  const opencodeKey = await api("PUT", "/api/config", { opencodeGo: { providerKeys: { OPENCODE_API_KEY: "zen" } } });
  expect(opencodeKey.status).toBe(400);
  expect(opencodeKey.body.error).toBe("Save the OpenCode key in the OpenCode API key box instead.");
});
