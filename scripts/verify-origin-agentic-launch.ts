import { createServer, type IncomingMessage } from "node:http";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { parseArgs } from "node:util";
import { runControlOmb } from "./control-omb.ts";
import { spawnLiveServer } from "../evals/live/live-server.ts";
import { makeClient, waitUntil } from "../evals/runners/api.ts";
import { startFakeConvex, type FakeConvex } from "./testing/origin-campaigns-backend.ts";
import { REPO_ROOT } from "./testing/preview-fixture.ts";

type Json = Record<string, unknown>;

const CHEAP_MODELS = /^(claude-haiku-[\w.-]+|gpt-[\w.-]*luna[\w.-]*)$/i;
const PROMPT = "We launch Origin Lite next week. Make a launch image for it, draft a post for it on X and Bluesky that uses the image, and add a lead: Grace Hopper, grace@navy.test, from Navy, who asked for a demo. Use the Origin project tools; do not ask me anything first.";

const { values } = parseArgs({
  options: {
    cli: { type: "string" },
    "config-dir": { type: "string" },
    model: { type: "string", default: "claude-haiku-5-5" },
    evidence: { type: "string", default: join(REPO_ROOT, "docs", "verification", "evidence", "origin-agentic-launch") },
    "timeout-ms": { type: "string", default: "300000" },
  },
});
const cli = values.cli ?? "";
const configDir = values["config-dir"] ?? "";
const model = values.model!;
if (!isAbsolute(cli) || !isAbsolute(configDir)) throw new Error("Pass --cli <absolute path to the Claude Code CLI> and --config-dir <absolute path to a signed-in Claude config folder>.");
if (!CHEAP_MODELS.test(model)) throw new Error(`Agentic runs use cheap models only (Claude Haiku or GPT Luna), not ${model}.`);

async function seed(convex: FakeConvex) {
  const { t, ref } = convex;
  const { createSession } = await convex.load<{ createSession(ctx: unknown, userId: string): Promise<string> }>("convex/lib/auth.ts");
  const token = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: "ada", email: "ada@fixture.test", role: "user", status: "active", passwordHash: "unused", salt: "unused", iterations: 1, createdAt: 1, updatedAt: 1 });
    return createSession(ctx, userId);
  });
  const { teamId } = await t.mutation(ref("workspaces:create"), { sessionToken: token, name: "Fixture" }) as { teamId: string };
  const projectId = String(await t.mutation(ref("projects:create"), { sessionToken: token, teamId, name: "Origin Lite" }));
  return { token, projectId };
}

