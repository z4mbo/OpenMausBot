import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Bot, ModelSelection } from "../src/state/store.tsx";
import type { ModelHostingReport, HostingSourceSettings } from "../src/components/ModelHostingSettings.tsx";
import { mountPreview, parkUntilSignal, REPO_ROOT } from "./testing/preview-fixture.ts";

const folder = join(REPO_ROOT, ".omb-scratch/project-order-native-042");
const native = JSON.parse(await readFile(join(folder, "fixture.json"), "utf8"));
assert.equal(native.pushExit, 0);
const url = new URL(native.url); assert.equal(url.hostname, "127.0.0.1");
assert.ok(![3210, 3211, 5199, 8799].includes(Number(url.port)));
const instance = await fetch(new URL("/instance_name", url), { signal: AbortSignal.timeout(2_000) }).then(response => response.text());
assert.equal(instance.replaceAll('"', "").trim(), native.instance);
const seed = JSON.parse(await readFile(join(folder, "private/project-order-accounts.json"), "utf8"));
const teamId: string = seed.teamId;
const initialSource: HostingSourceSettings = { sourceKey: randomUUID(), sourceId: "fixture-source-local", instanceId: "claude", provider: "claudeAgent", label: "My Claude account", billing: "subscription", models: ["sonnet"], enabled: false, projectIds: [seed.projects[0].id], workspaceHead: false, capacity: 1 };
const settings: ModelHostingReport = { ready: true, computerName: "Fixture computer", teams: [teamId], hosts: [{ teamId, hostId: "fixture-local-host", sources: [initialSource] }], instances: [
  { instanceId: "claude", provider: "claudeAgent", displayName: "Claude fixture account", available: true, billing: "subscription", models: ["sonnet", "opus"] },
  { instanceId: "paid", provider: "openai-compat", displayName: "OpenRouter fixture API", available: true, billing: "metered", models: ["openai/gpt-5.6"] },
] };
let bot: Bot = { id: "fixture-atlas", threadId: "fixture-thread", name: "Atlas", title: "", description: "", color: "blue", notifications: false, unread: false, messages: [], modelSelection: { instanceId: "claude", model: "opus" }, tasks: [{ threadId: "fixture-thread", title: "Main", createdAt: Date.now() }], shared: { teamId, agentId: "fixture-agent", canEdit: true } };
const profiles = settings.instances.map(item => ({ instanceId: item.instanceId, driverKind: item.provider, displayName: item.displayName, access: item.billing === "metered" ? "api" : "subscription", snapshot: { state: "available", authenticated: true, billing: item.billing }, models: { default: item.models[0], options: item.models.map(model => ({ id: model, label: model })) } }));
const observations: Array<{ method: string; path: string; body?: unknown; status: number }> = [];
const bindings = await Promise.all(["src/components/ModelPicker.tsx", "src/components/ModelFallbackSettings.tsx", "src/components/RemoteModelPicker.tsx", "src/components/SharedModelChoices.tsx", "src/components/ModelHostingSettings.tsx", "src/components/ProviderConnectionsSettings.tsx", "src/lib/origin-model-hosts.ts", "src/lib/model-picker-selection.ts", "shared/model-selection.ts", "shared/wire.ts", "src/styles.css", "src/locales/en.json", "scripts/testing/model-host-preview.tsx", "scripts/verify-model-host-ui.ts"].map(async name => ({ name, sha256: createHash("sha256").update(await readFile(join(REPO_ROOT, name))).digest("hex") })));
let offline = false, failNext = false, ready = true;
const catalog = () => offline ? [] : [
  { hostId: "fixture-alice-mac", sourceId: "fixture-alice-claude", ownerUserId: "alice", ownerName: "Alice", computerName: "MacBook", provider: "claudeAgent", label: "Claude", billing: "subscription", models: ["sonnet", "opus"], heartbeatAt: Date.now(), expiresAt: Date.now() + 60_000, capacity: 1 },
  { hostId: "fixture-alice-windows", sourceId: "fixture-alice-windows-claude", ownerUserId: "alice", ownerName: "Alice", computerName: "Windows desktop", provider: "claudeAgent", label: "Claude", billing: "subscription", models: ["sonnet"], heartbeatAt: Date.now(), expiresAt: Date.now() + 60_000, capacity: 1 },
  { hostId: "fixture-bob-linux", sourceId: "fixture-bob-api", ownerUserId: "bob", ownerName: "Bob", computerName: "Linux server", provider: "openai-compat", label: "OpenRouter API", billing: "metered", models: ["openai/gpt-5.6"], heartbeatAt: Date.now(), expiresAt: Date.now() + 60_000, capacity: 1 },
];
const json = (res: ServerResponse, data: unknown, status = 200) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(data)); };
const bodyOf = async (req: IncomingMessage) => { let text = ""; for await (const part of req) { text += String(part); if (Buffer.byteLength(text) > 65_536) throw new Error("Oversized fixture request"); } return JSON.parse(text || "{}"); };
const checkFailure = (res: ServerResponse, method: string, path: string, body: unknown) => { const failed = failNext; failNext = false; observations.push({ method, path, body, status: failed ? 503 : 200 }); if (failed) json(res, { error: "Synthetic save failure; your editor changes are preserved." }, 503); return failed; };
const validateSelection = (selection: ModelSelection) => !selection.source || catalog().some(source => source.hostId === selection.source?.hostId && source.sourceId === selection.source?.sourceId && source.models.includes(selection.model));
const cache = join(folder, "ui-model-host"); await mkdir(cache, { recursive: true });
const preview = await mountPreview({ info: { url: url.origin, dataDir: cache } }, {
  entry: "/scripts/testing/model-host-preview.tsx", route: "/__origin-model-host.html", title: "Origin isolated shared model UI", hmr: false,
  plugins: [{ name: "isolated-host-ui-cloud", config() { return { define: { "import.meta.env.VITE_ORIGIN_CONVEX_URL": "undefined" } }; } }],
  extraRoutes: [
    { path: "/__fixture/model-host-ui/bootstrap", method: "GET", handler(_req, res) { json(res, { url: url.origin, sessionToken: seed.owner, bot, profiles }); } },
    { path: "/api/auth/session", method: "GET", handler(_req, res) { json(res, { kind: "loopback" }); } },
    { path: "/api/origin/model-host/catalog", method: "GET", handler(_req, res) { observations.push({ method: "GET", path: "/api/origin/model-host/catalog", status: 200 }); json(res, { ready, sources: ready ? catalog() : [] }); } },
    { path: "/api/origin/model-host", method: "GET", handler(_req, res) { observations.push({ method: "GET", path: "/api/origin/model-host", status: 200 }); json(res, ready ? settings : { ready: false, reason: "Shared hosting is awaiting native verification.", computerName: settings.computerName, teams: [], hosts: [], instances: [] }); } },
    { path: "/api/origin/model-host/sources", method: "PUT", async handler(req, res) { const body = await bodyOf(req); if (checkFailure(res, "PUT", "/api/origin/model-host/sources", body)) return; assert.equal(body.teamId, teamId); const account = settings.instances.find(item => item.instanceId === body.instanceId); assert.ok(account); const saved = { ...body, sourceKey: body.sourceKey ?? randomUUID(), sourceId: `fixture-${body.sourceKey ?? randomUUID()}`, provider: account.provider, billing: account.billing }; delete saved.teamId; const sources = settings.hosts[0].sources; const index = sources.findIndex(item => item.sourceKey === saved.sourceKey); if (index < 0) sources.push(saved); else sources[index] = saved; json(res, { source: saved }); } },
    { path: "/api/origin/model-host/revoke", method: "POST", async handler(req, res) { const body = await bodyOf(req); if (checkFailure(res, "POST", "/api/origin/model-host/revoke", body)) return; assert.equal(body.teamId, teamId); settings.hosts[0].sources = []; json(res, { ok: true }); } },
    { path: `/api/bots/${bot.id}`, method: "PATCH", async handler(req, res) { const body = await bodyOf(req); if (checkFailure(res, "PATCH", `/api/bots/${bot.id}`, body)) return; if (body.fallback?.some((selection: ModelSelection) => !validateSelection(selection))) { json(res, { error: "The synthetic shared source is offline." }, 409); return; } bot = { ...bot, ...body }; json(res, { bot }); } },
    { path: `/api/bots/${bot.id}/tasks/${bot.threadId}`, method: "PATCH", async handler(req, res) { const body = await bodyOf(req); if (checkFailure(res, "PATCH", `/api/bots/${bot.id}/tasks/${bot.threadId}`, body)) return; if (!validateSelection(body.modelSelection)) { json(res, { error: "The synthetic shared source is offline." }, 409); return; } bot = { ...bot, ...(body.updateBotDefault ? { modelSelection: body.modelSelection } : {}), tasks: bot.tasks?.map(task => ({ ...task, modelSelection: body.modelSelection, followsBotModel: body.updateBotDefault === true })) }; json(res, { bot }); } },
    { path: "/api/daily-api-budget", method: "GET", handler(_req, res) { json(res, { timeZone: "Europe/Rome", day: "synthetic", resetsAt: new Date(Date.now() + 3_600_000).toISOString(), spentUsd: 0, reservedUsd: 0, unknownCost: false, agents: [] }); } },
    { path: "/__fixture/model-host-ui/control", method: "POST", async handler(req, res) { const body = await bodyOf(req); if (typeof body.offline === "boolean") offline = body.offline; if (typeof body.ready === "boolean") ready = body.ready; if (body.failNext) failNext = true; json(res, { offline, failNext, ready }); } },
    { path: "/__fixture/model-host-ui/state", method: "GET", handler(_req, res) { json(res, { source: "working-tree", bindings, bot, settings, offline, observations, scope: "Actual ModelPicker, ranked fallback and owner sharing components with controlled HTTP catalog and source/grant persistence in this disposable preview process. Native042 synthetic workspace/project queries are real. Store context is a controlled adapter using the actual reducer. No provider, host registration, remote execution, invoice, full App or native desktop acceptance is established." }); } },
  ],
});
console.log(JSON.stringify({ previewUrl: preview.previewUrl, stateUrl: new URL("/__fixture/model-host-ui/state", preview.previewUrl).href, native: url.origin, scope: "Synthetic source UI only; no host execution" }));
try { await parkUntilSignal(); } finally { await preview.close(); }
