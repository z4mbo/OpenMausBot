import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizePath, type Plugin } from "vite";
import { launchVerificationServer } from "./control-omb.ts";
import { mountPreview, parkUntilSignal, REPO_ROOT, type MountedPreview } from "./testing/preview-fixture.ts";

if (process.argv.length !== 2) throw new Error("This launcher uses only its own synthetic fixture");
const baseline = "87ff77be5ea79272175219d479b9a8017b4e8fcc";
const paths = ["src/pair/PairPage.tsx", "src/components/onboarding/reel/scenes/Terminal.tsx"];
const fixture = await launchVerificationServer();
const previews: MountedPreview[] = [];
try {
  const urls: Record<string, string> = {};
  for (const version of ["before", "after"]) {
    const overrides = new Map<string, string>();
    const sourceHashes: Record<string, string> = {};
    for (const path of paths) {
      const frozen = version === "before" ? spawnSync("git", ["show", `${baseline}:${path}`], { cwd: REPO_ROOT, encoding: "utf8" }) : null;
      if (frozen && frozen.status !== 0) throw new Error("Frozen branding source is unavailable");
      const source = frozen?.stdout ?? readFileSync(join(REPO_ROOT, path), "utf8");
      sourceHashes[path] = createHash("sha256").update(source).digest("hex");
      if (frozen) overrides.set(normalizePath(join(REPO_ROOT, path)), source);
    }
    const frozenSource: Plugin = { name: "isolated-origin-branding", enforce: "pre", load(id) { return overrides.get(normalizePath(id.split("?")[0])); }, configureServer(server) {
      server.middlewares.use((req, res, next) => {
        res.setHeader("Content-Security-Policy", "connect-src 'self'; form-action 'none'");
        if (req.url === "/.well-known/openmausbot/environment") { res.statusCode = 503; res.end(); return; }
        if (req.url === "/api/auth/session") { res.statusCode = 401; res.setHeader("content-type", "application/json"); res.end('{"error":"Synthetic unpaired browser"}'); return; }
        next();
      });
    } };
    const preview = await mountPreview(fixture, {
      entry: "/scripts/testing/origin-branding-preview.tsx", route: "/__origin-branding.html", title: "Synthetic Origin branding", hmr: false,
      cacheDir: join(fixture.info.dataDir, `vite-branding-${version}`), plugins: [frozenSource],
      extraRoutes: [{ path: "/__origin-branding-fixture.json", handler: (_req, res) => {
        res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ version, baseline, sourceHashes, synthetic: true }));
      } }],
    });
    previews.push(preview); urls[version] = preview.previewUrl;
  }
  console.log(JSON.stringify({ ...fixture.info, launcherPid: process.pid, urls, baseline, synthetic: true }));
  await parkUntilSignal();
} finally {
  for (const preview of previews.reverse()) await preview.close();
  await fixture.close();
}
