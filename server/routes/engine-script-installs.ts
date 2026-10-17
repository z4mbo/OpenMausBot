// POST starts, GET polls and DELETE cancels the vendor's official installer for one engine.
// Security: the command comes only from OFFICIAL_INSTALLERS by the instance's driver kind, never from the request, and runs
// as this process's user for the desktop owner's own loopback requests: never a paired session, a proxy or a service caller.
import type { IncomingMessage } from "node:http";
import type { EngineScriptInstallJob } from "../../shared/engine-script-install.ts";
import {
  hostInstallPlatform,
  officialInstallScript,
  runOfficialInstaller,
  type InstallerRun,
  type InstallerRunner,
  type InstallPlatform,
} from "../engine-script-install.ts";
import { findCliCandidates, resetPathCache } from "../env-path.ts";
import type { ProviderRegistry } from "../harness/registry.ts";
import { isLoopbackHost, isProxied, type RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface EngineScriptInstallRouteDeps {
  registry: Pick<ProviderRegistry, "cliTarget">;
  enabled: boolean;
  platform?: InstallPlatform | null;
  runInstaller?: InstallerRunner;
  cliFound?(cli: string): boolean;
  timeoutMs?: number;
}

const OUTPUT_TAIL = 16 * 1024;
const DEFAULT_TIMEOUT_MS = 15 * 60_000;

export function localOwner(req: IncomingMessage, auth: RequestAuth): boolean {
  return auth.kind === "loopback" && auth.trust !== "service" && auth.scopes.includes("admin")
    && !isProxied(req) && isLoopbackHost(req.socket.remoteAddress);
}

export function createEngineScriptInstallRoutes(deps: EngineScriptInstallRouteDeps): RouteHandler {
  const platform = deps.platform === undefined ? hostInstallPlatform() : deps.platform;
  const runInstaller = deps.runInstaller ?? runOfficialInstaller;
  const cliFound = deps.cliFound ?? ((cli: string) => findCliCandidates(cli).length > 0);
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const jobs = new Map<string, EngineScriptInstallJob>();
  const runs = new Map<string, InstallerRun>();

  const settle = (job: EngineScriptInstallJob, state: "succeeded" | "failed" | "cancelled", error?: string) => {
    if (job.state !== "running") return;
    job.state = state;
    if (error) job.error = error;
    job.finishedAt = new Date().toISOString();
    runs.delete(job.instanceId);
  };

  const supervise = async (job: EngineScriptInstallJob, run: InstallerRun, cli: string | null) => {
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<"timeout">((resolveTimeout) => {
      timer = setTimeout(() => resolveTimeout("timeout"), timeoutMs);
      timer.unref?.();
    });
    try {
      const result = await Promise.race([run.done, timedOut]);
      if (job.state !== "running") return;
      if (result === "timeout") {
        const stopped = await run.stop();
        return settle(job, "failed", stopped
          ? "The installer took too long and was stopped. Check your network connection and try again."
          : "The installer took too long and could not be confirmed stopped. Close any installer window before trying again.");
      }
      if (result !== 0) return settle(job, "failed", `The installer exited with code ${result ?? "unknown"}.`);
      resetPathCache();
      if (cli && !cliFound(cli)) {
        return settle(job, "failed", `The installer finished, but ${cli} is not on this app's PATH yet. Restart the app, then check again.`);
      }
      settle(job, "succeeded");
    } catch (error) {
      settle(job, "failed", error instanceof Error ? error.message : String(error));
    } finally {
      clearTimeout(timer);
    }
  };

  return async ({ req, res, path, method, auth, json }) => {
    const match = /^\/api\/engine-installs\/([\w.-]+)$/.exec(path);
    if (!match) return PASS;
    if (method !== "GET" && method !== "POST" && method !== "DELETE") return json(res, 405, { error: "method not allowed" });
    if (!deps.enabled) return json(res, 404, { error: "Engines on this server are installed by its administrator." });
    if (!localOwner(req, auth)) return json(res, 403, { error: "Install engines from the app on the computer they run on." });
    if (method !== "GET") {
      const mediaType = String(req.headers["content-type"] ?? "").split(";", 1)[0]!.trim().toLowerCase();
      if (mediaType !== "application/json") return json(res, 415, { error: "content-type must be application/json" });
    }
    const instanceId = match[1]!;
    res.setHeader("cache-control", "no-store");
    const existing = jobs.get(instanceId);

    if (method === "GET") return existing ? json(res, 200, { job: existing }) : json(res, 404, { error: "no install for this engine" });

    if (method === "DELETE") {
      const run = runs.get(instanceId);
      if (!existing || existing.state !== "running" || !run) return json(res, 409, { error: "this engine is not installing" });
      const stopped = await run.stop();
      settle(existing, "cancelled", stopped ? undefined : "The installer could not be confirmed stopped. Close any installer window before trying again.");
      return json(res, 200, { job: existing });
    }

    if (existing?.state === "running") return json(res, 202, { job: existing });
    const target = deps.registry.cliTarget(instanceId);
    if (!target) return json(res, 404, { error: "unknown instance" });
    const script = officialInstallScript(target.driverKind, platform);
    if (!script) return json(res, 409, { error: "This engine has no official installer the app can run on this computer. Follow its install guide instead." });

    const job: EngineScriptInstallJob = { instanceId, state: "running", output: "", startedAt: new Date().toISOString() };
    let run: InstallerRun;
    try {
      run = runInstaller(script, platform!, (chunk) => {
        const output = job.output + chunk;
        job.output = output.length > OUTPUT_TAIL ? output.slice(-OUTPUT_TAIL) : output;
      });
    } catch (error) {
      return json(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
    jobs.set(instanceId, job);
    runs.set(instanceId, run);
    void supervise(job, run, target.cli);
    return json(res, 202, { job });
  };
}
