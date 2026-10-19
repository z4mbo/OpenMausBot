import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launchVerificationServer } from "./control-omb.ts";
import { mountPreview, parkUntilSignal, REPO_ROOT } from "./testing/preview-fixture.ts";
import { createOriginInviteRoutes, type OriginConvex } from "../server/origin-invites.ts";
import { json, readBody } from "../server/harness/http.ts";
import { dispatchRoutes, type RouteHandler } from "../server/routes/table.ts";
import { ORIGIN_HOSTED_CONVEX_URL, ORIGIN_HOSTED_SITE_URL } from "../shared/origin-site-address.ts";
import { normalizePath, type Plugin } from "vite";

const before = process.argv.includes("--before");
if (process.argv.slice(2).some(arg => arg !== "--before")) throw new Error("Only --before is supported");
const baseline = "683f3e5e9ef0a53d86723fc0aa2403ab831993b7";
const interAsset = "site/.next/static/media/e4af272ccee01ff0-s.p.woff2";
const interPath = join(REPO_ROOT, interAsset);
const interFont = existsSync(interPath) ? readFileSync(interPath) : null;
const font = { available: interFont !== null, asset: interFont ? interAsset : null, sha256: interFont ? createHash("sha256").update(interFont).digest("hex") : null };
const fixture = await launchVerificationServer();
let preview: Awaited<ReturnType<typeof mountPreview>> | undefined;
let acceptancePreview: Awaited<ReturnType<typeof mountPreview>> | undefined;
const sourceHashes: Record<string, string> = {};
const calls: { kind: string; name: string; mail?: string }[] = [];
type LegacyFactory = (deps: { publicUrl(): null; convexUrl(): string; connect(): OriginConvex; sendMail(): Promise<boolean> }) => RouteHandler;
let legacy: LegacyFactory | null = null;
const snapshot = join(fixture.info.dataDir, "origin-invites-baseline");
const overrides = new Map<string, string>();
function sourceFile(relative: string) {
  const result = spawnSync("git", ["show", `${baseline}:${relative}`], { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`Could not read frozen fixture source ${relative}`);
  sourceHashes[relative] = createHash("sha256").update(result.stdout).digest("hex");
  return result.stdout;
}
function rewriteImports(source: string, relative: string, browser: boolean) {
  return source.replace(/(from\s+|import\s*)(["'])([^"']+)\2/g, (all, prefix: string, _quote: string, specifier: string) => {
    if (!specifier.startsWith(".")) return !browser && !specifier.startsWith("node:") ? `${prefix}${JSON.stringify(import.meta.resolve(specifier))}` : all;
    const raw = resolve(dirname(join(REPO_ROOT, relative)), specifier);
    const target = [raw, `${raw}.ts`, `${raw}.tsx`, `${raw}.mjs`, join(raw, "index.ts")].find(candidate => existsSync(candidate));
    if (!target) throw new Error(`Cannot resolve frozen source import ${specifier}`);
    return `${prefix}${JSON.stringify(browser ? `/@fs/${target.replaceAll("\\", "/")}` : pathToFileURL(target).href)}`;
  });
}
try {
  const aliases = [
    { find: /^@\/lib\/origin-cloud(?:\/(?:client|hooks))?$/, replacement: fileURLToPath(new URL("./testing/origin-invites-cloud.ts", import.meta.url)) },
    { find: /^@\/lib\/(?:origin-cloud-links|origin-sync)$/, replacement: fileURLToPath(new URL("./testing/origin-invites-cloud.ts", import.meta.url)) },
  ];
  if (before) {
    mkdirSync(snapshot, { recursive: true });
    for (const relative of ["src/lib/origin-members.ts", "src/components/origin-members/WorkspaceMembers.tsx", "site/components/auth-page.tsx"]) overrides.set(normalizePath(join(REPO_ROOT, relative)), sourceFile(relative));
    writeFileSync(join(snapshot, "origin-invites.ts"), rewriteImports(sourceFile("server/origin-invites.ts"), "server/origin-invites.ts", false));
    legacy = (await import(pathToFileURL(join(snapshot, "origin-invites.ts")).href) as { createOriginInviteRoutes: LegacyFactory }).createOriginInviteRoutes;
    writeFileSync(join(snapshot, "provenance.json"), JSON.stringify({ baseline, sourceHashes, transform: "UI unchanged under original module IDs; server import paths only" }, null, 2));
  } else {
    for (const relative of ["src/lib/origin-members.ts", "src/components/origin-members/WorkspaceMembers.tsx", "server/origin-invites.ts", "site/components/auth-page.tsx"]) sourceHashes[relative] = createHash("sha256").update(readFileSync(join(REPO_ROOT, relative))).digest("hex");
  }
  const frozenSource: Plugin = { name: "frozen-origin-invitation-source", enforce: "pre", load(id) { return overrides.get(normalizePath(id.split("?")[0])); } };
  aliases.push({ find: /^@\//, replacement: `${join(REPO_ROOT, "src").replaceAll("\\", "/")}/` });
  preview = await mountPreview(fixture, {
    entry: "/scripts/testing/origin-invites-preview.tsx", route: "/__origin-invites.html", title: "Synthetic Origin invitations", hmr: false, aliases, plugins: [frozenSource],
    extraRoutes: [
      { path: "/__origin-invites-fixture.json", handler: (_req, res) => { json(res, 200, { version: before ? "before" : "after", baseline, sourceHashes, calls }); } },
      { path: /^\/api\/origin\/(?:invites|invite-address|app-address)$/, handler: async (req, res) => {
        const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
        const params = new URL(req.headers.referer ?? "/", url).searchParams;
        const mail = params.get("mail") === "failed" ? "failed" : params.get("mail") === "not_configured" ? "not_configured" : "accepted";
        const backend = params.get("connection") === "custom" ? "https://fixture.example.convex.cloud" : ORIGIN_HOSTED_CONVEX_URL;
        const origin = backend === ORIGIN_HOSTED_CONVEX_URL ? ORIGIN_HOSTED_SITE_URL : null;
        const invitation = { token: "b".repeat(64), expiresAt: Date.now() + 7 * 86_400_000, teamName: "Synthetic workspace" };
        const client: OriginConvex = {
          query: async name => {
            calls.push({ kind: "query", name });
            if (name === "workspaces:inviteAddress") return { convexUrl: backend, origin };
            if (name === "auth:me") return { name: "Synthetic owner", email: "owner@example.test" };
            throw new Error("Unexpected synthetic query");
          },
          mutation: async name => { calls.push({ kind: "mutation", name }); if (name !== "workspaces:createInvite") throw new Error("Unexpected synthetic mutation"); return invitation; },
          action: async name => { calls.push({ kind: "action", name, mail }); if (name !== "workspaces:sendEmailInvite") throw new Error("Unexpected synthetic action"); return { ...invitation, inviteLink: `${origin}/join/${invitation.token}`, sent: mail === "accepted", deliveryStatus: mail }; },
        };
        const route = legacy ? legacy({ publicUrl: () => null, convexUrl: () => backend, connect: () => client, sendMail: async () => { calls.push({ kind: "synthetic-mail", name: "sendMail", mail }); return mail === "accepted"; } })
          : createOriginInviteRoutes({ publicUrl: () => null, convexUrl: () => backend, connect: () => client });
        if (!await dispatchRoutes([route], { req, res, url, path: url.pathname, method: req.method ?? "GET", auth: { kind: "loopback", scopes: ["client"] }, json, readBody })) json(res, 404, { error: "Synthetic route unavailable" });
      } },
    ],
  });
  const siteRequire = createRequire(join(REPO_ROOT, "site", "package.json"));
  const siteAdapter = fileURLToPath(new URL("./testing/origin-invite-acceptance-cloud.tsx", import.meta.url));
  acceptancePreview = await mountPreview(fixture, {
    entry: "/scripts/testing/origin-invite-acceptance-preview.tsx", route: "/__origin-invite-acceptance.html", title: "Synthetic Origin invite acceptance", hmr: false,
    cacheDir: join(fixture.info.dataDir, "vite-invite-acceptance-cache"), plugins: [frozenSource],
    aliases: [
      { find: /^react(?=\/|$)/, replacement: dirname(siteRequire.resolve("react/package.json")) },
      { find: /^react-dom(?=\/|$)/, replacement: dirname(siteRequire.resolve("react-dom/package.json")) },
      { find: /^(?:convex\/react|next\/link|@\/lib\/convex-api|\.\/brand|\.\/origin-site)$/, replacement: siteAdapter },
      { find: /^@\//, replacement: `${join(REPO_ROOT, "site").replaceAll("\\", "/")}/` },
    ],
    extraRoutes: [
      { path: "/__origin-invites-fixture.json", handler: (_req, res) => { json(res, 200, { version: before ? "before" : "after", baseline, sourceHashes, font }); } },
      { path: "/__origin-invites-inter.woff2", method: "GET", handler: (_req, res) => {
        if (!interFont) { json(res, 404, { error: "Local fixture font unavailable" }); return; }
        res.setHeader("content-type", "font/woff2"); res.setHeader("cache-control", "no-store"); res.end(interFont);
      } },
    ],
  });
  console.log(JSON.stringify({ ...fixture.info, previewUrl: `${preview.previewUrl}?version=${before ? "before" : "after"}&theme=dark&mail=accepted`, acceptanceUrl: acceptancePreview.previewUrl, baseline, sourceHashes, font, synthetic: true }));
  await parkUntilSignal();
} finally { await acceptancePreview?.close(); await preview?.close(); await fixture.close(); }
