// A session daemon started by startSessionDaemon survives a page that makes
// as many requests as the Vite-served threads preview. Needs the pinned
// agent-browser binary: runs when one resolves (tools directory,
// OMB_AGENT_BROWSER_PATH or PATH) or OMB_UI_E2E=1 asks for the verified
// download; otherwise skipped.
import { createServer, type Server } from "node:http";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";

import { closeBrowserSession, resolveAgentBrowserBinary } from "../../server/browser-engine.ts";
import { removeTempDir } from "../../server/testing/cleanup.ts";
import { agentBrowser, ensureUiBrowser, sessionEnv, startSessionDaemon, UI_TOOLS_DIR } from "./control-omb-ui.ts";

const forced = process.env.OMB_UI_E2E === "1";
const enabled = forced || Boolean(resolveAgentBrowserBinary({ dataDir: UI_TOOLS_DIR, env: process.env }));
const MODULES = 1_200;

let server: Server | undefined;
let home: string | undefined;
let session: { binary: string; env: NodeJS.ProcessEnv } | undefined;

afterAll(async () => {
  if (session) await closeBrowserSession(session.binary, session.env);
  await new Promise<void>((resolve) => server ? server.close(() => resolve()) : resolve());
  if (home) await removeTempDir(home);
});

(enabled ? it : it.skip)("opens a page that makes over a thousand requests", async () => {
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
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/many.html`;
  const tools = await ensureUiBrowser();
  home = mkdtempSync(join(tmpdir(), "omb-open-page-"));
  mkdirSync(join(home, "tmp"));
  const env = sessionEnv({ home, session: "omb-open-page", chrome: tools.chrome });
  session = { binary: tools.binary, env };

  const daemon = await startSessionDaemon(tools.binary, env);
  await agentBrowser(tools.binary, env, ["open", url], 120_000);

  expect((await agentBrowser(tools.binary, env, ["eval", "window.loaded"])).result).toBe(MODULES);
  expect(daemon.exitCode).toBeNull();
}, forced ? 600_000 : 180_000);
