import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createElement, type FunctionComponent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import { startFakeConvex, type FakeConvex } from "../scripts/testing/origin-campaigns-backend.ts";
import { decodeScene } from "../shared/canvas-scene.ts";
import { DESIGN_BRIEF } from "./origin-canvas-tools.ts";

type Json = Record<string, any>;

// The app's component, loaded through Vite's "@" alias, which this tsconfig does not resolve.
const DESIGN_CHIPS = "@/components/origin-pages/canvas/DesignChips";

const cloud = vi.hoisted(() => ({ links: [] as unknown[] }));
vi.mock("@/lib/origin-cloud", () => ({
  useCloudQuery: (name: string) => (name === "canvasCollab:designsForIssue" ? cloud.links : undefined),
}));

async function seed(convex: FakeConvex) {
  const { t, ref } = convex;
  const { createSession } = await convex.load<{ createSession(ctx: unknown, userId: string): Promise<string> }>("convex/lib/auth.ts");
  const sessionToken = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: "ada", email: "ada@fixture.test", role: "user", status: "active", passwordHash: "unused", salt: "unused", iterations: 1, createdAt: 1, updatedAt: 1 });
    return createSession(ctx, userId);
  });
  const { teamId } = await t.mutation(ref("workspaces:create"), { sessionToken, name: "Fixture" }) as { teamId: string };
  const projectId = String(await t.mutation(ref("projects:create"), { sessionToken, teamId, name: "Origin Lite" }));
  const canvasId = String(await t.mutation(ref("draw:createCanvas"), { sessionToken, projectId, name: "Product" }));
  const taskId = String(await t.mutation(ref("tasks:createTask"), {
    sessionToken, projectId, title: "Design the pricing page", description: "Three plans side by side with a call to action.", priority: "high", assignedToEmail: "ada@fixture.test", dueDate: "2030-01-31",
  }));
  return { sessionToken, teamId, projectId, canvasId, taskId };
}

/**
 * A claude CLI wrapper around the fake engine: each bot's scripted turns play in order, one per launch, so a Chief
 * resumed by its teammate's result does not assign the issue again.
 */
function scriptedEngine(dataDir: string) {
  const planFile = join(dataDir, "design-plan.json");
  const wrapper = join(dataDir, "design-cli.mjs");
  writeFileSync(planFile, "{}");
  writeFileSync(wrapper, [
    "#!/usr/bin/env node",
    'import { readFileSync, writeFileSync } from "node:fs";',
    'import { join } from "node:path";',
    'const at = process.argv.indexOf("--mcp-config");',
    'const env = at < 0 ? undefined : JSON.parse(readFileSync(process.argv[at + 1], "utf8")).mcpServers?.agents?.env;',
    "if (env?.OMB_BOT_ID) {",
    `  const planFile = ${JSON.stringify(planFile)};`,
    '  const plan = JSON.parse(readFileSync(planFile, "utf8"));',
    "  const turns = plan[env.OMB_BOT_ID] ?? [];",
    "  const turn = turns.shift() ?? { replies: [\"Done.\"], tools: [] };",
    "  plan[env.OMB_BOT_ID] = turns;",
    "  writeFileSync(planFile, JSON.stringify(plan));",
    "  process.env.FAKE_CLAUDE_REPLIES = JSON.stringify(turn.replies ?? [\"Done.\"]);",
    "  process.env.FAKE_CLAUDE_TOOL_CALLS = JSON.stringify(turn.tools ?? []);",
    "  process.env.FAKE_CLAUDE_EXIT_AFTER_TURN = \"1\";",
    `  process.env.FAKE_CLAUDE_DUMP = join(${JSON.stringify(dataDir)}, env.OMB_THREAD_ID + ".json");`,
    "}",
    `await import(${JSON.stringify(pathToFileURL(join(process.cwd(), "server/testing/fake-claude-cli.ts")).href)});`,
  ].join("\n"), { mode: 0o700 });
  const plan = (botId: string, turns: Json[]) => {
    const current = JSON.parse(readFileSync(planFile, "utf8")) as Json;
    current[botId] = turns;
    writeFileSync(planFile, JSON.stringify(current));
  };
  return { wrapper, plan };
}

