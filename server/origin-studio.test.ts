import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runOriginTool, type OriginCloudClient } from "./origin-cloud.ts";
import { createStudioRunner, falQueueOrigin, isFalMediaUrl, type StudioCloud, type StudioDeps } from "./origin-studio.ts";
import { createWorkflowExecutor } from "./origin-studio-workflow.ts";
import type { BotRecord } from "./store.ts";
import type { StudioGeneration } from "../shared/studio.ts";
import { studioWorkflowTemplate, withWorkflowInputs, type StudioWorkflowRun } from "../shared/studio-workflow.ts";

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function scratch(name: string) {
  const folder = mkdtempSync(join(tmpdir(), "omb-studio-"));
  folders.push(folder);
  return join(folder, name);
}
const journal = () => scratch("studio-jobs.json");

const DEPLOYMENT = "http://127.0.0.1:3210";

function fakeConvex() {
  const rows = new Map<string, StudioGeneration>();
  const runs = new Map<string, StudioWorkflowRun>();
  const assets: Record<string, unknown>[] = [
    { _id: "asset-logo", name: "Logo", type: "image", contentType: "image/png", fileUrl: "http://127.0.0.1:3211/api/storage/logo" },
    { _id: "asset-link", name: "Moodboard", type: "image", url: "https://images.example.com/mood.png", fileUrl: "https://images.example.com/mood.png" },
    { _id: "asset-doc", name: "Brief", type: "document", contentType: "application/pdf", fileUrl: "http://127.0.0.1:3211/api/storage/brief" },
    { _id: "asset-voice", name: "Voice", type: "audio", contentType: "audio/mpeg", url: "https://cdn.example.com/voice.mp3", fileUrl: "https://cdn.example.com/voice.mp3" },
  ];
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const uploads: Array<{ url: string; bytes: number; contentType: string }> = [];
  let next = 1;
  const handle = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    calls.push({ name, args });
    const id = String(args.generationId);
    switch (name) {
      case "studio:create": {
        const generationId = `gen${next++}`;
        rows.set(generationId, {
          _id: generationId, projectId: String(args.projectId), mode: args.mode, model: args.model, modelLabel: args.modelLabel, kind: args.kind,
          prompt: args.prompt, status: "queued", outputs: [], saved: [], broadcast: [], createdByName: "Ana",
          ...(args.intermediate ? { intermediate: true } : {}), ...(args.params ? { params: args.params } : {}),
          ...(args.parentId ? { parentId: args.parentId, action: args.action } : {}),
          ...(args.agentName ? { agentName: args.agentName } : {}), createdAt: next, updatedAt: next,
        } as StudioGeneration);
        return generationId;
      }
      case "studio:update": {
        const row = rows.get(id)!;
        if (["done", "failed", "cancelled"].includes(row.status)) return null;
        const outputs = (args.outputs ?? row.outputs) as StudioGeneration["outputs"];
        const saved = args.status === "done" && !row.intermediate ? outputs.map((_, index) => ({ index, assetId: `asset-${id}-${index}` })) : row.saved;
        rows.set(id, {
          ...row, status: args.status as StudioGeneration["status"], outputs, saved,
          ...(args.error ? { error: String(args.error) } : {}), ...(typeof args.queuePosition === "number" ? { queuePosition: args.queuePosition } : {}),
        });
        return null;
      }
      case "studio:storeFile": return `asset-${id}-${String(args.index)}`;
      case "studio:get": return rows.get(id);
      case "studio:list": return [...rows.values()].filter((row) => !row.intermediate).reverse();
      case "studio:saveAsset": {
        const row = rows.get(id)!;
        const assetId = `asset-${id}-${String(args.index)}`;
        rows.set(id, { ...row, saved: [...row.saved, { index: Number(args.index), assetId }] });
        return assetId;
      }
      case "studio:useInBroadcast": {
        const row = rows.get(id)!;
        const saved = row.saved.find((entry) => entry.index === args.index)!;
        rows.set(id, { ...row, broadcast: [{ index: Number(args.index), assetId: saved.assetId, at: 1 }] });
        return null;
      }
      case "studioWorkflows:startRun": {
        const runId = `run${runs.size + 1}`;
        const graph = args.graph as StudioWorkflowRun["graph"];
        runs.set(runId, { _id: runId, projectId: String(args.projectId), name: String(args.name), graph, status: "running", nodes: graph.nodes.map((node) => ({ nodeId: node.id, status: "waiting" })), createdByName: "Ana", ...(args.agentName ? { agentName: String(args.agentName) } : {}), createdAt: 1, updatedAt: 1 });
        return runId;
      }
      case "studioWorkflows:updateRun": {
        const run = runs.get(String(args.runId))!;
        if (run.status !== "running") return null;
        const node = args.node as StudioWorkflowRun["nodes"][number] | undefined;
        const nodes = node ? run.nodes.map((entry) => (entry.nodeId === node.nodeId ? node : entry)) : run.nodes;
        const status = (args.status as StudioWorkflowRun["status"] | undefined) ?? run.status;
        runs.set(run._id, { ...run, status, nodes: status === "running" ? nodes : nodes.map((entry) => (entry.status === "waiting" || entry.status === "running" ? { ...entry, status: "skipped" } : entry)) });
        return null;
      }
      case "studioWorkflows:cancelRun": {
        const run = runs.get(String(args.runId))!;
        runs.set(run._id, { ...run, status: "cancelled" });
        return null;
      }
      case "studioWorkflows:getRun": return runs.get(String(args.runId));
      case "studioWorkflows:runs": return [...runs.values()].reverse();
      case "studioWorkflows:list": return [];
      case "studioWorkflows:get": return null;
      case "design:list": return { assets, tokens: [] };
      case "design:generateUploadUrl": return `${DEPLOYMENT}/upload?token=1`;
      case "projects:get": return { _id: args.projectId, name: "Kai", teamId: "team1", memberRole: "member" };
      default: return null;
    }
  };
  const client: OriginCloudClient = {
    query: handle,
    mutation: handle,
    async upload(url, data, contentType) {
      uploads.push({ url, bytes: data.byteLength, contentType });
      return "storage1";
    },
  };
  return { client, rows, runs, calls, uploads };
}

