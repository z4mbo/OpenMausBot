// A bot opens a page of 1,200 module scripts through the server's own browser path: the MCP transport, the viewport,
// the egress gate and the daemon hook index.ts wires. Needs the pinned agent-browser binary: runs when one resolves
// (tools directory, OMB_AGENT_BROWSER_PATH or PATH) or OMB_UI_E2E=1 asks for the verified download; otherwise skipped.
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";

import { ensureUiBrowser, UI_TOOLS_DIR } from "../scripts/testing/control-omb-ui.ts";
import { ownRuntimeBrowserDaemon } from "./browser-daemon.ts";
import { agentBrowserIntegration, browserDaemonFile, closeBrowserSession, inRunningBrowser, prepareBrowserSessionState, resolveAgentBrowserBinary, setBrowserViewport } from "./browser-engine.ts";
import { BrowserRuntime, browserRuntimeEnv, type BrowserSpawnSpec } from "./browser-runtime.ts";
import { openGate, type EgressGate } from "./browser/egress/gate.ts";
import { removeTempDir } from "./testing/cleanup.ts";

const forced = process.env.OMB_UI_E2E === "1";
const enabled = forced || Boolean(resolveAgentBrowserBinary({ dataDir: UI_TOOLS_DIR, env: process.env }));
const MODULES = 1_200;
const SESSION = "omb-heavy-page";

let server: Server | undefined;
let gate: EgressGate | undefined;
let home: string | undefined;
let runtime: BrowserRuntime | undefined;
let spec: BrowserSpawnSpec | undefined;

afterAll(async () => {
  await runtime?.closeAll();
  if (spec) await closeBrowserSession(spec.command, browserRuntimeEnv({ ...spec.env, AGENT_BROWSER_SESSION: SESSION }));
  await gate?.close();
  await new Promise<void>((resolve) => server ? server.close(() => resolve()) : resolve());
  if (home) await removeTempDir(home);
});

function manyModulesPage(): Promise<string> {
  server = createServer((req, res) => {
    if (req.url === "/many.html") {
      res.setHeader("content-type", "text/html");
      const scripts = Array.from({ length: MODULES }, (_, index) => `<script type="module" src="/m/${index}.js"></script>`).join("");
      res.end(`<!doctype html><title>many</title>${scripts}`);
      return;
    }
    if (/^\/m\/\d+\.js$/.test(req.url ?? "")) {
      res.setHeader("content-type", "text/javascript");
      res.end("window.loaded = (window.loaded ?? 0) + 1;");
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  return new Promise((resolve) => server!.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server!.address() as { port: number }).port}/many.html`)));
}

(enabled ? it : it.skip)("a bot's browser opens a page that makes over a thousand requests", async () => {
  const url = await manyModulesPage();
  const tools = await ensureUiBrowser();
  home = mkdtempSync(join(tmpdir(), "omb-heavy-page-"));
  mkdirSync(join(home, "tmp"));
  const isolated = { HOME: home, USERPROFILE: home, XDG_RUNTIME_DIR: join(home, "runtime"), TMPDIR: join(home, "tmp"), TEMP: join(home, "tmp"), TMP: join(home, "tmp") };
  gate = await openGate({ decide: async () => null });
  const integration = agentBrowserIntegration({
    binaryPath: tools.binary, session: SESSION, encryptionKey: randomBytes(32).toString("hex"), persistent: false, egressPort: gate.port,
    env: { ...isolated, PATH: process.env.PATH, ...(tools.chrome ? { AGENT_BROWSER_EXECUTABLE_PATH: tools.chrome } : {}) },
  });
  spec = { ...integration, env: { ...integration.env, ...isolated } };
  await prepareBrowserSessionState(tools.binary, SESSION, { env: isolated, persistent: false });
  runtime = new BrowserRuntime({
    closeBrowser: (session, closing) => closeBrowserSession(closing.command, browserRuntimeEnv({ ...closing.env, AGENT_BROWSER_SESSION: session })),
    applyViewport: (applying) => setBrowserViewport(applying.command, applying.env),
    ownDaemon: ownRuntimeBrowserDaemon,
  });

  const opened = await runtime.agentRpc(SESSION, spec, "tools/call", { name: "agent_browser_open", arguments: { url } }) as { isError?: boolean; content?: Array<{ text?: string }> };
  expect(opened.isError, JSON.stringify(opened.content)).not.toBe(true);
  const env = browserRuntimeEnv({ ...spec.env, AGENT_BROWSER_SESSION: SESSION });
  const daemon = readFileSync(browserDaemonFile(env, ".pid"), "utf8").trim();

  expect((await inRunningBrowser(spec.command, env, ["eval", "window.loaded"], 30_000))?.result).toBe(MODULES);
  const reopened = await runtime.agentRpc(SESSION, spec, "tools/call", { name: "agent_browser_open", arguments: { url } }) as { isError?: boolean; content?: Array<{ text?: string }> };
  expect(reopened.isError, JSON.stringify(reopened.content)).not.toBe(true);
  expect(readFileSync(browserDaemonFile(env, ".pid"), "utf8").trim()).toBe(daemon);
}, forced ? 600_000 : 240_000);
