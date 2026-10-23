import { projectIntegrationKey } from "../integration-keys.ts";
import { DailyApiBudgetError } from "../daily-api-budget.ts";
import { clip, connectedStudioCloud, record, refuse, StudioRefusal, studioRunner, text, type StudioCloud, type StudioRunner } from "../origin-studio.ts";
import { studioWorkflows, type WorkflowExecutor } from "../origin-studio-workflow.ts";
import { PASS, type RouteHandler } from "./table.ts";
import type { StudioGenerateRequest, StudioMode, StudioSource } from "../../shared/studio.ts";
import {
  CAMPAIGN_BRIEF_NODE, CAMPAIGN_PACK_ID, CAMPAIGN_SCRIPT_NODE, studioWorkflowTemplate, withCharacter, withWorkflowInputs, type StudioWorkflowGraph,
} from "../../shared/studio-workflow.ts";

const MODES = ["image", "video", "audio", "edit"];

function sourcesOf(value: unknown): StudioSource[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.slice(0, 4).map((entry) => {
    const source = record(entry);
    if (text(source.assetId)) return { assetId: text(source.assetId).slice(0, 64) };
    if (text(source.generationId)) return { generationId: text(source.generationId).slice(0, 64), index: Math.max(0, Math.trunc(Number(source.index) || 0)) };
    return refuse("Each source needs assetId or generationId.");
  });
}

export function generateRequest(body: Record<string, unknown>): StudioGenerateRequest {
  const mode = text(body.mode);
  if (!MODES.includes(mode)) refuse("mode must be image, video, audio or edit.");
  const optional = (key: string) => (text(body[key]).trim() ? { [key]: text(body[key]).trim().slice(0, 200) } : {});
  const sources = sourcesOf(body.sources);
  const references = Array.isArray(body.referenceAssetIds) ? body.referenceAssetIds.map(text).filter(Boolean).slice(0, 4) : [];
  const parent = record(body.parent);
  return {
    projectId: text(body.projectId) || refuse("projectId is required."),
    mode: mode as StudioMode,
    model: text(body.model) || refuse("Choose a model."),
    prompt: text(body.prompt),
    ...optional("aspectRatio"), ...optional("duration"), ...optional("voice"), ...optional("sourceAssetId"), ...optional("endpoint"),
    ...optional("resolution"), ...optional("motion"), ...optional("angle"), ...optional("preset"), ...optional("template"), ...optional("characterId"),
    ...(text(body.negativePrompt).trim() ? { negativePrompt: text(body.negativePrompt).slice(0, 2_000) } : {}),
    ...(Number.isInteger(body.seed) ? { seed: Number(body.seed) } : {}),
    ...(typeof body.sound === "boolean" ? { sound: body.sound } : {}),
    ...(sources ? { sources } : {}), ...(references.length ? { referenceAssetIds: references } : {}),
    ...(text(parent.generationId) ? { parent: { generationId: text(parent.generationId), action: text(parent.action).slice(0, 40) || "remix" } } : {}),
    ...(typeof body.count === "number" ? { count: body.count } : {}), ...(typeof body.brand === "boolean" ? { brand: body.brand } : {}),
    ...(body.input && typeof body.input === "object" && !Array.isArray(body.input) ? { input: body.input as Record<string, unknown> } : {}),
  };
}

const POSTS = new Set([
  "/api/studio/generate", "/api/studio/save-asset", "/api/studio/broadcast", "/api/studio/cancel", "/api/studio/enhance", "/api/studio/voice-preview",
  "/api/studio/workflow/run", "/api/studio/workflow/cancel", "/api/studio/campaign",
]);

/** Starts the Campaign pack from a brief; the script and caption the person left empty are written from it. */
async function startCampaign(runner: StudioRunner, workflows: WorkflowExecutor, cloud: StudioCloud, projectId: string, body: Record<string, unknown>) {
  const brief = text(body.brief).trim().slice(0, 4_000) || refuse("Write a brief first.");
  let script = text(body.script).trim();
  let caption = text(body.caption).trim();
  if (!script || !caption) {
    const copy = await runner.campaignCopy(brief, { projectId }).catch(error => {
      if (error instanceof DailyApiBudgetError) throw error;
      return { script: brief, caption: brief };
    });
    script ||= copy.script;
    caption ||= copy.caption;
  }
  const template = studioWorkflowTemplate(CAMPAIGN_PACK_ID)!;
  const graph = withCharacter(withWorkflowInputs(template.graph, { [CAMPAIGN_BRIEF_NODE]: brief, [CAMPAIGN_SCRIPT_NODE]: script }), text(body.characterId) || undefined);
  const runId = await workflows.start(cloud, projectId, { name: clip(`${template.name}: ${brief.replace(/\s+/g, " ")}`, 120), graph, caption });
  return { runId, script, caption };
}