function fakeFal(options: { submitStatus?: number; submitBody?: unknown; result?: unknown; failWith?: string; cancelled?: "requested" | "completed"; origin?: string; queued?: number } = {}) {
  const origin = options.origin ?? "https://queue.fal.run";
  const requests: Array<{ url: string; method: string; auth: string | null; body?: unknown }> = [];
  const polls = new Map<string, number>();
  const endpoints = new Map<string, string>();
  let submitted = 0;
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : undefined;
    requests.push({ url, method: init?.method ?? "GET", auth: headers.get("authorization"), ...(body ? { body } : {}) });
    if (url.startsWith(`${origin}/`) && init?.method === "POST") {
      if (options.submitStatus) return Response.json(options.submitBody ?? {}, { status: options.submitStatus });
      submitted += 1;
      const base = `${origin}/fal-ai/job/requests/req${submitted}`;
      endpoints.set(base, url.slice(origin.length + 1));
      return Response.json({ request_id: `req${submitted}`, status_url: `${base}/status`, response_url: base, cancel_url: `${base}/cancel` });
    }
    if (url.endsWith("/cancel") && init?.method === "PUT") {
      return options.cancelled === "completed" ? Response.json({ status: "ALREADY_COMPLETED" }, { status: 400 }) : Response.json({ status: "CANCELLATION_REQUESTED" }, { status: 202 });
    }
    if (url.endsWith("/status")) {
      const count = (polls.get(url) ?? 0) + 1;
      polls.set(url, count);
      if (options.queued && count === 1) return Response.json({ status: "IN_QUEUE", queue_position: options.queued });
      if (count === 1) return Response.json({ status: "IN_PROGRESS" });
      return Response.json(options.failWith ? { status: "COMPLETED", error: options.failWith } : { status: "COMPLETED" });
    }
    if (url.startsWith(`${origin}/`)) {
      const endpoint = endpoints.get(url) ?? "";
      if (options.result) return Response.json(options.result);
      if (endpoint === "fal-ai/any-llm") return Response.json({ output: "\"A cinematic launch poster, neon dusk light\"" });
      if (endpoint.includes("elevenlabs")) return Response.json({ audio: { url: "https://v3.fal.media/files/voice.mp3", content_type: "audio/mpeg" } });
      if (endpoint.includes("video") || endpoint.includes("ffmpeg") || endpoint.includes("avatar")) return Response.json({ video: { url: `https://v3.fal.media/files/${endpoint.split("/").pop()}.mp4`, content_type: "video/mp4" } });
      return Response.json({ images: [{ url: "https://v3.fal.media/files/out.png", content_type: "image/png" }], description: "" });
    }
    if (url === "https://v3.fal.media/files/out.png") return new Response(new Uint8Array([1, 2, 3, 4]), { headers: { "content-type": "image/png" } });
    if (url === "http://127.0.0.1:3211/api/storage/logo") return new Response(new Uint8Array([9, 9]), { headers: { "content-type": "image/png" } });
    return new Response("unexpected", { status: 500 });
  }) as typeof fetch;
  const submits = () => requests.filter((request) => request.method === "POST");
  return { fetch: fetchFn, requests, submits };
}

