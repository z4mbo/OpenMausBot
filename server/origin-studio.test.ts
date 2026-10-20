import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runOriginTool, type OriginCloudClient } from "./origin-cloud.ts";
import { assertStudioDailyBudget, createStudioRoutes, createStudioRunner, isDeploymentStorageUrl, isFalMediaUrl, studioRunner, type StudioCloud, type StudioDeps } from "./origin-studio.ts";
import type { RouteContext } from "./routes/table.ts";
import type { BotRecord } from "./store.ts";
import type { StudioGeneration } from "../shared/studio.ts";

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function journal() {
  const folder = mkdtempSync(join(tmpdir(), "omb-studio-"));
  folders.push(folder);
  return join(folder, "studio-jobs.json");
}

const DEPLOYMENT = "http://127.0.0.1:3210";

function fakeConvex() {
  const rows = new Map<string, StudioGeneration>();
  const assets: Record<string, unknown>[] = [
    { _id: "asset-logo", name: "Logo", type: "image", contentType: "image/png", fileUrl: "http://127.0.0.1:3211/api/storage/logo" },
    { _id: "asset-link", name: "Moodboard", type: "image", url: "https://images.example.com/mood.png", fileUrl: "https://images.example.com/mood.png" },
    { _id: "asset-doc", name: "Brief", type: "document", contentType: "application/pdf", fileUrl: "http://127.0.0.1:3211/api/storage/brief" },
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
          ...(args.agentName ? { agentName: args.agentName } : {}), createdAt: next, updatedAt: next,
        } as StudioGeneration);
        return generationId;
      }
      case "studio:update": {
        const row = rows.get(id)!;
        rows.set(id, { ...row, status: args.status as StudioGeneration["status"], ...(args.error ? { error: String(args.error) } : {}), ...(args.outputs ? { outputs: args.outputs as StudioGeneration["outputs"] } : {}) });
        return null;
      }
      case "studio:get": return rows.get(id);
      case "studio:list": return [...rows.values()].reverse();
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
  return { client, rows, calls, uploads };
}

function fakeFal(options: { submitStatus?: number; submitBody?: unknown; result?: unknown; failWith?: string } = {}) {
  const requests: Array<{ url: string; method: string; auth: string | null; body?: unknown }> = [];
  const polls = new Map<string, number>();
  let submitted = 0;
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : undefined;
    requests.push({ url, method: init?.method ?? "GET", auth: headers.get("authorization"), ...(body ? { body } : {}) });
    if (url.startsWith("https://queue.fal.run/") && init?.method === "POST") {
      if (options.submitStatus) return Response.json(options.submitBody ?? {}, { status: options.submitStatus });
      submitted += 1;
      const base = `https://queue.fal.run/fal-ai/nano-banana-pro/requests/req${submitted}`;
      return Response.json({ request_id: `req${submitted}`, status_url: `${base}/status`, response_url: base, cancel_url: `${base}/cancel` });
    }
    if (url.endsWith("/status")) {
      const count = (polls.get(url) ?? 0) + 1;
      polls.set(url, count);
      if (count === 1) return Response.json({ status: "IN_PROGRESS" });
      return Response.json(options.failWith ? { status: "COMPLETED", error: options.failWith } : { status: "COMPLETED" });
    }
    if (url.startsWith("https://queue.fal.run/")) {
      return Response.json(options.result ?? { images: [{ url: "https://v3.fal.media/files/out.png", content_type: "image/png" }], description: "" });
    }
    if (url === "https://v3.fal.media/files/out.png") return new Response(new Uint8Array([1, 2, 3, 4]), { headers: { "content-type": "image/png" } });
    if (url === "http://127.0.0.1:3211/api/storage/logo") return new Response(new Uint8Array([9, 9]), { headers: { "content-type": "image/png" } });
    return new Response("unexpected", { status: 500 });
  }) as typeof fetch;
  return { fetch: fetchFn, requests };
}

