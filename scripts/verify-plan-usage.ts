import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { InstanceConfigMap } from "../server/contracts.ts";
import * as currentUsage from "../server/plan-usage.ts";
import { launchVerificationServer } from "./control-omb.ts";
import { mountPreview, parkUntilSignal, REPO_ROOT } from "./testing/preview-fixture.ts";

const scenarios = ["missing", "expired", "read-error", "forbidden", "healthy", "grok-fallback"] as const;
type Scenario = typeof scenarios[number];
const beforeRef = process.argv.find((arg) => arg.startsWith("--before-ref="))?.slice("--before-ref=".length);
const fixture = await launchVerificationServer({ SYSTEMROOT: process.env.SYSTEMROOT, WINDIR: process.env.WINDIR });
let preview: Awaited<ReturnType<typeof mountPreview>> | undefined;
try {
  let usage = currentUsage;
  let rendererSource: string | undefined;
  let source = "working-tree";
  if (beforeRef) {
    source = execFileSync("git", ["rev-parse", "--verify", `${beforeRef}^{commit}`], { cwd: REPO_ROOT, encoding: "utf8", windowsHide: true }).trim();
    const snapshot = (path: string) => execFileSync("git", ["show", `${source}:${path}`], { cwd: REPO_ROOT, encoding: "utf8", windowsHide: true });
    const serverSource = snapshot("server/plan-usage.ts").replace(/from\s+(["'])(\.\/[^"']+)\1/g, (_match, quote: string, path: string) => `from ${quote}${new URL(path, pathToFileURL(join(REPO_ROOT, "server", "plan-usage.ts"))).href}${quote}`);
    const baselinePath = join(fixture.info.dataDir, "plan-usage-before.mts");
    await writeFile(baselinePath, serverSource);
    usage = await import(pathToFileURL(baselinePath).href) as typeof currentUsage;
    rendererSource = snapshot("src/components/PlanUsage.tsx");
  }
  const instances: InstanceConfigMap = {
    claude: { driver: "claudeAgent", displayName: "Claude" },
    "claude-api": { driver: "claudeAgent", displayName: "Claude API", access: "api", environment: { ANTHROPIC_API_KEY: "synthetic-api-key" } },
    grok: { driver: "grokAgent", displayName: "Grok" },
    codex: { driver: "codex", displayName: "Codex" },
  };
  const observations: { scenario: Scenario; accounts: string[]; credentials: { id: string; outcome: string }[]; requests: { host: string; path: string; status: number }[]; report: currentUsage.PlanUsageReport }[] = [];
  preview = await mountPreview(fixture, {
    entry: "/scripts/testing/plan-usage-preview.tsx", route: "/__origin-plan-usage.html", title: "Origin isolated Settings Usage verification", hmr: false,
    ...(rendererSource ? { plugins: [{ name: "plan-usage-before-source", enforce: "pre" as const, transform(_code: string, id: string) { return id.split("?")[0]?.replaceAll("\\", "/").endsWith("/src/components/PlanUsage.tsx") ? rendererSource : undefined; } }] } : {}),
    extraRoutes: [
      { path: "/api/plan-usage", method: "GET", async handler(req, res) {
        const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
        const referer = new URL(req.headers.referer ?? "/", "http://127.0.0.1");
        const selected = requestUrl.searchParams.get("scenario") ?? referer.searchParams.get("scenario") ?? "missing";
        if (!scenarios.includes(selected as Scenario)) { res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: "Unknown synthetic usage scenario" })); return; }
        const scenario = selected as Scenario;
        const at = Date.now();
        const resets = (offset: number) => new Date(at + offset).toISOString();
        const accounts = usage.planAccountsFromInstances(instances);
        const credentials: { id: string; outcome: string }[] = [];
        const requests: { host: string; path: string; status: number }[] = [];
        const report = await usage.fetchPlanUsage(accounts, {
          now: () => at,
          credentials: { read(account) {
            const affected = account.driver !== "codex";
            const outcome = affected && ["missing", "expired", "read-error"].includes(scenario) ? scenario : "present";
            credentials.push({ id: account.id, outcome });
            if (outcome === "read-error") throw new Error("Synthetic credential reader failure");
            return { token: outcome === "missing" ? null : "synthetic-usage-token", accountId: null, expired: outcome === "expired" };
          } },
          fetch: async (url) => {
            const target = new URL(url);
            const allowed = ["api.anthropic.com", "chatgpt.com", "cli-chat-proxy.grok.com"].includes(target.hostname);
            if (!allowed) throw new Error("Unexpected provider in isolated usage fixture");
            let status = scenario === "forbidden" && target.hostname !== "chatgpt.com" ? 403 : 200;
            if (scenario === "grok-fallback" && target.searchParams.get("format") === "credits") status = 403;
            const body = status === 403 ? { error: "Synthetic usage endpoint restriction" }
              : target.hostname === "api.anthropic.com" ? { subscription_type: "Max", five_hour: { utilization: 25, resets_at: resets(2 * 3600_000) }, seven_day: { utilization: 40, resets_at: resets(3 * 86400_000) } }
              : target.hostname === "chatgpt.com" ? { plan_type: "Pro", rate_limit: { primary_window: { used_percent: 20, limit_window_seconds: 18000, reset_at: Math.floor((at + 2 * 3600_000) / 1000) }, secondary_window: { used_percent: 30, limit_window_seconds: 604800, reset_at: Math.floor((at + 4 * 86400_000) / 1000) } } }
              : target.pathname.endsWith("/settings") ? { settings: { subscription_tier_display: "SuperGrok" } }
              : { config: { creditUsagePercent: target.searchParams.has("format") ? 8 : 40, currentPeriod: { type: target.searchParams.has("format") ? "WEEK" : "MONTH", end: resets(4 * 86400_000) } } };
            requests.push({ host: target.hostname, path: `${target.pathname}${target.search}`, status });
            return { ok: status < 400, status, async text() { return JSON.stringify(body); } };
          },
        });
        observations.push({ scenario, accounts: accounts.map((account) => account.id), credentials, requests, report });
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(report));
      } },
      { path: "/__origin-plan-usage-proof", method: "GET", handler(_req, res) { res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ source, rendererSourceSha256: rendererSource ? createHash("sha256").update(rendererSource).digest("hex") : null, scope: "Actual PlanUsage renderer and actual planAccountsFromInstances/fetchPlanUsage with synthetic credential/fetch dependencies; no owner files, keychain, provider requests or whole-App acceptance", scenarios, observations })); } },
      { path: /^\/api\//, handler(_req, res) { res.writeHead(403, { "content-type": "application/json" }).end(JSON.stringify({ error: "Only the isolated usage endpoint is available" })); } },
    ],
  });
  console.log(JSON.stringify({ ...fixture.info, source, previewUrl: preview.previewUrl, proofUrl: new URL("/__origin-plan-usage-proof", preview.previewUrl).href, scenarios }));
  await parkUntilSignal();
} finally {
  await preview?.close();
  await fixture.close();
}
