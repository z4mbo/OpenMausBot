import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { launchVerificationServer, runControlOmb } from "./control-omb.ts";
import { fixtureApi, mountPreview, parkUntilSignal, REPO_ROOT } from "./testing/preview-fixture.ts";

const fixture = await launchVerificationServer({ SYSTEMROOT: process.env.SYSTEMROOT, WINDIR: process.env.WINDIR, OMB_TEST_PORTS: "26510-26600" }, undefined, undefined, undefined, undefined, { scripted: true });
let preview: Awaited<ReturnType<typeof mountPreview>> | undefined;
let beforePreview: Awaited<ReturnType<typeof mountPreview>> | undefined;
try {
  const request = fixtureApi(fixture.info.url, { headers: { origin: fixture.info.url } });
  const cli = (...args: string[]) => runControlOmb([...args, "--url", fixture.info.url]) as Promise<any>;
  const chief = (await cli("new-bot", "--name", "Origin", "--section", "Origin demo")).bot;
  const researcher = (await cli("new-bot", "--name", "Researcher", "--section", "Origin demo")).bot;
  await cli("new-bot", "--name", "Designer", "--section", "Origin demo");
  await request("PATCH", `/api/bots/${chief.id}`, { chiefOfStaff: true, acknowledgePeerScope: true });
  await writeFile(join(fixture.info.dataDir, "room-plan.json"), JSON.stringify({
    [chief.id]: { steps: [{ arguments: { bot_ids: [researcher.id], message: "Research the project navigation", thread: "new" } }], reply: "Research assigned", resumeReply: "The navigation research is ready for review." },
    [researcher.id]: { reply: "Project A research: put the essential navigation where teammates can find it, and retain the exact parent conversation link." },
  }));
  await cli("send", "--bot", chief.id, "--text", "Have Researcher review project navigation.");
  await cli("wait", "--bot", chief.id, "--timeout", "30");
  let snapshot = await request("GET", "/api/bots");
  const linked = snapshot.bots.find((bot: any) => bot.id === researcher.id).tasks.find((task: any) => task.openedBy?.botId === chief.id);
  if (!linked) throw new Error("The actual coordinator did not create the specialist conversation");
  const direct = await request("POST", `/api/bots/${researcher.id}/tasks`, {});
  await request("PATCH", `/api/bots/${researcher.id}/tasks/${direct.bot.threadId}`, { title: "Independent B" });
  await writeFile(join(fixture.info.dataDir, "room-plan.json"), JSON.stringify({
    [chief.id]: { steps: [{ arguments: { bot_ids: [researcher.id], message: "Research the project navigation" } }], reply: "Research assigned", resumeReply: "The navigation follow-up is ready." },
    [researcher.id]: { reply: "This direct conversation is independent of the project research." },
  }));
  await cli("send", "--bot", researcher.id, "--text", "This is an independent direct conversation B.");
  await cli("wait", "--bot", researcher.id, "--timeout", "30");
  const bindings = await Promise.all(["src/components/ProjectAgentsPage.tsx", "src/components/AgentThreads.tsx", "src/lib/origin-agent-navigation.ts", "src/state/store.tsx", "src/state/thread-navigation.ts", "server/delegation-thread.ts"].map(async name => ({ name, sha256: createHash("sha256").update(await readFile(join(REPO_ROOT, name))).digest("hex") })));
  preview = await mountPreview(fixture, {
    entry: "/scripts/testing/origin-agent-threads-preview.tsx", route: "/__origin-agent-threads.html", title: "Origin isolated specialist conversations", hmr: false,
    plugins: [{ name: "isolated-agents-cloud", config() { return { define: { "import.meta.env.VITE_ORIGIN_CONVEX_URL": "undefined" } }; } }],
    extraRoutes: [{ path: "/__fixture/agent-threads/state", method: "GET", async handler(_req, res) {
      snapshot = await request("GET", "/api/bots");
      res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ chiefId: chief.id, researcherId: researcher.id, parentThreadId: chief.activeTaskId, linkedThreadId: linked.threadId, directThreadId: direct.bot.threadId, bots: snapshot.bots.map((bot: any) => ({ id: bot.id, threadId: bot.threadId, tasks: bot.tasks })), bindings, scope: "Actual ProjectAgentsPage, ChatView, StoreProvider and isolated fake-engine server/coordinator. Synthetic local people and conversations only. Not full App, real provider, cloud hosting or packaged desktop acceptance." }));
    } }],
  });
  const baseline = execFileSync("git", ["show", "cf9e6fdec944700aa1ee395d05512afbaf95da97:src/components/ProjectAgentsPage.tsx"], { cwd: REPO_ROOT, encoding: "utf8", windowsHide: true });
  beforePreview = await mountPreview(fixture, {
    entry: "/scripts/testing/origin-agent-threads-preview.tsx", route: "/__origin-agent-threads-before.html", title: "Origin specialist conversations before UI", hmr: false,
    plugins: [
      { name: "agents-baseline-ui", enforce: "pre", transform(_code, id) { return id.replaceAll("\\", "/").split("?")[0].endsWith("/src/components/ProjectAgentsPage.tsx") ? { code: baseline, map: null } : undefined; } },
      { name: "isolated-agents-cloud", config() { return { define: { "import.meta.env.VITE_ORIGIN_CONVEX_URL": "undefined" } }; } },
    ],
  });
  console.log(JSON.stringify({ ...fixture.info, previewUrl: preview.previewUrl, beforePreviewUrl: beforePreview.previewUrl, baselineUiSource: "cf9e6fdec944700aa1ee395d05512afbaf95da97", chiefId: chief.id, researcherId: researcher.id, linkedThreadId: linked.threadId, directThreadId: direct.bot.threadId }));
  await parkUntilSignal();
} finally { await beforePreview?.close(); await preview?.close(); await fixture.close(); }