function setup(options: { key?: string | null; fal?: ReturnType<typeof fakeFal>; file?: string; checkBudget?: (input: { projectId: string; botId?: string }) => void } = {}) {
  const convex = fakeConvex();
  const fal = options.fal ?? fakeFal();
  const cloud: StudioCloud = { client: convex.client, sessionToken: "session", url: DEPLOYMENT };
  const deps: StudioDeps = {
    fetch: fal.fetch, falKey: () => (options.key === undefined ? "fal-test-key" : options.key), cloud: () => cloud,
    journalFile: options.file ?? journal(), now: () => 1_000, pollMs: 60_000,
    checkBudget: options.checkBudget ?? (() => undefined),
  };
  return { convex, fal, cloud, deps, runner: createStudioRunner(deps) };
}

describe("Studio runner", () => {
  it.each(["http://127.0.0.1:8799/api/config", "http://127.0.0.1:3210/api/config"])("never inlines a teammate's non-storage local asset URL %s", async sourceUrl => {
    const fal = fakeFal();
    const privateReads: string[] = [];
    const privateText = "OWNER_PRIVATE_CONFIG_CANARY";
    const safeFetch = fal.fetch;
    fal.fetch = (async (url, init) => {
      if (String(url) === sourceUrl) { privateReads.push(sourceUrl); return new Response(privateText, { headers: { "content-type": "image/png" } }); }
      return safeFetch(url, init);
    }) as typeof fetch;
    const { runner, cloud } = setup({ fal });
    cloud.client.query = async name => name === "design:list" ? { assets: [{ _id: "untrusted-image", name: "Image", type: "image", contentType: "image/png", fileUrl: sourceUrl }] } : null;
    await runner.generate(cloud, { projectId: "kai", mode: "edit", model: "fal-ai/seedvr/upscale/image", prompt: "", sourceAssetId: "untrusted-image" });
    expect(privateReads).toEqual([]);
    expect(JSON.stringify(fal.requests)).not.toContain(Buffer.from(privateText).toString("base64"));
    runner.stop();
  });

  it("refuses shared generations until the server installs its budget guard", async () => {
    const convex = fakeConvex();
    const shared = studioRunner();
    await expect(shared.generate({ client: convex.client, sessionToken: "synthetic-session", url: DEPLOYMENT }, { projectId: "kai", mode: "image", model: "fal-ai/flux/schnell", prompt: "x" })).rejects.toThrow(/not ready to check your API budget/);
    expect(convex.calls).toHaveLength(0);
    shared.stop();
  });

  it("returns a budget refusal for the UI without trusting its forged botId", async () => {
    const seen: (string | undefined)[] = [];
    const { runner, cloud, convex, fal } = setup({ checkBudget: input => { seen.push(input.botId); assertStudioDailyBudget({ limitUsd: 0 }); } });
    const route = createStudioRoutes({ runner: () => runner, cloud: () => cloud });
    let reply: { status: number; body: unknown } | undefined;
    await route({ req: { headers: {} }, res: {}, path: "/api/studio/generate", method: "POST", auth: { kind: "loopback", scopes: ["admin"] },
      readBody: async () => ({ projectId: "kai", mode: "image", model: "fal-ai/flux/schnell", prompt: "x", botId: "uncapped-agent" }),
      json: (_res: unknown, status: number, body: unknown) => { reply = { status, body }; },
    } as unknown as RouteContext);
    expect(reply).toMatchObject({ status: 409, body: { code: "daily_api_budget", error: expect.stringContaining("daily API budget") } });
    expect(seen).toEqual([undefined]);
    expect(convex.calls).toHaveLength(0);
    expect(fal.requests).toHaveLength(0);
    runner.stop();
  });

  it("scrubs a long rejected key before truncating the provider's reason", async () => {
    const key = "q".repeat(512);
    const { runner, cloud, convex } = setup({ key, fal: fakeFal({ submitStatus: 401, submitBody: { message: `Rejected ${key}` } }) });
    await runner.generate(cloud, { projectId: "kai", mode: "image", model: "fal-ai/flux/schnell", prompt: "x" });
    expect(convex.rows.get("gen1")).toMatchObject({ status: "failed", error: expect.stringContaining("fal.ai refused the key") });
    expect(JSON.stringify(convex.calls)).not.toContain("q".repeat(32));
  });

  it.each([0, 2])("refuses an unpriced generation under an active $%s budget before any cloud or provider call", async limit => {
    const { runner, cloud, convex, fal } = setup({ checkBudget: () => assertStudioDailyBudget({ limitUsd: limit }) });
    await expect(runner.generate(cloud, { projectId: "kai", mode: "image", model: "fal-ai/flux/schnell", prompt: "x" })).rejects.toThrow(/daily API budget/);
    expect(convex.calls).toHaveLength(0);
    expect(fal.requests).toHaveLength(0);
  });

  it("checks the calling agent's own zero limit and rechecks before a delayed submission", async () => {
    const seen: (string | undefined)[] = [];
    let limit: number | undefined;
    const { runner, cloud, convex, fal } = setup({ checkBudget: input => { seen.push(input.botId); assertStudioDailyBudget({ agentLimitUsd: limit }); } });
    const mutation = cloud.client.mutation;
    cloud.client.mutation = async (name, args) => { const result = await mutation(name, args); if (name === "studio:create") limit = 0; return result; };
    expect(await runner.generate(cloud, { projectId: "kai", mode: "image", model: "fal-ai/flux/schnell", prompt: "x" }, "Researcher", "researcher")).toEqual(["gen1"]);
    expect(seen).toEqual(["researcher", "researcher"]);
    expect(convex.rows.get("gen1")).toMatchObject({ status: "failed", error: expect.stringContaining("daily API budget") });
    expect(fal.requests).toHaveLength(0);
  });

  it.each([0, 3])("refuses an active per-agent $%s limit before a generation is created", async limit => {
    const { runner, cloud, convex, fal } = setup({ checkBudget: input => { expect(input.botId).toBe("researcher"); assertStudioDailyBudget({ agentLimitUsd: limit }); } });
    await expect(runner.generate(cloud, { projectId: "kai", mode: "image", model: "fal-ai/flux/schnell", prompt: "x" }, "Researcher", "researcher")).rejects.toThrow(/daily API budget/);
    expect(convex.calls).toHaveLength(0);
    expect(fal.requests).toHaveLength(0);
  });

  it("keeps rejected and completion-echoed fal credentials out of shared generations", async () => {
    for (const fal of [fakeFal({ submitStatus: 401, submitBody: { message: "Rejected fal-test-key" } }), fakeFal({ failWith: "Generation refused fal-test-key" })]) {
      const { runner, cloud, convex } = setup({ fal });
      await runner.generate(cloud, { projectId: "kai", mode: "image", model: "fal-ai/flux/schnell", prompt: "x" });
      await runner.tick();
      await runner.tick();
      expect(convex.rows.get("gen1")?.status).toBe("failed");
      expect(JSON.stringify([...convex.rows.values()])).not.toContain("fal-test-key");
      expect(JSON.stringify(convex.calls)).not.toContain("fal-test-key");
      runner.stop();
    }
  });

  it("queues one fal request per variation and records progress until done", async () => {
    const { runner, cloud, convex, fal } = setup();
    const ids = await runner.generate(cloud, { projectId: "kai", mode: "image", model: "fal-ai/nano-banana-pro", prompt: "  launch poster ", aspectRatio: "16:9", count: 2 });
    expect(ids).toEqual(["gen1", "gen2"]);
    const submits = fal.requests.filter((request) => request.method === "POST");
    expect(submits).toHaveLength(2);
    expect(submits[0]).toMatchObject({ url: "https://queue.fal.run/fal-ai/nano-banana-pro", auth: "Key fal-test-key", body: { prompt: "launch poster", aspect_ratio: "16:9", num_images: 1 } });
    expect(runner.pending()).toBe(2);
    await runner.tick();
    expect(convex.rows.get("gen1")!.status).toBe("running");
    await runner.tick();
    expect(convex.rows.get("gen1")).toMatchObject({ status: "done", outputs: [{ url: "https://v3.fal.media/files/out.png", kind: "image", contentType: "image/png" }] });
    expect(runner.pending()).toBe(0);
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
    expect(convex.rows.get("gen1")).toMatchObject({ status: "failed", error: "NSFW content detected" });
  });

  it("starts image-to-video from a project image, inlined from the deployment's storage", async () => {
    const { runner, cloud, fal } = setup();
    await expect(runner.generate(cloud, { projectId: "kai", mode: "video", model: "fal-ai/veo3.1/image-to-video", prompt: "fly" })).rejects.toThrow(/starts from an image/);
    await runner.generate(cloud, { projectId: "kai", mode: "video", model: "fal-ai/veo3.1/image-to-video", prompt: "fly", sourceAssetId: "asset-logo", duration: "6s" });
    const submit = fal.requests.find((request) => request.method === "POST")!;
    expect(submit.body).toEqual({ prompt: "fly", aspect_ratio: "auto", duration: "6s", image_url: "data:image/png;base64,CQk=" });
    await runner.generate(cloud, { projectId: "kai", mode: "edit", model: "fal-ai/seedvr/upscale/image", prompt: "", sourceAssetId: "asset-link" });
    expect(fal.requests.some((request) => request.url === "https://images.example.com/mood.png")).toBe(false);
    expect(fal.requests.filter((request) => request.method === "POST")[1]!.body).toMatchObject({ image_url: "https://images.example.com/mood.png", upscale_factor: 2 });
    await expect(runner.generate(cloud, { projectId: "kai", mode: "edit", model: "fal-ai/seedvr/upscale/image", prompt: "", sourceAssetId: "asset-doc" })).rejects.toThrow(/not an image/);
  });

  it("refuses a model of another mode and a malformed custom endpoint", async () => {
    const { runner, cloud } = setup();
    await expect(runner.generate(cloud, { projectId: "kai", mode: "audio", model: "fal-ai/flux/schnell", prompt: "x" })).rejects.toThrow(/not audio/);
    await expect(runner.generate(cloud, { projectId: "kai", mode: "image", model: "custom", endpoint: "../../etc", prompt: "x" })).rejects.toThrow(/endpoint/);
  });

  it("runs a custom endpoint with its own input", async () => {
    const { runner, cloud, fal } = setup();
    await runner.generate(cloud, { projectId: "kai", mode: "image", model: "custom", endpoint: "comfy/ana/poster-flow", prompt: "", input: { steps: 20, prompt: "neon" } });
    expect(fal.requests.find((request) => request.method === "POST")).toMatchObject({ url: "https://queue.fal.run/comfy/ana/poster-flow", body: { steps: 20, prompt: "neon" } });
  });

  it("copies a fal output into Assets, and saves any other link without fetching it", async () => {
    const { runner, cloud, convex, fal } = setup();
    await runner.generate(cloud, { projectId: "kai", mode: "image", model: "fal-ai/nano-banana-pro", prompt: "poster" });
    await runner.tick();
    await runner.tick();
    expect(await runner.saveAsset(cloud, "kai", "gen1", 0)).toEqual({ assetId: "asset-gen1-0", copied: true });
    expect(convex.uploads).toEqual([{ url: `${DEPLOYMENT}/upload?token=1`, bytes: 4, contentType: "image/png" }]);
    expect(convex.calls.find((call) => call.name === "studio:saveAsset")!.args).toMatchObject({ storageId: "storage1", name: "poster.png", size: 4 });
    const row = convex.rows.get("gen1")!;
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

  it("trusts only fal's media hosts for downloads", () => {
    expect(isFalMediaUrl("https://v3.fal.media/files/a.png")).toBe(true);
    expect(isFalMediaUrl("https://fal.media.evil.com/a.png")).toBe(false);
    expect(isFalMediaUrl("http://v3.fal.media/a.png")).toBe(false);
    expect(isFalMediaUrl("https://127.0.0.1/a.png")).toBe(false);
  });

  it("matches complete deployment storage origins and paths while keeping signed queries", () => {
    const remote = "https://sample.convex.cloud";
    for (const url of [`${remote}/api/storage/file?token=signed`, "https://sample.convex.site/api/storage/file"]) expect(isDeploymentStorageUrl(url, remote), url).toBe(true);
    for (const url of ["http://127.0.0.1:3210/api/storage/file", "http://127.0.0.1:3211/api/storage/file?token=signed"]) expect(isDeploymentStorageUrl(url, DEPLOYMENT), url).toBe(true);
    for (const url of ["http://127.0.0.1:8799/api/storage/file", "https://127.0.0.1:3210/api/storage/file", "http://127.0.0.1:3210/api/config", "http://user:secret@127.0.0.1:3210/api/storage/file", "http://127.0.0.1:3210/api/storage/file#fragment", "file:///api/storage/file", "http://127.0.0.1:3210/api/storage/"]) expect(isDeploymentStorageUrl(url, DEPLOYMENT), url).toBe(false);
  });
});

describe("Studio agent tools", () => {
  const BOTS = [
    { id: "kai-chief", name: "Kai", section: "Kai", chiefOfStaff: true },
    { id: "kai-dev", name: "Designer", section: "Kai" },
  ] as unknown as BotRecord[];

  it("applies the real calling agent's cap despite a different bot_id in tool arguments", async () => {
    const seen: (string | undefined)[] = [];
    const { convex, fal, runner: studio } = setup({ checkBudget: input => { seen.push(input.botId); assertStudioDailyBudget({ agentLimitUsd: input.botId === "kai-dev" ? 0 : undefined }); } });
    const result = await runOriginTool("origin_studio_generate", { prompt: "poster", bot_id: "uncapped-agent", wait: false }, "kai-dev", {
      bots: BOTS, state: { url: DEPLOYMENT, sessionToken: "session", projects: { "kai-chief": "kai" } }, connect: () => convex.client, studio,
    });
    expect(result).toMatchObject({ isError: true, text: expect.stringContaining("daily API budget") });
    expect(seen).toEqual(["kai-dev"]);
    expect(convex.calls.some(call => call.name === "studio:create")).toBe(false);
    expect(fal.requests).toHaveLength(0);
  });

  it("generate, list and save through the Origin tools as the calling agent", async () => {
    const { convex, deps } = setup();
    const studio = createStudioRunner({ ...deps, pollMs: 1 });
    const toolDeps = { bots: BOTS, state: { url: DEPLOYMENT, sessionToken: "session", projects: { "kai-chief": "kai" } }, connect: () => convex.client, studio };
    const made = await runOriginTool("origin_studio_generate", { prompt: "launch image", count: 3 }, "kai-dev", toolDeps);
    expect(made.isError).toBeUndefined();
    expect(made.text).toContain("gen1 [done] Nano Banana Pro image");
    expect(made.text).toContain("https://v3.fal.media/files/out.png");
    expect(convex.calls.filter((call) => call.name === "studio:create").map((call) => call.args.agentName)).toEqual(["Designer", "Designer", "Designer"]);
    const listed = await runOriginTool("origin_studio_list", { status: "done" }, "kai-dev", toolDeps);
    expect(listed.text).toContain("3 of 3");
    const saved = await runOriginTool("origin_studio_save_asset", { generation_id: "gen2", broadcast: true }, "kai-dev", toolDeps);
    expect(saved.text).toContain("output 0 → asset asset-gen2-0 (picked for Broadcast)");
    const video = await runOriginTool("origin_studio_generate", { mode: "video", prompt: "trailer" }, "kai-dev", toolDeps);
    expect(video.text).toContain("Started 1 generation(s)");
    const refused = await runOriginTool("origin_studio_generate", { mode: "video", model: "fal-ai/kling-video/v3/pro/image-to-video", prompt: "x" }, "kai-dev", toolDeps);
    expect(refused).toMatchObject({ isError: true, text: expect.stringContaining("starts from an image") });
    studio.stop();
  });
});
