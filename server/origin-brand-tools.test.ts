import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { normalizeBrandKit, defaultBrandKit, type StoredBrandKit } from "../shared/brand-kit.ts";
import { runOriginTool, type OriginCloudClient } from "./origin-cloud.ts";
import { createStudioRunner, type StudioCloud } from "./origin-studio.ts";
import { createOriginTurnContext } from "./origin-project-context.ts";
import type { BotRecord } from "./store.ts";

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

const DEPLOYMENT = "http://127.0.0.1:3210";
const BOTS = [
  { id: "lumen-chief", name: "Atlas", section: "Lumen", chiefOfStaff: true },
  { id: "lumen-writer", name: "Quill", section: "Lumen" },
] as unknown as BotRecord[];

function fakeConvex(seed: Partial<StoredBrandKit> | null = null) {
  let kit: StoredBrandKit | null = seed ? { ...defaultBrandKit("Lumen"), _id: "kit1", logos: [], icon: null, updatedBy: "ana", updatedAt: 1, ...seed } : null;
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const assets = [{ _id: "asset-logo", name: "Logo.svg", type: "icon" }, { _id: "asset-hero", name: "Hero", type: "image" }];
  let generation = 0;
  const handle = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    calls.push({ name, args });
    switch (name) {
      case "projects:get": return { _id: args.projectId, name: "Lumen", teamId: "team1", memberRole: "member" };
      case "design:list": return { assets, tokens: [] };
      case "brand:get": return kit;
      case "brand:update": {
        const { kit: next, problems } = normalizeBrandKit(args.kit, kit ?? defaultBrandKit("Lumen"));
        if (problems.length) throw new Error(`[CONVEX M(brand:update)] Uncaught Error: ${problems[0]}\n    at handler`);
        kit = { ...next, _id: "kit1", logos: next.logoAssetIds.map((assetId) => ({ assetId, name: assets.find((asset) => asset._id === assetId)!.name, url: null })), icon: null, updatedBy: "ana", agentName: String(args.agentName), updatedAt: 2 };
        return "kit1";
      }
      case "studio:create": return `gen${++generation}`;
      default: return null;
    }
  };
  const client: OriginCloudClient = { query: handle, mutation: handle };
  return { client, calls, kit: () => kit };
}

const deps = (client: OriginCloudClient) => ({ bots: BOTS, state: { url: DEPLOYMENT, sessionToken: "session", projects: { "lumen-chief": "lumen" } }, connect: () => client });

describe("brand agent tools", () => {
  it("tells an agent there is no kit yet, then drafts one with names for assets", async () => {
    const convex = fakeConvex();
    expect((await runOriginTool("origin_brand_get", {}, "lumen-chief", deps(convex.client))).text).toMatch(/no brand kit yet.*origin_brand_update/);
    const saved = await runOriginTool("origin_brand_update", {
      tagline: "Light for night owls", voice_adjectives: ["warm", "precise"], voice_dont: ["jargon"], primary: "#7c3aed", secondary: "#FDE68A",
      neutrals: ["#FFFFFF", "#111827"], heading_font: "fraunces", logos: ["logo.svg"], imagery: ["soft daylight"],
    }, "lumen-chief", deps(convex.client));
    expect(saved.isError).toBeUndefined();
    const update = convex.calls.find((call) => call.name === "brand:update")!;
    expect(update.args).toMatchObject({
      projectId: "lumen", agentName: "Atlas",
      kit: { tagline: "Light for night owls", voice: { adjectives: ["warm", "precise"], dont: ["jargon"] }, colors: { primary: "#7c3aed", secondary: "#FDE68A", neutrals: ["#FFFFFF", "#111827"] }, fonts: { heading: "fraunces" }, logoAssetIds: ["asset-logo"], imagery: ["soft daylight"] },
    });
    expect((update.args.kit as Record<string, unknown>).name).toBeUndefined();
    expect(saved.text).toContain("Assets > Brand");
    expect(saved.text).toContain("headings Fraunces (family \"fraunces\")");
    expect(saved.text).toContain("Logos: \"Logo.svg\" asset-logo");
    expect(saved.text).not.toContain("Fix the contrast");
  });

  it("refuses an unknown asset or bad colour with the reason, and flags weak contrast", async () => {
    const convex = fakeConvex();
    expect(await runOriginTool("origin_brand_update", { logos: ["nope"] }, "lumen-writer", deps(convex.client))).toMatchObject({ isError: true, text: expect.stringMatching(/No asset "nope"/) });
    expect(await runOriginTool("origin_brand_update", { primary: "purple" }, "lumen-writer", deps(convex.client))).toMatchObject({ isError: true, text: "The primary colour must be a hex colour such as #2563EB." });
    expect(await runOriginTool("origin_brand_update", {}, "lumen-writer", deps(convex.client))).toMatchObject({ isError: true });
    const weak = await runOriginTool("origin_brand_update", { primary: "#FDE68A" }, "lumen-writer", deps(convex.client));
    expect(weak.text).toMatch(/Fix the contrast of: Primary on background/);
  });
});

