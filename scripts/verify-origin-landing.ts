import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { launchVerificationServer } from "./control-omb.ts";
import { mountPreview, parkUntilSignal, REPO_ROOT } from "./testing/preview-fixture.ts";
import { join } from "node:path";

const source = process.env.ORIGIN_LANDING_SOURCE;
assert.match(source ?? "", /^[a-f0-9]{40}$/);
delete process.env.VITE_ORIGIN_CONVEX_URL;
const fixture = await launchVerificationServer();
let preview: Awaited<ReturnType<typeof mountPreview>> | undefined;
try {
  const call = async (path: string, body: object, method: "POST" | "PUT" = "POST") => {
    const response = await fetch(new URL(path, fixture.info.url), { method, headers: { "content-type": "application/json", origin: fixture.info.url }, body: JSON.stringify(body) });
    const result = await response.json();
    assert.ok(response.ok, `Synthetic setup failed: ${method} ${path} ${response.status} ${JSON.stringify(result)}`);
    return result;
  };
  const initial = await fetch(new URL("/api/bots", fixture.info.url)).then(response => response.json()) as { bots: { id: string; name: string }[] };
  for (const bot of initial.bots.filter(bot => bot.name === "Fixture Starter")) {
    const response = await fetch(new URL(`/api/bots/${bot.id}`, fixture.info.url), { method: "DELETE", headers: { origin: fixture.info.url } });
    assert.ok(response.ok, "Synthetic starter cleanup failed");
  }
  await call("/api/config", { onboarding: { completedAt: "2026-10-18T00:00:00.000Z", version: 1, firstTurnAt: "2026-10-18T00:00:00.000Z", memberSetupAt: "2026-10-18T00:00:00.000Z", hintsSeen: ["first-conversation", "project-tour"] } }, "PUT");
  const workspace = (await call("/api/workspaces", { name: "Northwind" })).bot;
  const createProject = async (name: string) => {
    const bot = (await call("/api/bots", { name })).bot;
    return (await call(`/api/bots/${bot.id}/default-team`, { workspaceId: workspace.id })).chief;
  };
  const project = await createProject("Website relaunch");
  const mobile = await createProject("Mobile app");
  const brand = await createProject("Brand refresh");
  await call("/api/origin/cloud-links", { workspaces: { [workspace.id]: "landingworkspace" }, projects: { [project.id]: "landingproject", [mobile.id]: "landingmobile", [brand.id]: "landingbrand" } }, "PUT");
  const version = (JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as { version: string }).version;
  const paths = ["src/App.tsx", "src/components/Sidebar.tsx", "src/components/SidebarFooterNav.tsx", "src/components/OriginAccountMenu.tsx", "src/components/ChiefSections.tsx", "src/components/origin-pages/IssuesPage.tsx", "src/styles.css"];
  const metadata = { synthetic: true, source, version, projectId: project.id, workspaceId: workspace.id, sourceFiles: paths.map(path => ({ path, sha256: createHash("sha256").update(readFileSync(join(REPO_ROOT, path))).digest("hex") })), adapters: ["scripts/testing/landing-cloud.ts", "scripts/testing/landing-preview.tsx"], noCloudBackend: true, packagedApp: false };
  preview = await mountPreview(fixture, {
    entry: "/scripts/testing/landing-preview.tsx", route: "/__origin-landing.html", title: "Origin isolated landing capture", hmr: false, logLevel: "silent",
    cacheDir: process.env.ORIGIN_LANDING_CACHE,
    aliases: [{ find: /^@\/lib\/origin-cloud$/, replacement: fileURLToPath(new URL("./testing/landing-cloud.ts", import.meta.url)) }, { find: "@", replacement: fileURLToPath(new URL("../src", import.meta.url)) }],
    extraRoutes: [{ path: "/__origin-landing-fixture.json", handler: (_req, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(metadata)); } }],
  });
  console.log(JSON.stringify({ ...fixture.info, previewUrl: preview.previewUrl, metadata }));
  await parkUntilSignal();
} finally { await preview?.close(); await fixture.close(); }