function setup(options: { key?: string | null; fal?: ReturnType<typeof fakeFal>; file?: string; queueOrigin?: string } = {}) {
  const convex = fakeConvex();
  const fal = options.fal ?? fakeFal();
  const cloud: StudioCloud = { client: convex.client, sessionToken: "session", url: DEPLOYMENT };
  const deps: StudioDeps = {
    fetch: fal.fetch, falKey: () => (options.key === undefined ? "fal-test-key" : options.key), cloud: () => cloud,
    journalFile: options.file ?? journal(), voiceCacheFile: scratch("voices.json"), now: () => Date.now(), pollMs: 60_000,
    ...(options.queueOrigin ? { queueOrigin: options.queueOrigin } : {}),
  };
  return { convex, fal, cloud, deps, runner: createStudioRunner(deps) };
}

describe("Studio runner", () => {
  it("queues one fal request per variation, records progress and files the result in Assets", async () => {
    const { runner, cloud, convex, fal } = setup();
    const ids = await runner.generate(cloud, { projectId: "kai", mode: "image", model: "fal-ai/nano-banana-pro", prompt: "  launch poster ", aspectRatio: "16:9", resolution: "2K", seed: 7, count: 2 });
    expect(ids).toEqual(["gen1", "gen2"]);
    expect(fal.submits()).toHaveLength(2);
    expect(fal.submits()[0]).toMatchObject({ url: "https://queue.fal.run/fal-ai/nano-banana-pro", auth: "Key fal-test-key", body: { prompt: "launch poster", aspect_ratio: "16:9", resolution: "2K", seed: 7, num_images: 1 } });
    expect(convex.rows.get("gen1")!.params).toEqual({ resolution: "2K", seed: 7 });
    expect(runner.pending()).toBe(2);
    await runner.tick();
    expect(convex.rows.get("gen1")!.status).toBe("running");
    await runner.tick();
    expect(convex.rows.get("gen1")).toMatchObject({ status: "done", outputs: [{ url: "https://v3.fal.media/files/out.png", kind: "image", contentType: "image/png" }], saved: [{ index: 0, assetId: "asset-gen1-0" }] });
    expect(convex.uploads).toHaveLength(2);
    expect(convex.uploads[0]).toEqual({ url: `${DEPLOYMENT}/upload?token=1`, bytes: 4, contentType: "image/png" });
    expect(convex.calls.find((call) => call.name === "studio:storeFile")!.args).toMatchObject({ generationId: "gen1", index: 0, storageId: "storage1", size: 4 });
    expect(runner.pending()).toBe(0);
  });

  it("reports fal's queue position while a generation waits", async () => {
    const { runner, cloud, convex } = setup({ fal: fakeFal({ queued: 3 }) });
    await runner.generate(cloud, { projectId: "kai", mode: "image", model: "fal-ai/flux/schnell", prompt: "x" });
    await runner.tick();
    expect(convex.rows.get("gen1")).toMatchObject({ status: "queued", queuePosition: 3 });
  });

  it("asks for the fal key before creating anything", async () => {
    const { runner, cloud, convex } = setup({ key: null });
    await expect(runner.generate(cloud, { projectId: "kai", mode: "image", model: "fal-ai/flux/schnell", prompt: "x" })).rejects.toThrow(/fal\.ai key/);
    expect(convex.calls).toHaveLength(0);
  });

  it("marks the generation failed with fal's own reason when it refuses the request", async () => {
    const fal = fakeFal({ submitStatus: 422, submitBody: { detail: [{ msg: "prompt is required" }] } });
    const { runner, cloud, convex } = setup({ fal });
    expect(await runner.generate(cloud, { projectId: "kai", mode: "image", model: "fal-ai/flux/schnell", prompt: "x", count: 3 })).toEqual(["gen1"]);
    expect(convex.rows.get("gen1")).toMatchObject({ status: "failed", error: "prompt is required" });
    expect(runner.pending()).toBe(0);
  });

  it("records a failure fal reports on completion", async () => {
    const { runner, cloud, convex } = setup({ fal: fakeFal({ failWith: "NSFW content detected" }) });
    await runner.generate(cloud, { projectId: "kai", mode: "image", model: "fal-ai/nano-banana-pro", prompt: "x" });
    await runner.tick();
    await runner.tick();
    expect(convex.rows.get("gen1")).toMatchObject({ status: "failed", error: "NSFW content detected", saved: [] });
  });

  it("starts image-to-video from a project image, inlined from the deployment's storage", async () => {
    const { runner, cloud, fal } = setup();
    await expect(runner.generate(cloud, { projectId: "kai", mode: "video", model: "fal-ai/veo3.1/image-to-video", prompt: "fly" })).rejects.toThrow(/starts from image/);
    await runner.generate(cloud, { projectId: "kai", mode: "video", model: "fal-ai/veo3.1/image-to-video", prompt: "fly", sourceAssetId: "asset-logo", duration: "6s", motion: "dolly-in", sound: false });
    expect(fal.submits()[0]!.body).toEqual({ prompt: "fly. Camera: slow dolly in towards the subject.", aspect_ratio: "auto", duration: "6s", resolution: "720p", image_url: "data:image/png;base64,CQk=", generate_audio: false });
    await runner.generate(cloud, { projectId: "kai", mode: "edit", model: "fal-ai/seedvr/upscale/image", prompt: "", sourceAssetId: "asset-link" });
    expect(fal.requests.some((request) => request.url === "https://images.example.com/mood.png")).toBe(false);
    expect(fal.submits()[1]!.body).toMatchObject({ image_url: "https://images.example.com/mood.png", upscale_factor: 2 });
    await expect(runner.generate(cloud, { projectId: "kai", mode: "edit", model: "fal-ai/seedvr/upscale/image", prompt: "", sourceAssetId: "asset-doc" })).rejects.toThrow(/not an image/);
  });

  it("animates and voices earlier outputs, linking each to its parent", async () => {
    const { runner, cloud, convex, fal } = setup();
    await runner.generate(cloud, { projectId: "kai", mode: "image", model: "fal-ai/nano-banana-pro", prompt: "portrait" });
    await runner.tick();
    await runner.tick();
    await runner.generate(cloud, { projectId: "kai", mode: "video", model: "fal-ai/kling-video/v3/pro/image-to-video", prompt: "smile", sources: [{ generationId: "gen1" }], parent: { generationId: "gen1", action: "animate" } });
    expect(fal.submits()[1]).toMatchObject({ url: "https://queue.fal.run/fal-ai/kling-video/v3/pro/image-to-video", body: { start_image_url: "https://v3.fal.media/files/out.png" } });
    expect(convex.rows.get("gen2")).toMatchObject({ parentId: "gen1", action: "animate" });
    await expect(runner.generate(cloud, { projectId: "kai", mode: "video", model: "fal-ai/veo3.1/fast/extend-video", prompt: "more", sources: [{ generationId: "gen1" }] })).rejects.toThrow(/is an image, not video/);
    await runner.generate(cloud, { projectId: "kai", mode: "video", model: "fal-ai/kling-video/ai-avatar/v2/pro", prompt: "", sources: [{ generationId: "gen1" }, { assetId: "asset-voice" }] });
    expect(fal.submits()[2]!.body).toEqual({ image_url: "https://v3.fal.media/files/out.png", audio_url: "https://cdn.example.com/voice.mp3" });
  });

  it("switches to the reference-taking endpoint when reference images are given", async () => {
    const { runner, cloud, fal } = setup();
    await runner.generate(cloud, { projectId: "kai", mode: "image", model: "fal-ai/nano-banana-pro", prompt: "our mascot at the beach", referenceAssetIds: ["asset-link"], brand: false });
    expect(fal.submits()[0]).toMatchObject({ url: "https://queue.fal.run/fal-ai/nano-banana-pro/edit", body: { image_urls: ["https://images.example.com/mood.png"], prompt: "our mascot at the beach" } });
  });

  it("refuses a model of another mode and a malformed custom endpoint", async () => {
    const { runner, cloud } = setup();
    await expect(runner.generate(cloud, { projectId: "kai", mode: "audio", model: "fal-ai/flux/schnell", prompt: "x" })).rejects.toThrow(/not audio/);
    await expect(runner.generate(cloud, { projectId: "kai", mode: "image", model: "custom", endpoint: "../../etc", prompt: "x" })).rejects.toThrow(/endpoint/);
  });

  it("runs a custom endpoint with its own input", async () => {
    const { runner, cloud, fal } = setup();
    await runner.generate(cloud, { projectId: "kai", mode: "image", model: "custom", endpoint: "comfy/ana/poster-flow", prompt: "", input: { steps: 20, prompt: "neon" } });
    expect(fal.submits()[0]).toMatchObject({ url: "https://queue.fal.run/comfy/ana/poster-flow", body: { steps: 20, prompt: "neon" } });
  });

  it("enhances a prompt with the cheap model and caches voice samples", async () => {
    const { runner, fal } = setup();
    expect(await runner.enhance("poster", "image")).toBe("A cinematic launch poster, neon dusk light");
    expect(fal.submits()[0]).toMatchObject({ url: "https://queue.fal.run/fal-ai/any-llm", body: { model: "google/gemini-2.5-flash-lite", prompt: "poster" } });
    expect(await runner.voicePreview("Brian")).toBe("https://v3.fal.media/files/voice.mp3");
    expect(await runner.voicePreview("Brian")).toBe("https://v3.fal.media/files/voice.mp3");
    expect(fal.submits()).toHaveLength(2);
    await expect(runner.voicePreview("Nobody")).rejects.toThrow(/no voice/);
  });

  it("saves an output that is not yet in Assets, copying fal files and linking any other", async () => {
    const { runner, cloud, convex, fal } = setup();
    await runner.generate(cloud, { projectId: "kai", mode: "image", model: "fal-ai/nano-banana-pro", prompt: "poster" });
    await runner.tick();
    await runner.tick();
    expect(await runner.saveAsset(cloud, "kai", "gen1", 0)).toEqual({ assetId: "asset-gen1-0", copied: true });
    const row = convex.rows.get("gen1")!;
    convex.rows.set("gen1", { ...row, saved: [] });
    expect(await runner.saveAsset(cloud, "kai", "gen1", 0, "Hero")).toEqual({ assetId: "asset-gen1-0", copied: true });
    expect(convex.calls.filter((call) => call.name === "studio:saveAsset").at(-1)!.args).toMatchObject({ storageId: "storage1", name: "Hero.png", size: 4 });
    convex.rows.set("gen1", { ...row, saved: [], outputs: [{ url: "https://169.254.169.254/latest", kind: "image" }] });
    const before = fal.requests.length;
    expect(await runner.saveAsset(cloud, "kai", "gen1", 0)).toMatchObject({ copied: false });
    expect(fal.requests.length).toBe(before);
    await runner.pickForBroadcast(cloud, "kai", "gen1", 0, true);
    expect(convex.rows.get("gen1")!.broadcast).toEqual([{ index: 0, assetId: "asset-gen1-0", at: 1 }]);
  });

  it("resumes polling from its journal after a restart", async () => {
    const file = journal();
    const first = setup({ file });
    await first.runner.generate(first.cloud, { projectId: "kai", mode: "image", model: "fal-ai/nano-banana-pro", prompt: "x" });
    const second = createStudioRunner({ ...first.deps });
    expect(second.pending()).toBe(1);
    await second.tick();
    await second.tick();
    expect(first.convex.rows.get("gen1")!.status).toBe("done");
  });

  it("cancels a queued generation on fal and stops polling it", async () => {
    const { runner, cloud, convex, fal } = setup();
    await runner.generate(cloud, { projectId: "kai", mode: "image", model: "fal-ai/nano-banana-pro", prompt: "x" });
    expect(await runner.cancel(cloud, "kai", "gen1")).toEqual({ cancelled: true });
    expect(fal.requests.find((request) => request.method === "PUT")).toMatchObject({ url: "https://queue.fal.run/fal-ai/job/requests/req1/cancel", auth: "Key fal-test-key" });
    expect(convex.rows.get("gen1")!.status).toBe("cancelled");
    expect(runner.pending()).toBe(0);
  });

  it("settles a generation fal had already finished instead of cancelling it", async () => {
    const { runner, cloud, convex } = setup({ fal: fakeFal({ cancelled: "completed" }) });
    await runner.generate(cloud, { projectId: "kai", mode: "image", model: "fal-ai/nano-banana-pro", prompt: "x" });
    await runner.tick();
    expect(await runner.cancel(cloud, "kai", "gen1")).toEqual({ cancelled: false });
    expect(convex.rows.get("gen1")!.status).toBe("done");
    expect(runner.pending()).toBe(0);
  });

  it("marks a generation no app is polling as cancelled", async () => {
    const { runner, cloud, convex, fal } = setup();
    await runner.generate(cloud, { projectId: "kai", mode: "image", model: "fal-ai/nano-banana-pro", prompt: "x" });
    const other = createStudioRunner({ ...setup().deps, cloud: () => cloud });
    expect(await other.cancel(cloud, "kai", "gen1")).toEqual({ cancelled: true });
    expect(fal.requests.some((request) => request.method === "PUT")).toBe(false);
    expect(convex.rows.get("gen1")!.status).toBe("cancelled");
  });

  it("queues on a loopback fake only when one is configured", async () => {
    expect(falQueueOrigin({ OMB_FAL_QUEUE_URL: "http://127.0.0.1:4555" })).toBe("http://127.0.0.1:4555");
    expect(falQueueOrigin({ OMB_FAL_QUEUE_URL: "http://fal.example.com" })).toBe("https://queue.fal.run");
    const origin = "http://127.0.0.1:4555";
    const { runner, cloud, convex, fal } = setup({ fal: fakeFal({ origin }), queueOrigin: origin });
    await runner.generate(cloud, { projectId: "kai", mode: "image", model: "fal-ai/nano-banana-pro", prompt: "x" });
    await runner.tick();
    await runner.tick();
    expect(fal.requests.every((request) => !request.url.startsWith("https://queue.fal.run"))).toBe(true);
    expect(convex.rows.get("gen1")!.status).toBe("done");
  });

  it("trusts only fal's media hosts for downloads", () => {
    expect(isFalMediaUrl("https://v3.fal.media/files/a.png")).toBe(true);
    expect(isFalMediaUrl("https://fal.media.evil.com/a.png")).toBe(false);
    expect(isFalMediaUrl("http://v3.fal.media/a.png")).toBe(false);
    expect(isFalMediaUrl("https://127.0.0.1/a.png")).toBe(false);
  });
});

