import { describe, expect, it } from "vitest";
import { runOriginTool, type OriginCloudClient, type OriginToolDeps } from "./origin-cloud.ts";
import type { BotRecord } from "./store.ts";

const BOTS = [{ id: "chief", name: "Kai", section: "Kai", chiefOfStaff: true }] as unknown as BotRecord[];

function convex(role = "member") {
  const rows: string[] = [];
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const answer = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    calls.push({ name, args });
    if (name === "projects:get") return { _id: "kai", teamId: "team1", name: "Kai", memberRole: role };
    if (name === "draw:canvases") return [{ _id: "canvas1", name: "Site" }];
    if (name === "draw:scene") return rows;
    if (name === "draw:updateElements") { rows.push(...(args.elements as string[])); return null; }
    if (name === "pages:publish") return { pageId: "page1", url: `https://origin.example/p/kai/${String(args.slug)}`, created: true, leadForms: 1, captureTurnedOn: true };
    if (name === "pages:list") return { captureEnabled: true, pages: [{ title: "Waitlist", url: "https://origin.example/p/kai/waitlist", views: 12, leads: 3, leadForms: 1, canvasId: "canvas1", frameId: "f1" }] };
    return null;
  };
  const client: OriginCloudClient = { query: answer, mutation: answer };
  return { client, calls };
}

const deps = (client: OriginCloudClient): OriginToolDeps => ({ bots: BOTS, state: { url: "http://127.0.0.1:3210", sessionToken: "tok", projects: { chief: "kai" } }, connect: () => client });
const run = (client: OriginCloudClient, name: string, args: Record<string, unknown>) => runOriginTool(name, args, "chief", deps(client));

describe("origin_page_publish and origin_page_list", () => {
  it("lets a Chief design a waitlist frame with a lead form and publish it by name", async () => {
    const { client, calls } = convex();
    const edit = await run(client, "origin_canvas_edit", { ops: [{ op: "create", node: {
      type: "frame", name: "Waitlist", w: 1200, layout: { direction: "column", gap: 24, padding: 64, hug: "height" },
      children: [{ type: "text", text: "Coming soon", fontSize: 56 }, { type: "frame", name: "Form", w: 400, leadForm: { fields: ["email"], button: "Notify me" } }],
    } }] });
    expect(edit.isError).toBeUndefined();
    const published = await run(client, "origin_page_publish", { frame: "waitlist", title: "Join the Origin waitlist" });
    expect(published.text).toContain("Published \"Join the Origin waitlist\" from frame \"Waitlist\" at https://origin.example/p/kai/join-the-origin-waitlist.");
    expect(published.text).toContain("Lead capture was off and is on now.");
    expect(calls.find((call) => call.name === "pages:publish")?.args).toMatchObject({ projectId: "kai", canvasId: "canvas1", slug: "join-the-origin-waitlist", title: "Join the Origin waitlist" });
    const missing = await run(client, "origin_page_publish", { frame: "Pricing" });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain('its top-level frames: "Waitlist"');
  });

  it("lists pages with their views and leads, and refuses a viewer", async () => {
    expect((await run(convex().client, "origin_page_list", {})).text).toContain('"Waitlist" https://origin.example/p/kai/waitlist · 12 views · 3 leads');
    const viewer = await run(convex("viewer").client, "origin_page_publish", { frame: "x" });
    expect(viewer.text).toContain("only views Kai");
  });
});
