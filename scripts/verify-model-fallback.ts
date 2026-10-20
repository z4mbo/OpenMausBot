import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { IncomingMessage } from "node:http";
import { createServer } from "node:http";
import type { InstanceInfo } from "../src/state/store.tsx";
import { launchVerificationServer, runControlOmb } from "./control-omb.ts";
import { fixtureApi, mountPreview, parkUntilSignal, REPO_ROOT } from "./testing/preview-fixture.ts";

const beforeRef = process.argv.find(value => value.startsWith("--before-ref="))?.slice("--before-ref=".length);
const source = beforeRef ? execFileSync("git", ["rev-parse", "--verify", `${beforeRef}^{commit}`], { cwd: REPO_ROOT, encoding: "utf8", windowsHide: true }).trim() : "working-tree";
const fixture = await launchVerificationServer({ SYSTEMROOT: process.env.SYSTEMROOT, WINDIR: process.env.WINDIR, OMB_TEST_PORTS: "26200-26400" });
console.log(JSON.stringify({ phase: "isolated-server-launched", ...fixture.info }));
const fakeRequests: Array<{ method: string; path: string }> = [];
const fakeApi = createServer((req, res) => {
  fakeRequests.push({ method: req.method ?? "", path: req.url ?? "" });
  if (req.method === "GET" && req.url === "/v1/models") res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: [{ id: "anthropic/claude-sonnet-4" }, { id: "openai/gpt-5.6" }] }));
  else res.writeHead(405, { "content-type": "application/json" }).end('{"error":"This UI fixture does not run model completions"}');
});
let preview: Awaited<ReturnType<typeof mountPreview>> | undefined;
try {
  const request = fixtureApi(fixture.info.url, { headers: { origin: fixture.info.url } });
  await new Promise<void>(resolve => fakeApi.listen(0, "127.0.0.1", resolve));
  const address = fakeApi.address(); if (!address || typeof address === "string") throw new Error("No isolated API listener");
  const chatgpt = await request("POST", "/api/instances/claude-accounts", { displayName: "Synthetic ChatGPT profile", configDir: join(fixture.info.dataDir, "synthetic-chatgpt") });
  const grok = await request("POST", "/api/instances/claude-accounts", { displayName: "Synthetic Grok profile", configDir: join(fixture.info.dataDir, "synthetic-grok") });
  const openrouter = await request("POST", "/api/instances/openai-compat", { displayName: "Synthetic OpenRouter profile", url: `http://127.0.0.1:${address.port}/v1`, key: "fixture-only-not-a-provider-key", models: ["anthropic/claude-sonnet-4", "openai/gpt-5.6"] });
  await request("PUT", "/api/config", { dailyApiBudget: { limitUsd: 3, timeZone: "Europe/Rome" } });
  await runControlOmb(["new-bot", "--name", "Atlas", "--url", fixture.info.url]);
  const { bots } = await request("GET", "/api/bots");
  const bot = bots.find((value: { name: string }) => value.name === "Atlas");
  if (!bot) throw new Error("The isolated fixture agent was not created");
  await request("PATCH", `/api/bots/${bot.id}`, { fallback: [{ instanceId: chatgpt.instanceId, model: "gpt-5.6-sol" }, { instanceId: grok.instanceId, model: "grok-4.7" }], dailyApiBudgetUsd: 1.5 });
  const profiles: InstanceInfo[] = [
    { instanceId: "claude", driverKind: "claudeAgent", displayName: "Claude", snapshot: { state: "available", authenticated: true, billing: "subscription" }, models: { default: bot.modelSelection.model, options: [{ id: bot.modelSelection.model, label: "Opus" }, { id: "claude-sonnet-backup", label: "Sonnet" }, { id: "claude-haiku-backup", label: "Haiku" }] } },
    { instanceId: chatgpt.instanceId, driverKind: "codex", displayName: "ChatGPT", snapshot: { state: "available", authenticated: true, billing: "subscription", chatgptPlan: true }, models: { default: "gpt-5.6-sol", options: [{ id: "gpt-5.6-sol", label: "GPT-5.6" }, { id: "gpt-5.6-luna", label: "GPT-5.6 Mini" }] } },
    { instanceId: grok.instanceId, driverKind: "grokAgent", displayName: "Grok", snapshot: { state: "available", authenticated: true, billing: "subscription" }, models: { default: "grok-4.7", options: [{ id: "grok-4.7", label: "Grok 4.7" }, { id: "grok-code", label: "Grok Code" }] } },
    { instanceId: openrouter.instanceId, driverKind: "openai-compat", access: "api", displayName: "OpenRouter API", snapshot: { state: "available", authenticated: true, billing: "metered", account: { method: "api-key" } }, models: { default: "anthropic/claude-sonnet-4", options: [{ id: "anthropic/claude-sonnet-4", label: "Claude Sonnet" }, { id: "openai/gpt-5.6", label: "GPT-5.6" }] } },
  ];
  const bindings = await Promise.all(["src/components/ModelPicker.tsx", "src/components/ModelFallbackSettings.tsx", "src/lib/use-pointer-reorder.ts", "src/components/DailyApiBudgetCard.tsx", "src/components/bot-settings/ModelSection.tsx", "src/components/UsageSection.tsx", "src/locales/en.json", "server/daily-api-budget.ts", "server/routes/bot-patch.ts", "server/routes/config.ts", "server/routes/status.ts"].map(async name => ({ name, sha256: createHash("sha256").update(await readFile(join(REPO_ROOT, name))).digest("hex") })));
  const baseline = new Map<string, string>();
  if (beforeRef) for (const name of ["src/components/ModelPicker.tsx", "src/components/bot-settings/ModelSection.tsx", "src/components/UsageSection.tsx"]) baseline.set(name, execFileSync("git", ["show", `${source}:${name}`], { cwd: REPO_ROOT, encoding: "utf8", windowsHide: true }));
  const observations: Array<{ method: string; path: string; status: number; patch?: unknown }> = [];
  let failNext = false;
  const bodyOf = async (req: IncomingMessage) => {
    let text = "";
    for await (const part of req) { text += String(part); if (Buffer.byteLength(text) > 64 * 1024) throw new Error("Fixture body exceeds the scoped limit"); }
    return text;
  };
  preview = await mountPreview(fixture, {
    entry: "/scripts/testing/model-fallback-preview.tsx", route: "/__origin-model-fallback.html", title: "Origin isolated ranked models and API budgets", hmr: false,
    plugins: [{ name: "model-fallback-fixture-source", enforce: "pre",
      resolveId(id) { return id === "virtual:model-fallback-fixture" ? "\0model-fallback-fixture" : undefined; },
      load(id) { return id === "\0model-fallback-fixture" ? `export const baseline = ${Boolean(beforeRef)};` : undefined; },
      transform(_code, id) { const name = id.split("?")[0]?.replaceAll("\\", "/"); return [...baseline].find(([path]) => name?.endsWith(`/${path}`))?.[1]; },
    }],
    extraRoutes: [
      { path: "/api/instances", method: "GET", handler(_req, res) { res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ instances: profiles })); } },
      { path: /^\/api\/instances\/[\w.-]+\/refresh-models$/, method: "POST", handler(_req, res) { res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ instances: profiles })); } },
      { path: "/api/plan-usage", method: "GET", handler(_req, res) {
        const window = { available: true, usedPercent: 20, remainingPercent: 80, resetsAt: null };
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ fetchedAt: new Date().toISOString(), providers: profiles.filter(value => value.access !== "api").map(value => ({ id: value.instanceId, driver: value.driverKind, name: value.displayName, plan: "Synthetic allowance", ok: true, error: null, fiveHour: window, weekly: window, extra: [] })) }));
      } },
      { path: `/api/bots/${bot.id}`, method: "PATCH", async handler(req, res) {
        const body = await bodyOf(req);
        if (failNext) { failNext = false; observations.push({ method: "PATCH", path: `/api/bots/${bot.id}`, status: 503, patch: JSON.parse(body) }); res.writeHead(503, { "content-type": "application/json" }).end(JSON.stringify({ error: "Synthetic save failure. Your changes are still in the editor." })); return; }
        const response = await fetch(`${fixture.info.url}/api/bots/${bot.id}`, { method: "PATCH", headers: { "content-type": "application/json", origin: fixture.info.url }, body });
        const text = await response.text(); observations.push({ method: "PATCH", path: `/api/bots/${bot.id}`, status: response.status, patch: JSON.parse(body) });
        res.writeHead(response.status, { "content-type": "application/json" }).end(text);
      } },
      { path: "/__fixture/model-fallback/fail-next", method: "POST", handler(_req, res) { failNext = true; res.writeHead(200, { "content-type": "application/json" }).end('{"armed":true}'); } },
      { path: "/__fixture/model-fallback/state", method: "GET", async handler(_req, res) {
        const [savedBots, savedConfig, budget] = await Promise.all([request("GET", "/api/bots"), request("GET", "/api/config"), request("GET", "/api/daily-api-budget")]);
        const savedBot = savedBots.bots.find((value: { id: string }) => value.id === bot.id);
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify({ source, baseline: Boolean(beforeRef), bindings, scope: "Actual ModelPicker, ModelSection and UsageSection with the real StoreProvider and isolated server persistence. Displayed provider catalogs and plan allowances are synthetic; Claude/ChatGPT/Grok profiles use the repository fake Claude CLI and OpenRouter uses a loopback-only API adapter. No provider login, model completion, quota execution, invoice, full App or native acceptance is established.", bot: { id: bot.id, modelSelection: savedBot.modelSelection, fallback: savedBot.fallback, quotaFallback: savedBot.quotaFallback, fallbackApiAllowed: savedBot.fallbackApiAllowed, dailyApiBudgetUsd: savedBot.dailyApiBudgetUsd }, dailyApiBudget: savedConfig.dailyApiBudget, budget, observations, fakeApi: { port: address.port, requests: fakeRequests } }));
      } },
    ],
  });
  console.log(JSON.stringify({ ...fixture.info, source, baseline: Boolean(beforeRef), previewUrl: preview.previewUrl, stateUrl: new URL("/__fixture/model-fallback/state", preview.previewUrl).href, botId: bot.id }));
  await parkUntilSignal();
} finally { await preview?.close(); if (fakeApi.listening) await new Promise<void>(resolve => fakeApi.close(() => resolve())); await fixture.close(); }