describe("Studio with the brand kit", () => {
  function runner(convex: ReturnType<typeof fakeConvex>) {
    const folder = mkdtempSync(join(tmpdir(), "omb-brand-"));
    folders.push(folder);
    const sent: unknown[] = [];
    const fetchFn = (async (_input: string | URL | Request, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)));
      return Response.json({ request_id: "r1", status_url: "https://queue.fal.run/x/requests/r1/status", response_url: "https://queue.fal.run/x/requests/r1" });
    }) as typeof fetch;
    const cloud: StudioCloud = { client: convex.client, sessionToken: "session", url: DEPLOYMENT };
    return { cloud, sent, studio: createStudioRunner({ fetch: fetchFn, falKey: () => "key", cloud: () => cloud, journalFile: join(folder, "jobs.json"), now: () => 1, pollMs: 60_000, checkBudget: () => undefined }) };
  }

  it("puts the imagery and colours ahead of image and video prompts unless brand is false, and never ahead of audio", async () => {
    const convex = fakeConvex({ imagery: ["soft daylight"], colors: { primary: "#7C3AED", secondary: "#F59E0B", neutrals: ["#FFFFFF", "#111827"] } });
    const { cloud, sent, studio } = runner(convex);
    await studio.generate(cloud, { projectId: "lumen", mode: "image", model: "fal-ai/nano-banana-pro", prompt: "a desk at dawn" });
    await studio.generate(cloud, { projectId: "lumen", mode: "image", model: "fal-ai/nano-banana-pro", prompt: "a desk at dawn", brand: false });
    await studio.generate(cloud, { projectId: "lumen", mode: "audio", model: "fal-ai/elevenlabs/tts/eleven-v3", prompt: "Hello" });
    expect(sent).toEqual([
      expect.objectContaining({ prompt: "Visual style: soft daylight. Brand colours: primary #7C3AED, secondary #F59E0B, neutrals #FFFFFF, #111827.\n\na desk at dawn" }),
      expect.objectContaining({ prompt: "a desk at dawn" }),
      expect.objectContaining({ text: "Hello" }),
    ]);
    const creates = convex.calls.filter((call) => call.name === "studio:create").map((call) => call.args);
    expect(creates.map((args) => [args.prompt, args.branded])).toEqual([["a desk at dawn", true], ["a desk at dawn", undefined], ["Hello", undefined]]);
  });

  it("sends the prompt as written when the project has no kit", async () => {
    const { cloud, sent, studio } = runner(fakeConvex());
    await studio.generate(cloud, { projectId: "lumen", mode: "video", model: "fal-ai/veo3.1", prompt: "a slow pan" });
    expect(sent).toEqual([expect.objectContaining({ prompt: "a slow pan" })]);
  });
});

describe("brand in an agent's project context", () => {
  const context = (client: OriginCloudClient) => createOriginTurnContext({
    bots: () => BOTS, state: () => ({ url: DEPLOYMENT, sessionToken: "session", projects: { "lumen-chief": "lumen" } }), connect: () => client, waitMs: 5_000,
  });

  it("gives every agent of the project the voice to write in, and nudges toward a kit when there is none", async () => {
    const voiced = fakeConvex({ tagline: "Light for night owls", voice: { adjectives: ["warm", "precise"], do: ["Short sentences"], dont: ["Jargon"] }, fonts: { heading: "fraunces", body: "dm-sans" } });
    const status = (await context(voiced.client).parts("lumen-writer")).find((part) => part.id === "origin-status")!.text;
    expect(status).toContain(`- Brand: Lumen ("Light for night owls") voice: sound warm, precise. do: Short sentences. don't: Jargon. Colours #2563EB and #F59E0B; fonts Fraunces and DM Sans.`);
    const bare = (await context(fakeConvex().client).parts("lumen-chief")).find((part) => part.id === "origin-status")!.text;
    expect(bare).toContain("- Brand: no kit yet (draft one with origin_brand_update)");
  });
});