describe("Studio workflows", () => {
  function executor(base: ReturnType<typeof setup>) {
    const runner = createStudioRunner({ ...base.deps, pollMs: 1 });
    return { runner, workflows: createWorkflowExecutor({ runner: () => runner, cloud: () => base.cloud, journalFile: scratch("runs.json"), pollMs: 1, now: () => Date.now() }) };
  }

  it("runs the product reel template step by step and files only the Output in Assets", async () => {
    const base = setup();
    const { runner, workflows } = executor(base);
    const graph = withWorkflowInputs(studioWorkflowTemplate("template:product-reel")!.graph, { a1: "asset-link" });
    const runId = await workflows.start(base.cloud, "kai", { name: "Reel", graph, agentName: "Designer" });
    await workflows.settled(runId);
    const run = base.convex.runs.get(runId)!;
    expect(run.status).toBe("done");
    expect(run.nodes.every((node) => node.status === "done")).toBe(true);
    const endpoints = base.fal.submits().map((request) => request.url.replace("https://queue.fal.run/", ""));
    expect(endpoints).toEqual(expect.arrayContaining(["fal-ai/nano-banana-pro/edit", "fal-ai/elevenlabs/music", "fal-ai/kling-video/v3/pro/image-to-video", "fal-ai/ffmpeg-api/merge-audio-video"]));
    expect(endpoints.indexOf("fal-ai/ffmpeg-api/merge-audio-video")).toBe(endpoints.length - 1);
    const merge = base.fal.submits().find((request) => request.url.endsWith("merge-audio-video"))!;
    expect(merge.body).toEqual({ video_url: "https://v3.fal.media/files/image-to-video.mp4", audio_url: "https://v3.fal.media/files/voice.mp3" });
    const edit = base.fal.submits().find((request) => request.url.endsWith("nano-banana-pro/edit"))!;
    expect(edit.body).toMatchObject({ image_urls: ["https://images.example.com/mood.png"], aspect_ratio: "9:16" });
    expect([...base.convex.rows.values()].every((row) => row.intermediate)).toBe(true);
    expect(run.nodes.find((node) => node.nodeId === "o1")!.assetId).toMatch(/^asset-gen\d+-0$/);
    expect(base.convex.calls.find((call) => call.name === "studio:saveAsset")!.args).toMatchObject({ name: "Product reel.mp4" });
    runner.stop();
  });

  it("refuses a workflow with an unconnected input before recording a run", async () => {
    const base = setup();
    const { workflows } = executor(base);
    await expect(workflows.start(base.cloud, "kai", { name: "Reel", graph: studioWorkflowTemplate("template:product-reel")!.graph })).rejects.toThrow(/Choose a file from Assets/);
    expect(base.convex.runs.size).toBe(0);
  });

  it("stops at a failed step and skips what depends on it", async () => {
    const base = setup({ fal: fakeFal({ failWith: "NSFW content detected" }) });
    const { runner, workflows } = executor(base);
    const runId = await workflows.start(base.cloud, "kai", { name: "Avatar", graph: studioWorkflowTemplate("template:talking-avatar")!.graph });
    await workflows.settled(runId);
    const run = base.convex.runs.get(runId)!;
    expect(run.status).toBe("failed");
    expect(run.nodes.find((node) => node.nodeId === "m1")).toMatchObject({ status: "failed", error: "NSFW content detected" });
    expect(run.nodes.find((node) => node.nodeId === "o1")!.status).toBe("skipped");
    runner.stop();
  });
});

