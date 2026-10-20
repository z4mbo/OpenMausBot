import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "./atomic.ts";
import { DATA_DIR } from "./config.ts";
import { clip, connectedStudioCloud, refuse, record, studioRunner, STUDIO_TERMINAL, text, type StudioCloud, type StudioRunner } from "./origin-studio.ts";
import type { StudioGeneration, StudioMediaKind } from "../shared/studio.ts";
import {
  validateWorkflow, workflowNodeModel, workflowOrder, workflowPorts,
  type StudioRunNode, type StudioWorkflowGraph, type StudioWorkflowNode, type StudioWorkflowRun,
} from "../shared/studio-workflow.ts";

export interface WorkflowDeps {
  runner(): StudioRunner;
  cloud(): StudioCloud | null;
  journalFile: string;
  pollMs: number;
  now(): number;
}

type Value = { text: string } | { url: string; kind: StudioMediaKind; generationId?: string; assetId?: string };

/** One run this app is executing, kept on disk so a restart can close it honestly. */
interface Active {
  runId: string;
  projectId: string;
}

const NODE_TIMEOUT_MS = 45 * 60_000;
const CANCEL_CHECK_EVERY = 4;

export interface WorkflowExecutor {
  /** Records a run and executes it in the background; returns its id at once. */
  start(cloud: StudioCloud, projectId: string, run: { workflowId?: string; name: string; graph: StudioWorkflowGraph; agentName?: string }): Promise<string>;
  /** Resolves when the run settles; tests and agents waiting on a run use it. */
  settled(runId: string): Promise<void>;
  cancel(cloud: StudioCloud, projectId: string, runId: string): Promise<void>;
  /** Closes runs a previous app session left open. */
  resume(): Promise<void>;
}

