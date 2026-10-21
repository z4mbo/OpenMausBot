/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { createSession } from "./lib/auth";
import { applyCanvasOps } from "../../shared/canvas-ops";
import { encodeNode } from "../../shared/canvas-scene";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
afterEach(() => { vi.unstubAllEnvs(); });

async function fixture() {
  vi.stubEnv("CONVEX_SITE_URL", "https://fixture.convex.site");
  const t = convexTest(schema, modules);
  const [owner, viewer] = await t.run(async ctx => Promise.all(["owner", "viewer"].map(async name => {
    const id = await ctx.db.insert("users", { name, email: `${name}@pages.test`, role: "user", status: "active", passwordHash: "unused", salt: "unused", iterations: 1, createdAt: 1, updatedAt: 1 });
    return { id, email: `${name}@pages.test`, token: await createSession(ctx, id) };
  })));
  const sessionToken = owner!.token;
  const { teamId } = await t.mutation(api.workspaces.create, { sessionToken, name: "Acme Launch" });
  await t.run(ctx => ctx.db.insert("teamMembers", { teamId, userId: viewer!.id, email: viewer!.email, name: "viewer", role: "viewer", status: "active", createdAt: 1, updatedAt: 1 }));
  const projectId = await t.mutation(api.projects.create, { sessionToken, teamId, name: "Launch" });
  const canvasId = await t.mutation(api.draw.createCanvas, { sessionToken, projectId, name: "Site" });
  const { changed, created } = applyCanvasOps(new Map(), [{ op: "create", node: {
    type: "frame", key: "page", name: "Waitlist", w: 1200, h: 800, fill: "#0B0B0F", layout: { direction: "column", gap: 24, padding: 64, align: "center", hug: "height" },
    children: [
      { type: "text", text: "Ship faster with Origin", fontSize: 64, fontWeight: 700, fill: "#FFFFFF" },
      { type: "text", text: "Join the waitlist and we will let you know the moment your seat is ready.", fontSize: 18, fill: "#A1A1AA", w: 520 },
      { type: "frame", key: "cta", name: "Docs button", w: 160, h: 44, fill: "#7C3AED", radius: 10, link: "https://example.com/docs", layout: { direction: "row", align: "center", justify: "center" }, children: [{ type: "text", text: "Read <docs>", fill: "#FFFFFF" }] },
      { type: "frame", key: "form", name: "Signup", w: 420, h: 10, fill: null, leadForm: { fields: ["name", "email"], button: "Join the waitlist", accent: "#7C3AED" } },
    ],
  } }]);
  await t.mutation(api.draw.updateElements, { sessionToken, teamId, canvasId, elements: changed.map(encodeNode) });
  const frameId = created.find(node => node.key === "page")!.id;
  return { t, owner: owner!, viewer: viewer!, scope: { sessionToken, projectId }, canvasId, frameId, teamId };
}

test("a published frame is served as a page that counts views and accepts no form posts", async () => {
  const { t, scope, canvasId, frameId } = await fixture();
  const published = await t.mutation(api.pages.publish, { ...scope, canvasId, frameId, slug: "waitlist", title: "Origin waitlist" });
  expect(published).toMatchObject({ created: true, leadForms: 1 });
  expect(published.url).toBe("https://fixture.convex.site/p/acme-launch/waitlist");
  const path = new URL(published.url).pathname;

  const page = await t.fetch(path, { headers: { "User-Agent": "Mozilla/5.0" } });
  expect(page.status).toBe(200);
  expect(page.headers.get("content-security-policy")).toContain("form-action 'none'");
  const html = await page.text();
  expect(html).toContain("<title>Origin waitlist</title>");
  expect(html).toContain('<meta name="description" content="Join the waitlist and we will let you know the moment your seat is ready.">');
  expect(html).toMatch(/<h1 class="o-t"[^>]*>Ship faster with Origin<\/h1>/);
  expect(html).toContain('<a href="https://example.com/docs"');
  expect(html).toContain("Read &lt;docs&gt;");
  expect(html).not.toContain("<script");
  await t.fetch(path, { headers: { "User-Agent": "Googlebot/2.1" } });

  const posted = await t.fetch(path, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ name: "Ada", email: "ada@example.com" }).toString() });
  expect(posted.status).toBe(404);
  const listed = await t.query(api.pages.list, scope);
  expect(listed.pages).toEqual([expect.objectContaining({ slug: "waitlist", views: 1, url: published.url })]);
});

test("republishing keeps one page per frame, slugs stay unique and unpublishing takes it down", async () => {
  const { t, scope, canvasId, frameId, viewer } = await fixture();
  const first = await t.mutation(api.pages.publish, { ...scope, canvasId, frameId, slug: "waitlist", title: "One" });
  const again = await t.mutation(api.pages.publish, { ...scope, canvasId, frameId, slug: "join", title: "Two", description: "Custom" });
  expect(again).toMatchObject({ pageId: first.pageId, created: false });
  expect((await t.fetch(new URL(first.url).pathname)).status).toBe(404);
  expect(await (await t.fetch(new URL(again.url).pathname)).text()).toContain('content="Custom"');
  await expect(t.mutation(api.pages.publish, { ...scope, canvasId, frameId, slug: "Bad Slug", title: "x" })).rejects.toThrow("lowercase");
  await expect(t.mutation(api.pages.publish, { ...scope, canvasId, frameId: "missing", slug: "other", title: "x" })).rejects.toThrow("Choose a frame");
  await expect(t.mutation(api.pages.publish, { ...scope, sessionToken: viewer.token, canvasId, frameId, slug: "join", title: "x" })).rejects.toThrow();
  await expect(t.mutation(api.pages.unpublish, { ...scope, sessionToken: viewer.token, pageId: again.pageId })).rejects.toThrow();
  await t.mutation(api.pages.unpublish, { ...scope, pageId: again.pageId });
  expect((await t.fetch(new URL(again.url).pathname)).status).toBe(404);
  expect((await t.query(api.pages.list, scope)).pages).toEqual([]);
});