/** A fal.ai queue on loopback: every request is recorded, every job completes on its first status poll. */
async function startFakeFal() {
  const requests: Array<{ method: string; path: string; auth: boolean; body: unknown }> = [];
  const read = async (req: IncomingMessage) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    try { return raw ? JSON.parse(raw) as unknown : null; } catch { return raw; }
  };
  let next = 0;
  const server = createServer(async (req, res) => {
    const path = req.url ?? "/";
    requests.push({ method: req.method ?? "GET", path, auth: req.headers.authorization === "Key fixture-id:fixture-secret", body: await read(req) });
    const reply = (status: number, body: Json) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    if (req.method === "POST") {
      next += 1;
      const job = `${base}${path}/requests/fixture-${next}`;
      return reply(200, { request_id: `fixture-${next}`, status_url: `${job}/status`, response_url: job, cancel_url: `${job}/cancel` });
    }
    if (path.endsWith("/status")) return reply(200, { status: "COMPLETED" });
    if (path.endsWith("/cancel")) return reply(400, { status: "ALREADY_COMPLETED" });
    return reply(200, { images: [{ url: "https://cdn.fixture.test/origin-lite-launch.png", content_type: "image/png" }] });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

const convex = await startFakeConvex();
const fal = await startFakeFal();
const seeded = await seed(convex);
const instance = { instanceId: "cheap-claude", driver: "claudeAgent", model, displayName: "Cheap Claude", config: { cli, configDir } };
const session = await spawnLiveServer({ ...process.env, OMB_FAL_QUEUE_URL: fal.url }, instance, []);
const started = Date.now();
try {
  writeFileSync(join(session.dataDir, "integration-keys.json"), JSON.stringify({ fal: { key: "fixture-id:fixture-secret" } }), { mode: 0o600 });
  const api = await makeClient(session.url);
  const created = await runControlOmb(["new-bot", "--name", "Atlas"], { env: { OPENMAUSBOT_URL: session.url } }) as { bot: { id: string; activeTaskId: string } };
  const chief = created.bot;
  for (const patch of [{ modelSelection: { instanceId: instance.instanceId, model }, section: "Origin Lite" }, { chiefOfStaff: true, managedSections: ["Origin Lite"], acknowledgePeerScope: true }]) {
    const patched = await api.patch(`/api/bots/${chief.id}`, patch);
    if (patched.status >= 300) throw new Error(`bot patch failed: ${JSON.stringify(patched.body)}`);
  }
  writeFileSync(join(session.dataDir, "origin-cloud.json"), JSON.stringify({ url: convex.url, sessionToken: seeded.token, projects: { [chief.id]: seeded.projectId } }), { mode: 0o600 });

  const sent = await api.post(`/api/bots/${chief.id}/messages`, { text: PROMPT, threadId: chief.activeTaskId });
  if (sent.status >= 300) throw new Error(`send failed: ${JSON.stringify(sent.body)}`);
  const timeout = Number(values["timeout-ms"]);
  await waitUntil("the Chief to start", async () => (await api.get("/api/bots?messages=0")).body.bots.find((bot: Json) => bot.id === chief.id)?.busy, (busy) => busy === true, 30_000).catch(() => undefined);
  await waitUntil("the Chief to finish its turn", async () => (await api.get("/api/bots?messages=0")).body.bots.find((bot: Json) => bot.id === chief.id)?.busy, (busy) => busy === false, timeout);

  const messages = ((await api.get(`/api/threads/${chief.activeTaskId}/messages`)).body.messages ?? []) as Array<{ role?: string; kind?: string; text?: string; tool?: { name?: string; ok?: boolean; input?: string; output?: string } }>;
  const clip = (value: string | undefined, max = 600) => (value && value.length > max ? `${value.slice(0, max)}…` : value);
  const tools = messages.filter((message) => message.kind === "activity" && message.tool?.name)
    .map(({ tool }) => ({ name: tool!.name!.replace(/^mcp__agents__/, ""), ok: tool!.ok, input: clip(tool!.input), output: clip(tool!.output) }));
  const reply = messages.filter((message) => message.role === "bot" && message.kind !== "activity" && message.text && !message.text.startsWith("[digest]")).map((message) => message.text!).at(-1) ?? "";
  const q = (name: string) => convex.t.query(convex.ref(name), { sessionToken: seeded.token, projectId: seeded.projectId }) as Promise<unknown>;
  const generations = await q("studio:list") as Json[];
  const posts = (await q("broadcast:list") as { posts: Json[] }).posts;
  const leads = (await q("pipeline:board") as { leads: Json[] }).leads;
  const falSubmits = fal.requests.filter((request) => request.method === "POST");

  const checks = {
    studioGenerationRequested: falSubmits.length > 0 && falSubmits.every((request) => request.auth) && generations.some((row) => row.agentName === "Atlas"),
    broadcastDraftAwaitsApproval: posts.some((post) => post.status === "draft" && post.needsApproval === true && post.agentName === "Atlas"),
    pipelineLeadExists: leads.some((lead) => /grace/i.test(String(lead.name)) || /grace@navy\.test/i.test(String(lead.email))),
  };
  const report = {
    model, engine: "claudeAgent (Claude Code CLI)", prompt: PROMPT, seconds: Math.round((Date.now() - started) / 1000), checks,
    tools,
    fal: falSubmits.map((request) => ({ path: request.path, body: request.body })),
    generations: generations.map((row) => ({ status: row.status, model: row.model, prompt: row.prompt, agentName: row.agentName, saved: (row.saved as unknown[]).length, broadcast: (row.broadcast as unknown[]).length })),
    posts: posts.map((post) => ({ status: post.status, needsApproval: post.needsApproval, agentName: post.agentName, channels: (post.variants as Json[]).map((variant) => variant.channel), text: (post.variants as Json[])[0]?.text, media: (post.media as unknown[] | undefined)?.length ?? 0 })),
    leads: leads.map((lead) => ({ name: lead.name, email: lead.email, company: lead.company, stage: lead.stage })),
    reply,
  };
  mkdirSync(values.evidence!, { recursive: true });
  writeFileSync(join(values.evidence!, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (!Object.values(checks).every(Boolean)) process.exitCode = 1;
} finally {
  const kept = join(tmpdir(), `origin-agentic-launch-${started}.log`);
  copyFileSync(session.logPath, kept);
  console.error(`server log kept at ${kept}`);
  await session.close();
  await fal.close();
  await convex.close();
}