export function createWorkflowExecutor(deps: WorkflowDeps): WorkflowExecutor {
  const running = new Map<string, Promise<void>>();
  const readJournal = (): Active[] => {
    try {
      const raw = existsSync(deps.journalFile) ? JSON.parse(readFileSync(deps.journalFile, "utf8")) as unknown : [];
      return Array.isArray(raw) ? raw.filter((entry): entry is Active => typeof record(entry).runId === "string" && typeof record(entry).projectId === "string") : [];
    } catch {
      return [];
    }
  };
  const writeJournal = (entries: Active[]) => writeFileAtomic(deps.journalFile, JSON.stringify(entries), { mode: 0o600 });

  async function execute(cloud: StudioCloud, projectId: string, runId: string, graph: StudioWorkflowGraph, agentName: string | undefined): Promise<void> {
    const runner = deps.runner();
    const values = new Map<string, Value>();
    const states = new Map<string, StudioRunNode>();
    const generations = new Set<string>();
    let stopped = false;
    let checks = 0;
    const report = async (node: StudioRunNode) => {
      states.set(node.nodeId, node);
      await cloud.client.mutation("studioWorkflows:updateRun", { projectId, sessionToken: cloud.sessionToken, runId, node });
    };
    const cancelled = async () => {
      if (stopped) return true;
      checks += 1;
      if (checks % CANCEL_CHECK_EVERY !== 0) return false;
      const run = record(await cloud.client.query("studioWorkflows:getRun", { projectId, sessionToken: cloud.sessionToken, runId }).catch(() => null));
      stopped = text(run.status) === "cancelled";
      return stopped;
    };
    const inputsOf = (node: StudioWorkflowNode) => new Map(graph.edges.filter((edge) => edge.to === node.id).map((edge) => [edge.toPort, values.get(edge.from)]));

    async function runModel(node: StudioWorkflowNode): Promise<Value> {
      const model = workflowNodeModel(node) ?? refuse("Choose a model.");
      const inputs = inputsOf(node);
      const media = (port: string) => {
        const value = inputs.get(port);
        return value && "url" in value ? value.url : undefined;
      };
      const linked = inputs.get("prompt");
      const prompt = [text(node.params.prompt).trim(), linked && "text" in linked ? linked.text.trim() : ""].filter(Boolean).join("\n\n");
      const sources = model.needs.map((_, index) => media(`in${index}`) ?? refuse(`Connect ${model.label}'s inputs.`));
      const references = [media("ref0"), media("ref1")].filter((url): url is string => Boolean(url));
      const param = (key: string) => (node.params[key] === undefined || node.params[key] === "" ? undefined : node.params[key]);
      const [generationId] = await runner.generate(cloud, {
        projectId, mode: model.mode, model: model.id, prompt,
        ...(param("aspectRatio") ? { aspectRatio: String(param("aspectRatio")) } : {}), ...(param("duration") ? { duration: String(param("duration")) } : {}),
        ...(param("voice") ? { voice: String(param("voice")) } : {}), ...(param("resolution") ? { resolution: String(param("resolution")) } : {}),
        ...(param("motion") ? { motion: String(param("motion")) } : {}), ...(param("negativePrompt") ? { negativePrompt: String(param("negativePrompt")) } : {}),
        ...(Number.isInteger(param("seed")) ? { seed: Number(param("seed")) } : {}), ...(node.params.sound === false ? { sound: false } : {}),
        ...(node.params.brand === false ? { brand: false } : {}),
      }, agentName, { media: { sources, references }, workflow: { runId, nodeId: node.id }, intermediate: true });
      if (!generationId) refuse("fal.ai did not start this step.");
      generations.add(generationId!);
      await report({ nodeId: node.id, status: "running", generationId });
      const deadline = deps.now() + NODE_TIMEOUT_MS;
      for (;;) {
        const row = await cloud.client.query("studio:get", { projectId, sessionToken: cloud.sessionToken, generationId }) as StudioGeneration;
        if (STUDIO_TERMINAL.has(row.status)) {
          generations.delete(generationId!);
          if (row.status !== "done") refuse(row.error ?? `The step was ${row.status}.`);
          const output = row.outputs[0] ?? refuse("fal.ai finished without any media.");
          return { url: output.url, kind: output.kind, generationId };
        }
        if (await cancelled() || deps.now() > deadline) {
          if (!stopped) refuse("This step did not finish within 45 minutes.");
          return refuse("Cancelled");
        }
        await runner.tick();
        await new Promise((done) => setTimeout(done, deps.pollMs));
      }
    }

    async function runNode(node: StudioWorkflowNode): Promise<void> {
      if (node.type === "prompt") {
        values.set(node.id, { text: text(node.params.text) });
        await report({ nodeId: node.id, status: "done" });
        return;
      }
      if (node.type === "asset") {
        const kind = workflowPorts(node).outputs[0]!.kind as StudioMediaKind;
        const assetId = text(node.params.assetId);
        const url = await runner.assetMedia(cloud, projectId, assetId, kind);
        values.set(node.id, { url, kind, assetId });
        await report({ nodeId: node.id, status: "done", assetId, ...(/^https:\/\//i.test(url) ? { output: { url, kind } } : {}) });
        return;
      }
      if (node.type === "model") {
        const value = await runModel(node);
        values.set(node.id, value);
        if ("url" in value) await report({ nodeId: node.id, status: "done", generationId: value.generationId, output: { url: value.url, kind: value.kind } });
        return;
      }
      const incoming = inputsOf(node).get("media");
      if (!incoming || !("url" in incoming)) refuse("Nothing reached this Output.");
      const media = incoming as Extract<Value, { url: string }>;
      const assetId = media.generationId
        ? (await runner.saveAsset(cloud, projectId, media.generationId, 0, text(node.params.name))).assetId
        : media.assetId;
      await report({ nodeId: node.id, status: "done", ...(assetId ? { assetId } : {}), ...(/^https:\/\//i.test(media.url) ? { output: { url: media.url, kind: media.kind } } : {}) });
    }

    const order = workflowOrder(graph) ?? [];
    const finished = new Set<string>();
    let failure = "";
    while (!failure && !stopped && finished.size < order.length) {
      const ready = order.filter((node) => !finished.has(node.id) && graph.edges.filter((edge) => edge.to === node.id).every((edge) => finished.has(edge.from)));
      if (!ready.length) break;
      await Promise.all(ready.map(async (node) => {
        try {
          await runNode(node);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!stopped) failure ||= message;
          await report({ nodeId: node.id, status: stopped ? "cancelled" : "failed", ...(states.get(node.id)?.generationId ? { generationId: states.get(node.id)!.generationId } : {}), ...(stopped ? {} : { error: clip(message, 500) }) }).catch(() => undefined);
        } finally {
          finished.add(node.id);
        }
      }));
    }
    for (const generationId of generations) await runner.cancel(cloud, projectId, generationId).catch(() => undefined);
    if (!stopped) await cloud.client.mutation("studioWorkflows:updateRun", { projectId, sessionToken: cloud.sessionToken, runId, status: failure ? "failed" : "done" });
  }

  return {
    async start(cloud, projectId, run) {
      const problems = validateWorkflow(run.graph);
      if (problems.length) refuse(problems.map((problem) => problem.message).join(" "));
      const runId = text(await cloud.client.mutation("studioWorkflows:startRun", {
        projectId, sessionToken: cloud.sessionToken, name: run.name, graph: run.graph,
        ...(run.workflowId ? { workflowId: run.workflowId } : {}), ...(run.agentName ? { agentName: run.agentName } : {}),
      }));
      writeJournal([...readJournal(), { runId, projectId }]);
      const task = execute(cloud, projectId, runId, run.graph, run.agentName)
        .catch(async (error: unknown) => {
          console.warn(`studio: workflow run failed: ${error instanceof Error ? error.message : String(error)}`);
          await cloud.client.mutation("studioWorkflows:updateRun", { projectId, sessionToken: cloud.sessionToken, runId, status: "failed" }).catch(() => undefined);
        })
        .finally(() => {
          running.delete(runId);
          writeJournal(readJournal().filter((entry) => entry.runId !== runId));
        });
      running.set(runId, task);
      return runId;
    },

    async settled(runId) {
      await running.get(runId);
    },

    async cancel(cloud, projectId, runId) {
      await cloud.client.mutation("studioWorkflows:cancelRun", { projectId, sessionToken: cloud.sessionToken, runId });
    },

    async resume() {
      const cloud = deps.cloud();
      const left = readJournal().filter((entry) => !running.has(entry.runId));
      if (!cloud || !left.length) return;
      for (const entry of left) {
        await cloud.client.mutation("studioWorkflows:updateRun", {
          projectId: entry.projectId, sessionToken: cloud.sessionToken, runId: entry.runId, status: "failed",
        }).catch(() => undefined);
      }
      writeJournal(readJournal().filter((entry) => running.has(entry.runId)));
    },
  };
}

let shared: WorkflowExecutor | null = null;

/** The app server's one executor, shared by the Studio page and agents. */
export function studioWorkflows(): WorkflowExecutor {
  shared ??= createWorkflowExecutor({
    runner: studioRunner, cloud: () => connectedStudioCloud(), journalFile: join(DATA_DIR, "studio-runs.json"), pollMs: 2_500, now: () => Date.now(),
  });
  return shared;
}

/** One run as a few lines an agent can read. */
export function runSummary(run: StudioWorkflowRun): string {
  const lines = run.nodes.filter((node) => node.status !== "waiting" || run.status === "running").map((node) => {
    const graphNode = run.graph.nodes.find((candidate) => candidate.id === node.nodeId);
    const label = graphNode?.type === "model" ? workflowNodeModel(graphNode)?.label ?? "model" : graphNode?.type ?? node.nodeId;
    return `  ${node.nodeId} ${label}: ${node.status}${node.output ? ` ${node.output.url}` : ""}${node.assetId && graphNode?.type === "output" ? ` · asset ${node.assetId}` : ""}${node.error ? ` (${clip(node.error, 160)})` : ""}`;
  });
  return [`- run ${run._id} "${run.name}" [${run.status}] by ${run.agentName ?? run.createdByName}`, ...lines].join("\n");
}