it("a design issue assigned to an agent ends as frames in review with a Design chip on the issue", async () => {
  const convex = await startFakeConvex();
  const fixture = await launchVerificationServer(process.env);
  const { url, dataDir } = fixture.info;
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(url + path, { method, headers: { "content-type": "application/json", origin: url }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = await response.json() as Json;
    expect(response.status, `${method} ${path}: ${JSON.stringify(value)}`).toBe(200);
    return value;
  };
  const control = (args: string[]) => runControlOmb([...args, "--url", url]) as Promise<Json>;
  const bots = async () => (await api("GET", "/api/bots")).bots as Json[];
  const messages = async (threadId: string) => (await api("GET", `/api/threads/${threadId}/messages?limit=200`)).messages as Json[];
  const query = (name: string, args: Json) => convex.t.query(convex.ref(name), args) as Promise<any>;
  try {
    const seeded = await seed(convex);
    const chief = (await control(["new-bot", "--name", "Clive", "--section", "Origin Lite"])).bot;
    await api("PATCH", `/api/bots/${chief.id}`, { chiefOfStaff: true });
    const designer = (await control(["new-bot", "--name", "Dana", "--section", "Origin Lite"])).bot;
    writeFileSync(join(dataDir, "origin-cloud.json"), JSON.stringify({
      url: convex.url, sessionToken: seeded.sessionToken, projects: { [chief.id]: seeded.projectId, [designer.id]: seeded.projectId },
    }), { mode: 0o600 });

    const engine = scriptedEngine(dataDir);
    await api("PATCH", "/api/instances/claude", { cli: engine.wrapper });
    const agents = (name: string, input: Json) => ({ name, server: "agents", input });
    engine.plan(chief.id, [{
      tools: [agents("origin_assign_issue", { bot_id: designer.id, issue_id: seeded.taskId, design: true, instructions: "Keep it to one screen." })],
      replies: ["Dana has the pricing design."],
    }]);
    engine.plan(designer.id, [{
      tools: [
        agents("origin_canvas", { canvas: "Product" }),
        agents("origin_canvas_edit", { canvas: "Product", ops: [{ op: "create", node: {
          type: "frame", name: "Pricing", x: 0, y: 0, w: 480, h: 320, fill: "#FFFFFF", children: [
            { type: "text", name: "Title", x: 24, y: 24, text: "Pricing", fontSize: 28 },
            { type: "rect", name: "Starter", x: 24, y: 80, w: 132, h: 200, fill: "#EEF2FF", radius: 12 },
            { type: "rect", name: "Team", x: 174, y: 80, w: 132, h: 200, fill: "#E0E7FF", radius: 12 },
            { type: "rect", name: "Scale", x: 324, y: 80, w: 132, h: 200, fill: "#C7D2FE", radius: 12 },
          ],
        } }] }),
        agents("origin_canvas_screenshot", { canvas: "Product", node: "Pricing" }),
        agents("origin_canvas_comment", { canvas: "Product", text: "Three plans, the middle one highlighted." }),
        agents("origin_design_submit", { canvas: "Product", issue_id: seeded.taskId, frames: ["Pricing"], rationale: "Plans side by side so the price difference reads at a glance." }),
      ],
      replies: ["The pricing design is in review."],
    }]);

    await control(["send", "--bot", chief.id, "--text", "Assign the pricing page design to Dana."]);

    let designThread = "";
    await expect.poll(async () => {
      const dana = (await bots()).find((bot) => bot.id === designer.id);
      for (const task of dana?.tasks ?? []) {
        if ((await messages(task.threadId)).some((m) => m.kind === "activity" && m.tool?.itemId && /origin_design_submit/.test(m.tool.name) && m.tool.ok === true)) designThread = task.threadId;
      }
      return designThread;
    }, { timeout: 90_000, interval: 1_000 }).not.toBe("");

    const designerRun = JSON.parse(readFileSync(join(dataDir, `${designThread}.json`), "utf8")) as Json;
    expect(JSON.stringify(designerRun.prompt)).toContain(JSON.stringify(DESIGN_BRIEF).slice(1, -1));
    const chiefLog = await messages(chief.activeTaskId);
    expect(chiefLog.some((m) => m.kind === "activity" && /origin_assign_issue/.test(m.tool?.name ?? "") && m.tool?.ok === true), JSON.stringify(chiefLog.filter((m) => m.kind === "activity"))).toBe(true);

    const activity = (await messages(designThread)).filter((m) => m.kind === "activity" && m.tool?.itemId);
    const ran = (tool: string) => activity.find((m) => m.tool.name.endsWith(tool));
    for (const tool of ["origin_canvas", "origin_canvas_edit", "origin_canvas_screenshot", "origin_canvas_comment", "origin_design_submit"]) {
      expect(ran(tool)?.tool?.ok, `${tool}: ${JSON.stringify(activity.map((m) => m.tool))}`).toBe(true);
    }
    const images = (await messages(designThread)).flatMap((m) => (m.attachments ?? []) as Json[]).filter((a) => a.kind === "image");
    expect(images.map((a) => a.mime), JSON.stringify(await messages(designThread))).toEqual(["image/png"]);

    const scope = { sessionToken: seeded.sessionToken, teamId: seeded.teamId, canvasId: seeded.canvasId };
    const scene = decodeScene(await query("draw:scene", scope) as string[]);
    const frame = scene.find((node) => node.type === "frame" && node.name === "Pricing" && !node.deleted);
    expect(frame?.issue).toBe(seeded.taskId);
    expect(scene.filter((node) => node.parentId === frame!.id).map((node) => node.name).sort()).toEqual(["Scale", "Starter", "Team", "Title"]);
    const comments = await query("canvasCollab:comments", scope) as Json[];
    expect(comments.some((c) => c.body === "Three plans, the middle one highlighted." && c.agentName === "Dana")).toBe(true);
    expect(comments.some((c) => c.nodeId === frame!.id && /at a glance/.test(c.body))).toBe(true);
    const links = await query("canvasCollab:designsForIssue", { sessionToken: seeded.sessionToken, taskId: seeded.taskId }) as Json[];
    expect(links).toEqual([expect.objectContaining({ frameId: frame!.id, frameName: "Pricing", status: "review", agentName: "Dana", canvasId: seeded.canvasId })]);

    cloud.links = links;
    const { DesignChips } = await import(/* @vite-ignore */ DESIGN_CHIPS) as { DesignChips: FunctionComponent<{ projectId: string; taskId: string; className: string }> };
    const markup = renderToStaticMarkup(createElement(DesignChips, { projectId: seeded.projectId, taskId: seeded.taskId, className: "chip" }));
    expect(markup).toContain(`data-design-chip="${frame!.id}"`);
    expect(markup.replace(/<[^>]+>/g, "")).toBe("DesignPricingin review");
  } finally {
    await fixture.close();
    await convex.close();
  }
}, 180_000);
