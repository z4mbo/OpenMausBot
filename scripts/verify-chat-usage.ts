import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { launchVerificationServer, runControlOmb } from "./control-omb.ts";
import { fixtureApi, mountPreview, parkUntilSignal, REPO_ROOT } from "./testing/preview-fixture.ts";

const fixture = await launchVerificationServer({ SYSTEMROOT: process.env.SYSTEMROOT, WINDIR: process.env.WINDIR, OMB_TEST_PORTS: "26410-26500", FAKE_CLAUDE_CACHE_READ_TOKENS: "32000", FAKE_CLAUDE_TOOL_CALLS: "[]", FAKE_CLAUDE_REPLIES: JSON.stringify(["The project has a clear next step: review the current behavior together, confirm the expected result, then make one focused change.\n\nThe conversation and composer now share a readable centered column. The usage panel can stay open while you work, with provider allowance and current context kept separate.\n\nThis reply comes from the repository’s fake CLI in a disposable workspace. No real model or account is called."]) });
let preview: Awaited<ReturnType<typeof mountPreview>> | undefined;
try {
  const request = fixtureApi(fixture.info.url, { headers: { origin: fixture.info.url } });
  await runControlOmb(["new-bot", "--name", "Atlas", "--url", fixture.info.url]);
  const { bots } = await request("GET", "/api/bots");
  const bot = bots.find((value: { name: string }) => value.name === "Atlas");
  if (!bot) throw new Error("Synthetic chat bot was not created");
  await runControlOmb(["send", "--bot", bot.id, "--text", "Review the conversation layout and tell me what to check next.", "--url", fixture.info.url]);
  await runControlOmb(["wait", "--bot", bot.id, "--timeout", "30", "--url", fixture.info.url]);
  const bindings = await Promise.all(["src/components/ChatView.tsx", "src/components/ChatUsagePopover.tsx", "src/components/PlanUsage.tsx", "src/lib/chat-width.ts", "src/lib/chat-usage-preferences.ts", "src/styles.css"].map(async name => ({ name, sha256: createHash("sha256").update(await readFile(join(REPO_ROOT, name))).digest("hex") })));
  let unavailable = false;
  preview = await mountPreview(fixture, {
    entry: "/scripts/testing/chat-usage-preview.tsx", route: "/__origin-chat-usage.html", title: "Origin isolated usage and chat layout", hmr: false,
    plugins: [{ name: "isolated-chat-cloud", config() { return { define: { "import.meta.env.VITE_ORIGIN_CONVEX_URL": "undefined" } }; } }],
    extraRoutes: [
      { path: "/api/plan-usage", method: "GET", handler(_req, res) {
        const now = Date.now();
        const window = (usedPercent: number, delay: number) => ({ available: true, usedPercent, remainingPercent: 100 - usedPercent, resetsAt: new Date(now + delay).toISOString() });
        res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ fetchedAt: new Date(now).toISOString(), providers: [{ id: "claude", name: "Synthetic Claude account", driver: "claudeAgent", plan: "Fixture allowance", ok: !unavailable, error: unavailable ? "Plan usage is unavailable for this synthetic account. Model access is checked separately." : null, fiveHour: window(32, 3_600_000), weekly: window(61, 86_400_000), extra: [] }] }));
      } },
      { path: "/__fixture/chat-usage/availability", method: "POST", async handler(req, res) { let body = ""; for await (const part of req) { body += String(part); if (body.length > 1024) throw new Error("Oversized fixture control"); } unavailable = JSON.parse(body).unavailable === true; res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ unavailable })); } },
      { path: "/__fixture/chat-usage/state", method: "GET", async handler(_req, res) { const snapshot = await request("GET", "/api/bots"); const current = snapshot.bots.find((value: { id: string }) => value.id === bot.id); res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ source: "working-tree", bindings, botId: bot.id, threadId: current.threadId, usage: current.tasks?.find((task: { threadId: string }) => task.threadId === current.threadId)?.usage, scope: "Actual ChatView, StoreProvider, Composer and usage components. Conversation and context accounting come through the actual isolated server/fake Claude CLI. Subscription quota data is a controlled synthetic report; no real provider quota, model or account is used. Not full App or packaged desktop acceptance." })); } },
    ],
  });
  console.log(JSON.stringify({ ...fixture.info, previewUrl: preview.previewUrl, stateUrl: new URL("/__fixture/chat-usage/state", preview.previewUrl).href, botId: bot.id }));
  await parkUntilSignal();
} finally { await preview?.close(); await fixture.close(); }