export function createStudioRoutes(options: { runner?: () => StudioRunner; workflows?: () => WorkflowExecutor; cloud?: () => StudioCloud | null; falConfigured?: (projectId: string | undefined) => boolean } = {}): RouteHandler {
  let resumed = false;
  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    if (!path.startsWith("/api/studio/")) return PASS;
    const runner = (options.runner ?? studioRunner)();
    const workflows = (options.workflows ?? studioWorkflows)();
    const cloud = (options.cloud ?? connectedStudioCloud)();
    if (!resumed) {
      resumed = true;
      runner.resume();
      void workflows.resume().catch(() => undefined);
    }
    if (path === "/api/studio/status" && method === "GET") {
      const projectId = url.searchParams.get("projectId") || undefined;
      return json(res, 200, { fal: (options.falConfigured ?? ((id) => projectIntegrationKey("fal", id) !== null))(projectId), connected: Boolean(cloud) });
    }
    if (method !== "POST" || !POSTS.has(path)) return PASS;
    if (!auth.scopes.includes("admin")) return json(res, 403, { error: "Studio runs on this app's own keys and needs the admin scope" });
    const body = record(await readBody(req));
    try {
      if (path === "/api/studio/enhance") return json(res, 200, { prompt: await runner.enhance(text(body.prompt), (MODES.includes(text(body.mode)) ? text(body.mode) : "image") as StudioMode, { projectId: text(body.projectId) || undefined }) });
      if (path === "/api/studio/voice-preview") return json(res, 200, { url: await runner.voicePreview(text(body.voice), { projectId: text(body.projectId) || undefined }) });
      if (!cloud) return json(res, 409, { error: "Sign in to Origin first." });
      if (path === "/api/studio/generate") return json(res, 200, { ids: await runner.generate(cloud, generateRequest(body)) });
      const projectId = text(body.projectId);
      if (!projectId) return json(res, 400, { error: "projectId is required" });
      if (path === "/api/studio/workflow/run" || path === "/api/studio/campaign") await runner.checkBudget({ projectId });
      if (path === "/api/studio/workflow/run") {
        const template = text(body.templateId) ? studioWorkflowTemplate(text(body.templateId)) : undefined;
        const graph = (body.graph && typeof body.graph === "object" ? body.graph : template?.graph) as StudioWorkflowGraph | undefined;
        if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return json(res, 400, { error: "graph is required" });
        const runId = await workflows.start(cloud, projectId, {
          name: clip(text(body.name) || template?.name || "Workflow", 120), graph,
          ...(text(body.workflowId) ? { workflowId: text(body.workflowId) } : {}), ...(text(body.caption).trim() ? { caption: text(body.caption) } : {}),
        });
        return json(res, 200, { runId });
      }
      if (path === "/api/studio/campaign") return json(res, 200, await startCampaign(runner, workflows, cloud, projectId, body));
      if (path === "/api/studio/workflow/cancel") {
        await workflows.cancel(cloud, projectId, text(body.runId) || refuse("runId is required."));
        return json(res, 200, { ok: true });
      }
      const generationId = text(body.generationId);
      const index = Math.trunc(Number(body.index) || 0);
      if (!generationId) return json(res, 400, { error: "projectId and generationId are required" });
      if (path === "/api/studio/cancel") return json(res, 200, await runner.cancel(cloud, projectId, generationId));
      if (path === "/api/studio/save-asset") return json(res, 200, await runner.saveAsset(cloud, projectId, generationId, index));
      return json(res, 200, await runner.pickForBroadcast(cloud, projectId, generationId, index, body.picked !== false));
    } catch (error) {
      if (error instanceof DailyApiBudgetError) return json(res, 409, { error: error.message, code: "daily_api_budget" });
      if (error instanceof StudioRefusal) return json(res, 400, { error: error.message });
      const raw = error instanceof Error ? error.message : String(error);
      const message = (/Uncaught Error: ([^\n]+)/.exec(raw)?.[1] ?? raw).replaceAll(cloud?.sessionToken ?? "\u0000", "[redacted]");
      return json(res, 502, { error: clip(message.trim(), 400) });
    }
  };
}
