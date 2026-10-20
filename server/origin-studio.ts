import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "./atomic.ts";
import { DATA_DIR } from "./config.ts";
import { projectIntegrationKey } from "./integration-keys.ts";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { convexOriginClient, defaultOriginCloudFile, readOriginCloud, type OriginCloudClient } from "./origin-cloud.ts";
import {
  STUDIO_CHUNK_BYTES, STUDIO_CUSTOM_MODEL, STUDIO_ENHANCER, STUDIO_STORED_MAX, STUDIO_VOICES, studioAssetName, studioCharacterPrompt, studioEndpoint, studioInput, studioModel,
  studioOutputs, validStudioEndpoint,
  type StudioCharacter, type StudioGenerateRequest, type StudioGeneration, type StudioMediaKind, type StudioMode, type StudioModel, type StudioParams, type StudioSource,
} from "../shared/studio.ts";
import { brandedPrompt, type StoredBrandKit } from "../shared/brand-kit.ts";
import { studioPreset } from "../shared/studio-presets.ts";

/** The signed-in Origin account this app's server acts as. */
export interface StudioCloud {
  /** `action` runs a Convex action; without one the runner opens its own client on `url`. */
  client: OriginCloudClient & { action?(name: string, args: Record<string, unknown>): Promise<unknown> };
  sessionToken: string;
  /** The Convex deployment address; its own storage links are the only ones fetched here. */
  url: string;
}

export interface StudioDeps {
  fetch: typeof fetch;
  /** The fal.ai key for one project's work, or for work outside any project. */
  falKey(projectId?: string): string | null;
  cloud(): StudioCloud | null;
  journalFile: string;
  now(): number;
  pollMs: number;
  /** Where generations are queued; https://queue.fal.run unless a loopback fake stands in. */
  queueOrigin?: string;
  /** Voice samples already made, so each costs one fal call per app. */
  voiceCacheFile?: string;
}

interface Job {
  generationId: string;
  projectId: string;
  kind: StudioMediaKind;
  statusUrl: string;
  responseUrl: string;
  cancelUrl?: string;
  submittedAt: number;
  running?: boolean;
  queuePosition?: number;
  intermediate?: boolean;
  failures?: number;
}

/** A refusal whose message is already the sentence the person or agent should read. */
export class StudioRefusal extends Error {}

export const refuse = (message: string): never => { throw new StudioRefusal(message); };

export const STUDIO_FAL_MISSING = "Add your fal.ai key in Settings > Integrations to generate in Studio.";
const QUEUE_ORIGIN = "https://queue.fal.run";
const JOB_TIMEOUT_MS = 45 * 60_000;
const STATUS_FAILURES_MAX = 10;
const SOURCE_INLINE_MAX = 8 * 1024 * 1024;
const PROMPT_MAX = 8_000;
const QUICK_TIMEOUT_MS = 60_000;
export const STUDIO_TERMINAL: ReadonlySet<string> = new Set(["done", "failed", "cancelled"]);

/** fal's queue, or a loopback fake (OMB_FAL_QUEUE_URL, http://127.0.0.1:PORT) so a fixture's key never reaches fal.ai. */
export function falQueueOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.OMB_FAL_QUEUE_URL?.trim() ?? "";
  return /^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(override) ? override : QUEUE_ORIGIN;
}

export function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** fal reports errors as `detail` (a string or a list of `{ msg }`), `error` or `message`. */
function falError(body: unknown, status: number): string {
  const data = record(body);
  const detail = data.detail;
  const message = typeof detail === "string" ? detail
    : Array.isArray(detail) ? detail.map((item) => text(record(item).msg)).filter(Boolean).join("; ")
      : text(data.error) || text(data.message);
  if (status === 401 || status === 403) return message ? `fal.ai refused the key: ${clip(message, 300)}` : "fal.ai refused the key. Check it in Settings > Integrations.";
  return clip(message || `fal.ai answered HTTP ${status}`, 500);
}

/** Security: the server downloads generated media only from fal's own hosts, never a link a teammate wrote into a record. */
export function isFalMediaUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && !url.username && !url.password
      && ["fal.media", "fal.run", "fal.ai"].some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