describe("Studio agent tools", () => {
  const BOTS = [
    { id: "kai-chief", name: "Kai", section: "Kai", chiefOfStaff: true },
    { id: "kai-dev", name: "Designer", section: "Kai" },
  ] as unknown as BotRecord[];

  it("generate, list and save through the Origin tools as the calling agent", async () => {
    const base = setup();
    const studio = createStudioRunner({ ...base.deps, pollMs: 1 });
    const toolDeps = { bots: BOTS, state: { url: DEPLOYMENT, sessionToken: "session", projects: { "kai-chief": "kai" } }, connect: () => base.convex.client, studio };
    const made = await runOriginTool("origin_studio_generate", { prompt: "launch image", count: 3 }, "kai-dev", toolDeps);
    expect(made.isError).toBeUndefined();
    expect(made.text).toContain("gen1 [done] Nano Banana Pro image");
    expect(made.text).toContain("https://v3.fal.media/files/out.png · asset asset-gen1-0");
    expect(base.convex.calls.filter((call) => call.name === "studio:create").map((call) => call.args.agentName)).toEqual(["Designer", "Designer", "Designer"]);
    const listed = await runOriginTool("origin_studio_list", { status: "done" }, "kai-dev", toolDeps);
    expect(listed.text).toContain("3 of 3");
    const saved = await runOriginTool("origin_studio_save_asset", { generation_id: "gen2", broadcast: true }, "kai-dev", toolDeps);
    expect(saved.text).toContain("output 0 → asset asset-gen2-0 (picked for Broadcast)");
    const animated = await runOriginTool("origin_studio_generate", { mode: "video", prompt: "make it move", sources: ["gen1"], wait: false }, "kai-dev", toolDeps);
    expect(animated.text).toContain("Started 1 generation(s)");
    expect(base.convex.rows.get("gen4")).toMatchObject({ model: "fal-ai/veo3.1/image-to-video", parentId: "gen1", action: "remix" });
    const refused = await runOriginTool("origin_studio_generate", { mode: "video", model: "fal-ai/kling-video/v3/pro/image-to-video", prompt: "x" }, "kai-dev", toolDeps);
    expect(refused).toMatchObject({ isError: true, text: expect.stringContaining("starts from image") });
    studio.stop();
  });

  it("lists templates and runs one with inputs", async () => {
    const base = setup();
    const studio = createStudioRunner({ ...base.deps, pollMs: 1 });
    const studioWorkflows = createWorkflowExecutor({ runner: () => studio, cloud: () => base.cloud, journalFile: scratch("runs.json"), pollMs: 1, now: () => Date.now() });
    const toolDeps = { bots: BOTS, state: { url: DEPLOYMENT, sessionToken: "session", projects: { "kai-chief": "kai" } }, connect: () => base.convex.client, studio, studioWorkflows };
    const listed = await runOriginTool("origin_studio_workflow_list", {}, "kai-dev", toolDeps);
    expect(listed.text).toContain("template:podcast-kit \"Podcast cover and voice intro\"");
    expect(listed.text).toContain("a1 image \"Product photo\" (empty)");
    const missing = await runOriginTool("origin_studio_workflow_run", { workflow_id: "template:product-reel" }, "kai-dev", toolDeps);
    expect(missing).toMatchObject({ isError: true, text: expect.stringContaining("a1: Choose a file from Assets") });
    const ran = await runOriginTool("origin_studio_workflow_run", { workflow_id: "template:podcast-kit", inputs: { p2: "Welcome to Kai weekly" }, wait: true }, "kai-dev", toolDeps);
    expect(ran.text).toContain("[done] by Designer");
    expect(ran.text).toContain("o2 output: done");
    expect(base.fal.submits().find((request) => request.url.endsWith("tts/eleven-v3"))!.body).toMatchObject({ text: "Welcome to Kai weekly", voice: "George" });
    studio.stop();
  });
});
