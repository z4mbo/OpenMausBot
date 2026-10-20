// agent-browser 0.36.0-omb.1 on Windows starts a session's daemon with its stderr piped to the CLI call that spawned it, and
// that call exits. The daemon's next eprintln! then fails on the closed pipe and panics: it prints one when more than 4096
// CDP events queue up, which a page load of ~600+ requests does, so `open` answers with an empty response or the daemon
// dies. A daemon this process starts writes to the NUL device instead.
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { browserDaemonFile, closeBrowserSession, runBrowserCommand, runningBrowserSessionNames } from "./browser-engine.ts";
import { processAlive } from "./browser-processes.ts";
import { browserRuntimeEnv, type OwnDaemon } from "./browser-runtime.ts";

const SESSION = /^[A-Za-z0-9_.-]{1,96}$/;
const START_MS = 15_000;
/** agent-browser 0.36.0-omb.1 keeps these out of the `<session>.config` daemon fingerprint, and with any of them set `close`
 * first launches or attaches a browser (an attach could reach the person's own Chrome). */
const LAUNCH_SETTINGS: ReadonlySet<string> = new Set([
  "AGENT_BROWSER_SESSION", "AGENT_BROWSER_HEADLESS", "AGENT_BROWSER_HEADED", "AGENT_BROWSER_ARGS",
  "AGENT_BROWSER_PROXY", "AGENT_BROWSER_PROXY_BYPASS", "AGENT_BROWSER_EXECUTABLE_PATH",
  "AGENT_BROWSER_CDP", "AGENT_BROWSER_AUTO_CONNECT", "AGENT_BROWSER_RESTORE", "AGENT_BROWSER_RESTORE_SAVE",
]);

export class BrowserDaemonError extends Error {}

function sessionOf(env: NodeJS.ProcessEnv): string {
  const session = env.AGENT_BROWSER_SESSION;
  if (!session || !SESSION.test(session)) throw new BrowserDaemonError("A browser daemon needs a valid AGENT_BROWSER_SESSION.");
  return session;
}

function fingerprintFile(env: NodeJS.ProcessEnv): string {
  return join(dirname(browserDaemonFile(env, ".pid")), `${sessionOf(env)}.config`);
}

const fingerprints = new Map<string, Promise<string>>();

/** The CLI keeps a running daemon only when `<session>.config` holds the fingerprint it would write itself; any other
 * content makes it stop the daemon and spawn its own. A throwaway session's `close` writes it without launching Chrome. */
function daemonFingerprint(binary: string, env: NodeJS.ProcessEnv): Promise<string> {
  const daemonEnv = Object.fromEntries(Object.entries(env).filter(([key, value]) => value !== undefined && !LAUNCH_SETTINGS.has(key)));
  const key = JSON.stringify([binary, Object.entries(daemonEnv).sort(([a], [b]) => a.localeCompare(b))]);
  let pending = fingerprints.get(key);
  if (!pending) {
    pending = (async () => {
      const donor = { ...daemonEnv, AGENT_BROWSER_SESSION: `omb-fp-${randomBytes(6).toString("hex")}` };
      const file = fingerprintFile(donor);
      try {
        await runBrowserCommand(binary, donor, ["close", "--json"], Date.now() + START_MS);
        const fingerprint = readFileSync(file, "utf8");
        if (!fingerprint.trim()) throw new Error("empty");
        return fingerprint;
      } catch {
        throw new BrowserDaemonError("The browser engine did not report its daemon settings.");
      } finally {
        if (daemonAlive(donor)) await closeBrowserSession(binary, donor).catch(() => false);
        rmSync(file, { force: true });
      }
    })();
    fingerprints.set(key, pending);
    void pending.catch(() => { if (fingerprints.get(key) === pending) fingerprints.delete(key); });
  }
  return pending;
}

function daemonAlive(env: NodeJS.ProcessEnv): boolean {
  let pid: number;
  try { pid = Number(readFileSync(browserDaemonFile(env, ".pid"), "utf8").trim()); } catch { return false; }
  return Number.isInteger(pid) && pid > 0 && processAlive(pid);
}

/** Starts the session's daemon as this process's child with stdout and stderr on the NUL device. The environment must be
 * the one every later command for the session carries; the session must not be running. */
export async function startBrowserDaemon(binary: string, env: NodeJS.ProcessEnv, timeoutMs = START_MS): Promise<ChildProcess> {
  const session = sessionOf(env);
  const fingerprint = await daemonFingerprint(binary, env);
  const daemon = spawn(binary, [], { env: { ...env, AGENT_BROWSER_DAEMON: "1" }, stdio: "ignore", windowsHide: true });
  daemon.on("error", () => {});
  daemon.unref();
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (daemon.exitCode !== null || daemon.signalCode !== null) throw new BrowserDaemonError(`The browser daemon for ${session} exited while starting.`);
    const running = await runningBrowserSessionNames(binary, env, Math.max(1_000, deadline - Date.now()));
    if (running?.includes(session)) break;
    if (Date.now() >= deadline) {
      daemon.kill();
      throw new BrowserDaemonError(`The browser daemon for ${session} did not start within ${timeoutMs}ms.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  writeFileSync(fingerprintFile(env), fingerprint);
  return daemon;
}

const owning = new Map<string, Promise<void>>();

/** On Windows, makes sure the session's daemon is one this process started, unless one is already running. */
export function ownBrowserDaemon(binary: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): Promise<void> {
  if (platform !== "win32") return Promise.resolve();
  const pidFile = browserDaemonFile(env, ".pid");
  const running = owning.get(pidFile);
  if (running) return running;
  if (daemonAlive(env)) return Promise.resolve();
  const started = (async () => {
    const listed = await runningBrowserSessionNames(binary, env);
    if (listed === null) throw new BrowserDaemonError("The browser engine did not say which browsers are running.");
    if (!listed.includes(sessionOf(env))) await startBrowserDaemon(binary, env);
  })().finally(() => { if (owning.get(pidFile) === started) owning.delete(pidFile); });
  owning.set(pidFile, started);
  return started;
}

export const ownRuntimeBrowserDaemon: OwnDaemon = (session, spec) =>
  ownBrowserDaemon(spec.command, browserRuntimeEnv({ ...spec.env, AGENT_BROWSER_SESSION: session }));
