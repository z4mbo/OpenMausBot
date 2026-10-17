import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { launchVerificationServer } from "./control-omb.ts";
import { planImport, runImport, type CloudLinks } from "../src/lib/origin-import.ts";

const cloud = { workspaces: [{ _id: "team1", name: "Import verification" }], projects: [{ _id: "project1", teamId: "team1", name: "Resumable project" }] };
const lead = { title: "Project lead", description: "Fixture only", soul: "Coordinate the six project specialists." };
const fake = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const input = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { path: string; args: Record<string, unknown>[] };
  const args = input.args[0];
  let value: unknown;
  if (args?.sessionToken !== "origin-import-fixture-session") value = null;
  else if (input.path === "auth:me") value = { _id: "fixtureuser", email: "import-fixture@example.test", name: "Import fixture" };
  else if (input.path === "workspaces:list") value = cloud.workspaces;
  else if (input.path === "projects:get") value = cloud.projects.find((project) => project._id === args.projectId) ?? null;
  else value = null;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ status: "success", value, logLines: [] }));
});
await new Promise<void>((done) => fake.listen(0, "127.0.0.1", done));
const cloudUrl = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
const evidence = join(import.meta.dirname, "..", "docs", "verification", "evidence", "origin-import");
const events: unknown[] = [];
let closeFixture: (() => Promise<void>) | undefined;
try {
  const fixture = await launchVerificationServer();
  closeFixture = () => fixture.close();
  mkdirSync(evidence, { recursive: true });
  const request = async <T,>(path: string, init?: { method?: string; body?: string }): Promise<T> => {
    const response = await fetch(fixture.info.url + path, { ...init, headers: { origin: fixture.info.url, "content-type": "application/json" } });
    const answer = await response.json() as T & { error?: string };
    events.push({ path, status: response.status });
    if (!response.ok) throw new Error(answer.error ?? `HTTP ${response.status}`);
    return answer;
  };
  await request("/api/origin/cloud-session", { method: "PUT", body: JSON.stringify({ url: cloudUrl, sessionToken: "origin-import-fixture-session" }) });
  const localBots = async () => (await request<{ bots: { id: string; name: string; section?: string; chiefOfStaff?: boolean; managedSections?: string[] }[] }>("/api/bots?messages=0")).bots;
  const links = () => request<CloudLinks>("/api/origin/cloud-links");
  const plan = async () => planImport(cloud, { bots: await localBots(), links: await links() }, { workspaces: ["team1"], projects: ["project1"] });
  const linksPartial = join(fixture.info.dataDir, `origin-cloud-links.json.${fixture.info.pid}.tmp`);
  mkdirSync(linksPartial);
  const blockedWorkspace = await runImport(await plan(), { call: request, lead });
  assert.equal(blockedWorkspace.failures.length, 2);
  assert.equal((await localBots()).length, 2);
  const savedHead = (await localBots()).find((bot) => bot.name === "Import verification")!;
  rmdirSync(linksPartial);
  const cloudPartial = join(fixture.info.dataDir, `origin-cloud.json.${fixture.info.pid}.tmp`);
  const blockedProject = await runImport(await plan(), { call: async <T,>(path: string, init?: { method?: string; body?: string }): Promise<T> => {
    if (path === "/api/origin/import/projects") mkdirSync(cloudPartial);
    return request<T>(path, init);
  }, lead });
  assert.equal(blockedProject.failures.length, 1);
  assert.equal((await localBots()).length, 9);
  assert.equal(blockedProject.createdWorkspaces[0].botId, savedHead.id);
  const savedChief = (await localBots()).find((bot) => bot.name === "Resumable project")!;
  rmdirSync(cloudPartial);
  const stalePlan = await plan();
  const restored = await runImport(stalePlan, { call: request, lead });
  assert.equal(restored.failures.length, 0);
  assert.equal(restored.createdProjects[0].botId, savedChief.id);
  assert.equal(restored.createdProjects[0].agents, 6);
  const lostResponse = await runImport(stalePlan, { call: async <T,>(path: string, init?: { method?: string; body?: string }): Promise<T> => {
    await request<T>(path, init);
    throw new Error("Fixture simulated a lost response after the server committed");
  }, lead });
  assert.equal(lostResponse.failures.length, 1);
  const replay = await runImport(stalePlan, { call: request, lead });
  assert.equal(replay.createdProjects[0].botId, savedChief.id);
  const body = JSON.stringify({ cloudProjectId: "project1", cloudTeamId: "team1", workspaceId: savedHead.id, ...lead });
  const concurrent = await Promise.all([request<{ bot: { id: string } }>("/api/origin/import/projects", { method: "POST", body }), request<{ bot: { id: string } }>("/api/origin/import/projects", { method: "POST", body })]);
  assert.deepEqual(concurrent.map((answer) => answer.bot.id), [savedChief.id, savedChief.id]);
  const finalBots = await localBots();
  const finalLinks = await links();
  assert.equal(finalBots.length, 9);
  assert.deepEqual(finalBots.find((bot) => bot.id === savedHead.id)?.managedSections, [savedChief.section]);
  assert.deepEqual(finalLinks.projects, { [savedChief.id]: "project1" });
  assert.equal(finalBots.filter((bot) => bot.section === savedChief.section).length, 7);
  assert.equal(JSON.stringify(finalBots).includes("originImport"), false);
  const stored = JSON.parse(readFileSync(join(fixture.info.dataDir, "bots.json"), "utf8")) as { id: string; originImport?: { memberIds: string[] } }[];
  assert.equal(stored.find((bot) => bot.id === savedChief.id)?.originImport?.memberIds.length, 6);
  const result = { fixture: fixture.info, syntheticCloud: cloudUrl, verification: "real isolated HTTP server and real runImport client; synthetic cloud access checks; no live account or provider", workspaceLinkFailure: blockedWorkspace, projectLinkFailure: blockedProject, restored, lostResponse, replay, final: { botCount: finalBots.length, headId: savedHead.id, chiefId: savedChief.id, links: finalLinks }, events };
  writeFileSync(join(evidence, "result.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ passed: true, evidence: join(evidence, "result.json"), logPath: fixture.info.logPath, botCount: finalBots.length }));
} finally {
  try { await closeFixture?.(); }
  finally { await new Promise<void>((done) => fake.close(() => done())); }
}