/** Security: a project asset is read only from the signed-in deployment's own storage. */
function isDeploymentStorageUrl(raw: string, deployment: string): boolean {
  try {
    const url = new URL(raw);
    const base = new URL(deployment);
    const site = new URL(base.origin);
    if (site.hostname.endsWith(".convex.cloud")) site.hostname = site.hostname.replace(/\.convex\.cloud$/, ".convex.site");
    else if (site.port) site.port = String(Number(site.port) + 1);
    return url.origin === base.origin || url.origin === site.origin;
  } catch {
    return false;
  }
}

function runAction(cloud: StudioCloud, name: string, args: Record<string, unknown>): Promise<unknown> {
  return cloud.client.action ? cloud.client.action(name, args) : new ConvexHttpClient(cloud.url, { logger: false }).action(makeFunctionReference<"action">(name), args);
}

/** A response body in pieces of exactly `size` bytes, the last one shorter. */
export async function* pieces(body: ReadableStream<Uint8Array>, size: number): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  let piece = new Uint8Array(size);
  let filled = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      let offset = 0;
      while (offset < value.byteLength) {
        const take = Math.min(size - filled, value.byteLength - offset);
        piece.set(value.subarray(offset, offset + take), filled);
        filled += take;
        offset += take;
        if (filled === size) {
          yield piece;
          piece = new Uint8Array(size);
          filled = 0;
        }
      }
    }
    if (filled) yield piece.slice(0, filled);
  } finally {
    reader.releaseLock();
  }
}

async function readLimited(response: Response, max: number): Promise<Uint8Array | null> {
  if (Number(response.headers.get("content-length") ?? 0) > max) return null;
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return data;
}

const CUSTOM_KINDS: Record<StudioMode, StudioMediaKind> = { image: "image", edit: "image", video: "video", audio: "audio" };

function resolveModel(request: StudioGenerateRequest): { model: StudioModel; endpoint: string; label: string } {
  if (request.model === STUDIO_CUSTOM_MODEL) {
    const endpoint = text(request.endpoint).trim();
    if (!validStudioEndpoint(endpoint)) refuse("A custom generation needs endpoint: a fal.ai endpoint id such as owner/app/path.");
    const model: StudioModel = { id: endpoint, label: endpoint, description: "", mode: request.mode, kind: CUSTOM_KINDS[request.mode], family: "custom", needs: [], prompt: "optional", eta: 60, maxCount: 4 };
    return { model, endpoint, label: clip(endpoint, 120) };
  }
  const model = studioModel(request.model) ?? refuse(`Studio has no model ${clip(text(request.model), 80)}.`);
  return { model, endpoint: model.id, label: model.label };
}

const BRANDED_MODES: ReadonlySet<StudioMode> = new Set(["image", "video"]);

/** The prompt fal receives: the user's, after the project's imagery style and colours when the generation uses the brand. */
async function brandPrompt(cloud: StudioCloud, request: StudioGenerateRequest, model: StudioModel, prompt: string): Promise<string> {
  if (request.brand === false || !prompt || !BRANDED_MODES.has(request.mode) || model.needs.includes("video")) return prompt;
  const kit = await cloud.client.query("brand:get", { projectId: request.projectId, sessionToken: cloud.sessionToken }).catch(() => null);
  return kit && typeof kit === "object" ? brandedPrompt(kit as StoredBrandKit, prompt) : prompt;
}

/** The controls a generation ran with, kept so Remix can run it again. */
function paramsOf(request: StudioGenerateRequest, references: number, character?: StudioCharacter): StudioParams | undefined {
  const params: StudioParams = {};
  if (request.voice) params.voice = request.voice;
  if (request.resolution) params.resolution = request.resolution;
  if (Number.isInteger(request.seed)) params.seed = request.seed!;
  if (request.negativePrompt?.trim()) params.negativePrompt = request.negativePrompt.trim();
  if (request.sound === false) params.sound = false;
  if (request.motion) params.motion = request.motion;
  if (request.angle) params.angle = request.angle;
  if (request.preset && studioPreset(request.preset)) params.preset = request.preset;
  if (references) params.references = references;
  if (character) params.character = character.name;
  return Object.keys(params).length ? params : undefined;
}

/** Media a workflow already holds as links, so the runner need not look them up. */
export interface StudioMedia {
  sources: string[];
  references?: string[];
}

export interface StudioGenerateExtra {
  media?: StudioMedia;
  workflow?: { runId: string; nodeId: string };
  intermediate?: boolean;
}

