import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { applyCanvasOps } from "../shared/canvas-ops.ts";
import { encodeNode } from "../shared/canvas-scene.ts";
import { launchVerificationServer } from "./control-omb.ts";
import { mountPreview, parkUntilSignal } from "./testing/preview-fixture.ts";
import { startFakeConvex, type FakeConvex } from "./testing/origin-campaigns-backend.ts";

type Json = Record<string, unknown>;
type Fetching = { fetch(path: string, init?: RequestInit): Promise<Response> };

/** A waitlist landing page on a canvas, built the way origin_canvas_edit builds it, plus a second frame without a form. */
function waitlistScene() {
  const feature = (title: string, body: string) => ({
    type: "frame", name: title, w: 360, fill: "#15151B", radius: 16, stroke: "#26262E", strokeWidth: 1, grow: true, layout: { direction: "column", gap: 10, padding: 28, hug: "height" },
    children: [{ type: "text", text: title, fontSize: 20, fontWeight: 600, fill: "#FFFFFF" }, { type: "text", text: body, fontSize: 15, fill: "#A1A1AA", w: 300, lineHeight: 1.5 }],
  });
  return applyCanvasOps(new Map(), [
    { op: "create", node: {
      type: "frame", name: "Waitlist", w: 1440, fill: "#0B0B0F", layout: { direction: "column", gap: 40, padding: [120, 120, 96, 120], align: "center", hug: "height" },
      children: [
        { type: "text", text: "EARLY ACCESS", fontSize: 13, fontWeight: 600, fill: "#A78BFA" },
        { type: "text", text: "Take your idea from canvas to customers", fontSize: 72, fontWeight: 700, fill: "#FFFFFF", w: 980, align: "center", lineHeight: 1.05 },
        { type: "text", text: "Origin turns a design into a live page that collects leads straight into your pipeline. Join the waitlist and get a seat first.", fontSize: 20, fill: "#A1A1AA", w: 640, align: "center", lineHeight: 1.5 },
        { type: "frame", name: "Signup", w: 420, fill: null, leadForm: { fields: ["name", "email"], button: "Join the waitlist", accent: "#8B5CF6" } },
        { type: "frame", name: "Features", w: 1200, fill: null, layout: { direction: "row", gap: 24, hug: "height" }, children: [
          feature("Design", "Lay out the page on a shared canvas with your team and your Chief."),
          feature("Publish", "One click turns the frame into a fast, responsive page with its own address."),
          feature("Follow up", "Every signup lands in Pipeline, ready for your agents to contact."),
        ] },
        { type: "frame", name: "Docs link", w: 180, h: 44, radius: 10, stroke: "#3F3F46", strokeWidth: 1, fill: null, link: "https://example.com/docs", layout: { direction: "row", align: "center", justify: "center" },
          children: [{ type: "text", text: "Read the docs", fontSize: 15, fontWeight: 500, fill: "#E4E4E7" }] },
      ],
    } },
    { op: "create", node: { type: "frame", name: "Poster", x: 1600, y: 0, w: 800, h: 500, fill: "#F5F3FF", children: [
      { type: "text", x: 64, y: 64, text: "Launch week", fontSize: 56, fontWeight: 700, fill: "#1E1B4B", autoWidth: true },
      { type: "ellipse", x: 520, y: 200, w: 220, h: 220, fill: "#8B5CF6" },
      { type: "rect", x: 64, y: 380, w: 200, h: 56, radius: 12, fill: "#1E1B4B" },
    ] } },
  ]).changed.map(encodeNode);
}

async function seed(convex: FakeConvex) {
  const { t, ref } = convex;
  const { createSession } = await convex.load<{ createSession(ctx: unknown, userId: string): Promise<string> }>("convex/lib/auth.ts");
  const token = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: "Ada", email: "ada@fixture.test", role: "user", status: "active", passwordHash: "unused", salt: "unused", iterations: 1, createdAt: 1, updatedAt: 1 });
    return createSession(ctx, userId);
  });
  const call = (name: string, args: Json) => t.mutation(ref(name), { sessionToken: token, ...args });
  const { teamId } = await call("workspaces:create", { name: "Acme Launch" }) as { teamId: string };
  const projectId = String(await call("projects:create", { teamId, name: "Launch" }));
  const canvasId = String(await call("draw:createCanvas", { projectId, name: "Website" }));
  await call("draw:updateElements", { teamId, canvasId, elements: waitlistScene() });
  return { token, projectId, teamId, canvasId };
}

async function relay(convex: FakeConvex, req: IncomingMessage, res: ServerResponse) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const headers: Record<string, string> = {};
  for (const name of ["content-type", "user-agent"]) if (req.headers[name]) headers[name] = String(req.headers[name]);
  const response = await (convex.t as unknown as Fetching).fetch(req.url ?? "/", { method: req.method, headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
  res.statusCode = response.status;
  response.headers.forEach((value, name) => res.setHeader(name, value));
  res.end(Buffer.from(await response.arrayBuffer()));
}

const convex = await startFakeConvex();
const seeded = await seed(convex);
const fixture = await launchVerificationServer();
const cloud = fileURLToPath(new URL("./testing/origin-campaigns-cloud.ts", import.meta.url));
let preview: Awaited<ReturnType<typeof mountPreview>> | undefined;
try {
  preview = await mountPreview(fixture, {
    entry: "/scripts/testing/origin-published-pages-preview.tsx", route: "/__origin-published-pages.html", title: "Isolated Origin pages",
    extraRoutes: [
      { path: "/__origin-campaigns.json", handler: (_req, res) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ url: convex.url, token: seeded.token, viewerToken: seeded.token, projectId: seeded.projectId })); } },
      { path: /^\/(?:p\/[^/]+\/[^/]+|uploads)$/, handler: (req, res) => relay(convex, req, res) },
    ],
    aliases: [
      { find: /^@\/lib\/origin-cloud(?:\/client)?$/, replacement: cloud },
      { find: "@", replacement: fileURLToPath(new URL("../src", import.meta.url)) },
    ],
  });
  // Published pages, uploads and their links resolve on the preview, which relays them to the in-memory backend's HTTP actions.
  process.env.CONVEX_SITE_URL = new URL(preview.previewUrl).origin;
  console.log(JSON.stringify({ ...fixture.info, previewUrl: preview.previewUrl, convexUrl: convex.url, projectId: seeded.projectId }));
  await parkUntilSignal();
} finally { await preview?.close(); await fixture.close(); await convex.close(); }