export interface StudioRunner {
  generate(cloud: StudioCloud, request: StudioGenerateRequest, agentName?: string, extra?: StudioGenerateExtra): Promise<string[]>;
  /** A project asset as a link fal can fetch, inlined when it lives in the deployment's own storage. */
  assetMedia(cloud: StudioCloud, projectId: string, assetId: string, kind: StudioMediaKind): Promise<string>;
  saveAsset(cloud: StudioCloud, projectId: string, generationId: string, index: number, name?: string): Promise<{ assetId: string; copied: boolean }>;
  /** Stops a queued or running generation; false when fal had already finished it, which then settles as done. */
  cancel(cloud: StudioCloud, projectId: string, generationId: string): Promise<{ cancelled: boolean }>;
  pickForBroadcast(cloud: StudioCloud, projectId: string, generationId: string, index: number, picked: boolean): Promise<{ assetId?: string }>;
  wait(cloud: StudioCloud, projectId: string, ids: readonly string[], timeoutMs: number): Promise<StudioGeneration[]>;
  /** Rewrites a rough idea into a full prompt with a cheap fast model. */
  enhance(prompt: string, mode: StudioMode): Promise<string>;
  /** A short sample of an ElevenLabs voice. */
  voicePreview(voice: string): Promise<string>;
  /** A spoken script and a post caption for a campaign brief, from the same cheap model. */
  campaignCopy(brief: string): Promise<{ script: string; caption: string }>;
  /** Picks up the generations this app was polling before it last stopped. */
  resume(): void;
  /** Runs one polling pass now; tests drive the runner with it. */
  tick(): Promise<void>;
  pending(): number;
  stop(): void;
}

export function createStudioRunner(deps: StudioDeps): StudioRunner {
  const queueOrigin = deps.queueOrigin ?? QUEUE_ORIGIN;
  const isQueueUrl = (value: unknown): value is string => isFalQueueUrl(value, queueOrigin);
  let jobs: Job[] = [];
  let loaded = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let ticking = false;

  const load = () => {
    if (loaded) return;
    loaded = true;
    try {
      if (!existsSync(deps.journalFile)) return;
      const raw = JSON.parse(readFileSync(deps.journalFile, "utf8")) as unknown;
      jobs = Array.isArray(raw) ? raw.filter((job): job is Job => Boolean(job) && typeof job.generationId === "string"
        && typeof job.projectId === "string" && isQueueUrl(job.statusUrl) && isQueueUrl(job.responseUrl)
        && (job.cancelUrl === undefined || isQueueUrl(job.cancelUrl))) : [];
    } catch {
      jobs = [];
    }
  };
  const persist = () => writeFileAtomic(deps.journalFile, JSON.stringify(jobs), { mode: 0o600 });
  const schedule = () => {
    if (timer || !jobs.length) return;
    timer = setTimeout(() => {
      timer = null;
      void tick().catch((error: unknown) => console.warn(`studio: polling fal.ai failed: ${error instanceof Error ? error.message : String(error)}`)).finally(schedule);
    }, deps.pollMs);
    timer.unref?.();
  };
  const falFetch = (projectId: string | undefined, url: string, init: RequestInit = {}) => {
    const key = deps.falKey(projectId) ?? refuse(STUDIO_FAL_MISSING);
    return deps.fetch(url, { ...init, headers: { ...init.headers, Authorization: `Key ${key}`, "Content-Type": "application/json" } });
  };
  const update = (cloud: StudioCloud, job: Pick<Job, "projectId" | "generationId">, patch: Record<string, unknown>) =>
    cloud.client.mutation("studio:update", { projectId: job.projectId, sessionToken: cloud.sessionToken, generationId: job.generationId, ...patch });

  async function assetMedia(cloud: StudioCloud, projectId: string, assetId: string, kind: StudioMediaKind): Promise<string> {
    const design = record(await cloud.client.query("design:list", { projectId, sessionToken: cloud.sessionToken }));
    const assets = Array.isArray(design.assets) ? design.assets.map(record) : [];
    const asset = assets.find((candidate) => candidate._id === assetId) ?? refuse(`No asset ${clip(assetId, 64)} in this project; list them with origin_list_assets.`);
    const contentType = text(asset.contentType);
    const matches = kind === "image" ? asset.type === "image" || asset.type === "icon" || contentType.startsWith("image/") : asset.type === kind || contentType.startsWith(`${kind}/`);
    if (!matches) refuse(`${text(asset.name)} is not ${kind === "audio" ? "audio" : `a${kind === "image" ? "n" : ""} ${kind}`}.`);
    const link = text(asset.fileUrl) || text(asset.url);
    if (!/^https?:\/\//i.test(link)) refuse(`${text(asset.name)} has no file to start from.`);
    if (!isDeploymentStorageUrl(link, cloud.url)) return link;
    if (/^https:\/\//i.test(link) && kind !== "image") return link;
    const response = await deps.fetch(link);
    if (!response.ok) refuse(`Could not read ${text(asset.name)} (HTTP ${response.status}).`);
    const data = await readLimited(response, SOURCE_INLINE_MAX);
    if (!data) {
      if (/^https:\/\//i.test(link)) return link;
      return refuse(`${text(asset.name)} is over 8 MB; use a smaller file.`);
    }
    const type = response.headers.get("content-type")?.split(";")[0] || contentType || `${kind}/${kind === "image" ? "png" : kind === "video" ? "mp4" : "mpeg"}`;
    return `data:${type};base64,${Buffer.from(data).toString("base64")}`;
  }

  async function sourceMedia(cloud: StudioCloud, projectId: string, source: StudioSource, kind: StudioMediaKind): Promise<string> {
    if ("assetId" in source) return assetMedia(cloud, projectId, source.assetId, kind);
    const row = await cloud.client.query("studio:get", { projectId, sessionToken: cloud.sessionToken, generationId: source.generationId }).catch(() => null) as StudioGeneration | null;
    if (!row) refuse(`No generation ${clip(source.generationId, 64)} in this project.`);
    const output = row!.outputs[source.index ?? 0] ?? refuse(`Generation ${source.generationId} has no output ${source.index ?? 0} yet.`);
    if (output.kind !== kind) refuse(`That output is ${output.kind === "audio" ? "audio" : `a${output.kind === "image" ? "n" : ""} ${output.kind}`}, not ${kind}.`);
    return output.url;
  }

  /** Queues one generation on fal; a refusal is recorded on the generation itself, and false stops a batch. */
  async function submit(cloud: StudioCloud, projectId: string, generationId: string, endpoint: string, kind: StudioMediaKind, input: Record<string, unknown>, intermediate: boolean): Promise<boolean> {
    try {
      const response = await falFetch(projectId, `${queueOrigin}/${endpoint}`, { method: "POST", body: JSON.stringify(input) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new StudioRefusal(falError(body, response.status));
      const data = record(body);
      const statusUrl = text(data.status_url);
      const responseUrl = text(data.response_url);
      const cancelUrl = text(data.cancel_url);
      if (!isQueueUrl(statusUrl) || !isQueueUrl(responseUrl)) throw new StudioRefusal("fal.ai did not queue the request");
      await update(cloud, { projectId, generationId }, { status: "queued", falRequestId: text(data.request_id) });
      jobs.push({ generationId, projectId, kind, statusUrl, responseUrl, ...(isQueueUrl(cancelUrl) ? { cancelUrl } : {}), submittedAt: deps.now(), ...(intermediate ? { intermediate } : {}) });
      persist();
      schedule();
      return true;
    } catch (error) {
      const message = error instanceof StudioRefusal ? error.message : `Could not reach fal.ai: ${error instanceof Error ? error.message : String(error)}`;
      await update(cloud, { projectId, generationId }, { status: "failed", error: message });
      return false;
    }
  }

  /**
   * Copies a fal file into project storage, streaming it through in pieces the upload route accepts and joining
   * them in the deployment when there is more than one. Null when it is not fal's, too large, or not copyable here.
   */
  async function storeOutput(cloud: StudioCloud, projectId: string, url: string, fallbackType?: string): Promise<{ storageId: string; contentType: string; size: number } | null> {
    const upload = cloud.client.upload?.bind(cloud.client);
    if (!isFalMediaUrl(url) || !upload) return null;
    const response = await deps.fetch(url);
    if (!response.ok || !response.body) return null;
    if (Number(response.headers.get("content-length") ?? 0) > STUDIO_STORED_MAX) {
      await response.body.cancel();
      return null;
    }
    const contentType = response.headers.get("content-type")?.split(";")[0] || fallbackType || "application/octet-stream";
    const chunks: string[] = [];
    let size = 0;
    for await (const piece of pieces(response.body, STUDIO_CHUNK_BYTES)) {
      size += piece.byteLength;
      if (size > STUDIO_STORED_MAX) return null;
      const uploadUrl = text(await cloud.client.mutation("design:generateUploadUrl", { projectId, sessionToken: cloud.sessionToken }));
      chunks.push(await upload(uploadUrl, piece, contentType));
    }
    if (!chunks.length) return null;
    const storageId = chunks.length === 1 ? chunks[0]! : text(await runAction(cloud, "studioUpload:assemble", { projectId, sessionToken: cloud.sessionToken, chunks, contentType }));
    return { storageId, contentType, size };
  }

  /** Copies a finished output into project storage, so its Assets file outlives fal's link. */
  async function copyIntoAssets(cloud: StudioCloud, projectId: string, generationId: string, index: number, url: string): Promise<void> {
    const stored = await storeOutput(cloud, projectId, url);
    if (stored) await cloud.client.mutation("studio:storeFile", { projectId, sessionToken: cloud.sessionToken, generationId, index, ...stored });
  }

  async function characterOf(cloud: StudioCloud, projectId: string, characterId: string): Promise<{ character: StudioCharacter; references: string[] }> {
    const character = await cloud.client.query("studioLibrary:get", { projectId, sessionToken: cloud.sessionToken, characterId }).catch(() => null) as StudioCharacter | null;
    if (!character) return refuse(`No library entry ${clip(characterId, 64)} in this project; list them with origin_studio_library.`);
    const references: string[] = [];
    for (const assetId of character.referenceAssetIds) references.push(await assetMedia(cloud, projectId, assetId, "image"));
    return { character, references };
  }

  async function finish(cloud: StudioCloud, job: Job): Promise<void> {
    const response = await falFetch(job.projectId, job.responseUrl);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      await update(cloud, job, { status: "failed", error: falError(body, response.status) });
      return;
    }
    const outputs = studioOutputs(body, job.kind);
    await update(cloud, job, outputs.length ? { status: "done", outputs } : { status: "failed", error: "fal.ai finished without any media" });
    if (job.intermediate) return;
    for (const [index, output] of outputs.entries()) {
      await copyIntoAssets(cloud, job.projectId, job.generationId, index, output.url)
        .catch((error: unknown) => console.warn(`studio: keeping the fal link for an output: ${error instanceof Error ? error.message : String(error)}`));
    }
  }

  async function step(cloud: StudioCloud, job: Job): Promise<boolean> {
    if (deps.now() - job.submittedAt > JOB_TIMEOUT_MS) {
      await update(cloud, job, { status: "failed", error: "fal.ai did not finish within 45 minutes" });
      return true;
    }
    let status: Record<string, unknown>;
    try {
      const response = await falFetch(job.projectId, job.statusUrl);
      status = record(await response.json().catch(() => ({})));
      if (!response.ok) throw new Error(falError(status, response.status));
      job.failures = 0;
    } catch (error) {
      job.failures = (job.failures ?? 0) + 1;
      if (job.failures < STATUS_FAILURES_MAX) return false;
      await update(cloud, job, { status: "failed", error: error instanceof Error ? error.message : String(error) });
      return true;
    }
    const state = text(status.status);
    const position = typeof status.queue_position === "number" ? status.queue_position : undefined;
    if (state === "IN_QUEUE" && position !== undefined && position !== job.queuePosition && !job.running) {
      job.queuePosition = position;
      await update(cloud, job, { status: "queued", queuePosition: position });
    }
    if (state === "IN_PROGRESS" && !job.running) {
      job.running = true;
      await update(cloud, job, { status: "running" });
    }
    if (state !== "COMPLETED") return false;
    if (status.error) {
      await update(cloud, job, { status: "failed", error: clip(text(status.error) || "The generation failed", 500) });
      return true;
    }
    await finish(cloud, job);
    return true;
  }

  async function tick(): Promise<void> {
    load();
    if (ticking || !jobs.length) return;
    const cloud = deps.cloud();
    const keyed = jobs.filter((job) => deps.falKey(job.projectId));
    if (!cloud || !keyed.length) return;
    ticking = true;
    try {
      const settled = new Set<Job>();
      await Promise.all(keyed.map(async (job) => {
        const done = await step(cloud, job).catch((error: unknown) => /Generation not found/.test(String(error)));
        if (done) settled.add(job);
      }));
      jobs = jobs.filter((job) => !settled.has(job));
      persist();
    } finally {
      ticking = false;
    }
  }

  /** Runs one quick fal request to completion: the prompt enhancer and voice samples. */
  async function falRun(endpoint: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await falFetch(undefined, `${queueOrigin}/${endpoint}`, { method: "POST", body: JSON.stringify(input) });
    const queued = record(await response.json().catch(() => ({})));
    if (!response.ok) refuse(falError(queued, response.status));
    const statusUrl = text(queued.status_url);
    const responseUrl = text(queued.response_url);
    if (!isQueueUrl(statusUrl) || !isQueueUrl(responseUrl)) refuse("fal.ai did not queue the request");
    const deadline = deps.now() + QUICK_TIMEOUT_MS;
    for (;;) {
      const status = record(await (await falFetch(undefined, statusUrl)).json().catch(() => ({})));
      if (text(status.status) === "COMPLETED") {
        if (status.error) refuse(clip(text(status.error), 400));
        break;
      }
      if (deps.now() > deadline) refuse("fal.ai took too long; try again.");
      await new Promise((done) => setTimeout(done, Math.min(deps.pollMs, 600)));
    }
    const result = await falFetch(undefined, responseUrl);
    const body = record(await result.json().catch(() => ({})));
    if (!result.ok) refuse(falError(body, result.status));
    return body;
  }

  const voiceCache = (): Record<string, string> => {
    try {
      return deps.voiceCacheFile && existsSync(deps.voiceCacheFile) ? record(JSON.parse(readFileSync(deps.voiceCacheFile, "utf8"))) as Record<string, string> : {};
    } catch {
      return {};
    }
  };

  async function saveAsset(cloud: StudioCloud, projectId: string, generationId: string, index: number, name?: string): Promise<{ assetId: string; copied: boolean }> {
    const generation = record(await cloud.client.query("studio:get", { projectId, sessionToken: cloud.sessionToken, generationId })) as unknown as StudioGeneration;
    const output = generation.outputs?.[index] ?? refuse("That generation has no such output yet.");
    const saved = generation.saved.find((entry) => entry.index === index);
    if (saved) return { assetId: saved.assetId, copied: true };
    const base = { projectId, sessionToken: cloud.sessionToken, generationId, index, name: name?.trim() ? `${clip(name.trim(), 120)}.${studioAssetName(generation, index).split(".").pop()}` : studioAssetName(generation, index) };
    const stored = await storeOutput(cloud, projectId, output.url, output.contentType);
    if (stored) return { assetId: text(await cloud.client.mutation("studio:saveAsset", { ...base, ...stored })), copied: true };
    return { assetId: text(await cloud.client.mutation("studio:saveAsset", base)), copied: false };
  }

  async function cancel(cloud: StudioCloud, projectId: string, generationId: string): Promise<{ cancelled: boolean }> {
    load();
    const job = jobs.find((candidate) => candidate.generationId === generationId && candidate.projectId === projectId);
    if (job) {
      const cancelUrl = job.cancelUrl ?? job.statusUrl.replace(/\/status$/, "/cancel");
      const response = await falFetch(projectId, cancelUrl, { method: "PUT" });
      const body = record(await response.json().catch(() => ({})));
      if (text(body.status) === "ALREADY_COMPLETED") {
        if (await step(cloud, job).catch(() => false)) {
          jobs = jobs.filter((candidate) => candidate !== job);
          persist();
        }
        return { cancelled: false };
      }
      if (!response.ok) refuse(falError(body, response.status));
      jobs = jobs.filter((candidate) => candidate !== job);
      persist();
    }
    await update(cloud, { projectId, generationId }, { status: "cancelled" });
    return { cancelled: true };
  }

  return {
    async generate(cloud, request, agentName, extra = {}) {
      load();
      if (!deps.falKey(request.projectId)) refuse(STUDIO_FAL_MISSING);
      const { model, label } = resolveModel(request);
      if (model.mode !== request.mode) refuse(`${model.label} makes ${model.mode === "edit" ? "edits" : model.kind}, not ${request.mode}; pick a model of that mode.`);
      const prompt = text(request.prompt).trim();
      if (prompt.length > PROMPT_MAX) refuse("The prompt is too long.");
      if (!prompt && model.prompt === "required" && !(model.family === "custom" && request.input)) refuse("Write a prompt first.");
      const sources = request.sources ?? (request.sourceAssetId ? [{ assetId: request.sourceAssetId }] : []);
      let media = extra.media;
      if (!media) {
        if (sources.length < model.needs.length) refuse(`${model.label} starts from ${model.needs.join(" and ")}: pass ${model.needs.length === 1 ? "a project asset or an earlier output" : "one source for each"}.`);
        const resolved: string[] = [];
        for (const [index, kind] of model.needs.entries()) resolved.push(await sourceMedia(cloud, request.projectId, sources[index]!, kind));
        if (model.family === "custom" && sources[0]) resolved.push(await sourceMedia(cloud, request.projectId, sources[0], "image"));
        const references: string[] = [];
        for (const assetId of (request.referenceAssetIds ?? []).slice(0, model.references ?? 0)) references.push(await assetMedia(cloud, request.projectId, assetId, "image"));
        media = { sources: resolved, references };
      }
      const follows = request.characterId ? await characterOf(cloud, request.projectId, request.characterId) : undefined;
      const references = [...new Set([...(media.references ?? []), ...(follows?.references ?? [])])].slice(0, model.references ?? 0);
      media = { ...media, references };
      const described = follows && model.kind !== "audio" && model.prompt !== "none" ? studioCharacterPrompt(follows.character, prompt) : prompt;
      const sent = await brandPrompt(cloud, request, model, described);
      const endpoint = model.family === "custom" ? model.id : studioEndpoint(model, references);
      const input = model.family === "custom"
        ? { ...(sent ? { prompt: sent } : {}), ...(media.sources[0] ? { image_url: media.sources[0] } : {}), ...record(request.input) }
        : studioInput(model, { ...request, prompt: sent }, media);
      const count = Math.min(Math.max(Math.trunc(Number(request.count) || 1), 1), model.maxCount);
      const sourceAssetId = sources[0] && "assetId" in sources[0] && !extra.media ? sources[0].assetId : undefined;
      const params = paramsOf(request, references.length, follows?.character);
      const ids: string[] = [];
      for (let index = 0; index < count; index += 1) {
        const generationId = text(await cloud.client.mutation("studio:create", {
          projectId: request.projectId, sessionToken: cloud.sessionToken, mode: request.mode, model: model.id, modelLabel: label, kind: model.kind, prompt,
          ...(request.aspectRatio ? { aspectRatio: request.aspectRatio } : {}), ...(request.duration ? { duration: request.duration } : {}),
          ...(sourceAssetId ? { sourceAssetId } : {}), ...(params ? { params } : {}), ...(agentName ? { agentName } : {}),
          ...(request.parent ? { parentId: request.parent.generationId, action: request.parent.action } : {}),
          ...(extra.workflow ? { workflowRunId: extra.workflow.runId, nodeId: extra.workflow.nodeId } : {}), ...(extra.intermediate ? { intermediate: true } : {}),
          ...(sent !== described ? { branded: true } : {}),
        }));
        ids.push(generationId);
        if (!await submit(cloud, request.projectId, generationId, endpoint, model.kind, input, extra.intermediate === true)) break;
      }
      return ids;
    },

    assetMedia,
    saveAsset,
    cancel,

    async pickForBroadcast(cloud, projectId, generationId, index, picked) {
      const assetId = picked ? (await saveAsset(cloud, projectId, generationId, index)).assetId : undefined;
      await cloud.client.mutation("studio:useInBroadcast", { projectId, sessionToken: cloud.sessionToken, generationId, index, picked });
      return assetId ? { assetId } : {};
    },

    async wait(cloud, projectId, ids, timeoutMs) {
      const deadline = deps.now() + timeoutMs;
      for (;;) {
        const rows = await Promise.all(ids.map((generationId) =>
          cloud.client.query("studio:get", { projectId, sessionToken: cloud.sessionToken, generationId }) as Promise<StudioGeneration>));
        if (rows.every((row) => STUDIO_TERMINAL.has(row.status)) || deps.now() >= deadline) return rows;
        await tick();
        await new Promise((done) => setTimeout(done, Math.min(deps.pollMs, Math.max(deadline - deps.now(), 0))));
      }
    },

    async enhance(prompt, mode) {
      const idea = prompt.trim();
      if (!idea) refuse("Write an idea to enhance first.");
      const kind = mode === "audio" ? "an audio generation (speech, music or a sound effect)" : mode === "video" ? "a video generation model; describe subject, action, setting, light and camera" : mode === "edit" ? "an image edit instruction" : "an image generation model; describe subject, composition, light, lens and style";
      const body = await falRun(STUDIO_ENHANCER.endpoint, {
        model: STUDIO_ENHANCER.model, max_tokens: 400, temperature: 0.7,
        system_prompt: `You write prompts for ${kind}. Rewrite the user's idea as one vivid, specific prompt of at most 80 words. Keep their subject, names and any quoted text exactly. Reply with the prompt only.`,
        prompt: clip(idea, 2_000),
      });
      const output = text(body.output).trim().replace(/^["“]|["”]$/g, "");
      return output ? clip(output, PROMPT_MAX) : refuse("The enhancer returned nothing; try again.");
    },

    async voicePreview(voice) {
      const known = STUDIO_VOICES.find((entry) => entry.name === voice) ?? refuse(`ElevenLabs has no voice ${clip(voice, 40)} here.`);
      const cache = voiceCache();
      if (cache[known.name]) return cache[known.name]!;
      const body = await falRun("fal-ai/elevenlabs/tts/eleven-v3", { text: `Hi, I'm ${known.name}. This is how your project sounds in my voice.`, voice: known.name });
      const url = studioOutputs(body, "audio")[0]?.url ?? refuse("fal.ai returned no audio.");
      if (deps.voiceCacheFile) writeFileAtomic(deps.voiceCacheFile, JSON.stringify({ ...cache, [known.name]: url }), { mode: 0o600 });
      return url;
    },

    async campaignCopy(brief) {
      const idea = clip(brief.trim(), 2_000) || refuse("Write a brief first.");
      const body = await falRun(STUDIO_ENHANCER.endpoint, {
        model: STUDIO_ENHANCER.model, max_tokens: 500, temperature: 0.7,
        system_prompt: "You write launch campaign copy. From the brief, reply with JSON only: {\"script\": a spoken voice-over of at most 40 words, \"caption\": a social post caption of at most 220 characters with up to three hashtags}. Keep names and quoted text exactly.",
        prompt: idea,
      });
      const raw = text(body.output).trim();
      const script = clip(text(copyField(raw, "script")).trim() || idea, PROMPT_MAX);
      return { script, caption: clip(text(copyField(raw, "caption")).trim() || idea, 2_000) };
    },

    resume() {
      load();
      schedule();
    },
    tick,
    pending: () => { load(); return jobs.length; },
    stop() {
      if (timer) clearTimeout(timer);
      timer = null;
      jobs = [];
      loaded = true;
    },
  };
}

/** One field of the JSON object a model wrote, wherever it sits in its reply. */
function copyField(reply: string, field: string): unknown {
  try {
    return record(JSON.parse(/\{[\s\S]*\}/.exec(reply)?.[0] ?? "") as unknown)[field];
  } catch {
    return undefined;
  }
}

function isFalQueueUrl(value: unknown, queueOrigin: string): value is string {
  try {
    const url = new URL(text(value));
    if (queueOrigin !== QUEUE_ORIGIN) return url.origin === queueOrigin;
    return url.protocol === "https:" && (url.hostname === "queue.fal.run" || url.hostname.endsWith(".fal.run"));
  } catch {
    return false;
  }
}

export function connectedStudioCloud(file = defaultOriginCloudFile(), connect: (url: string) => OriginCloudClient = convexOriginClient): StudioCloud | null {
  const state = readOriginCloud(file);
  return state.url && state.sessionToken ? { client: connect(state.url), sessionToken: state.sessionToken, url: state.url } : null;
}

let shared: StudioRunner | null = null;

/** The app server's one runner, so the page and every agent share one polling loop. */
export function studioRunner(): StudioRunner {
  shared ??= createStudioRunner({
    fetch: (input, init) => fetch(input, init),
    falKey: (projectId) => projectIntegrationKey("fal", projectId)?.key ?? null,
    cloud: () => connectedStudioCloud(),
    journalFile: join(DATA_DIR, "studio-jobs.json"),
    voiceCacheFile: join(DATA_DIR, "studio-voices.json"),
    now: () => Date.now(),
    pollMs: 2_500,
    queueOrigin: falQueueOrigin(),
  });
  return shared;
}
