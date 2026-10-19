import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizePath, type Plugin } from "vite";
import { launchVerificationServer } from "./control-omb.ts";
import { mountPreview, parkUntilSignal, REPO_ROOT, type MountedPreview } from "./testing/preview-fixture.ts";

if (process.argv.length !== 2) throw new Error("This launcher uses only its own synthetic fixture");
const baseline = "37a3b2c450e8a47e489284d6abaa232078541cad";
const componentPaths = ["src/components/Sidebar.tsx", "src/components/SidebarIdentity.tsx", "src/components/OriginAccountMenu.tsx", "src/components/DesktopWorkspaceSwitcher.tsx", "src/components/SidebarPopoverMenu.tsx", "src/styles.css"];
const fixture = await launchVerificationServer();
const previews: MountedPreview[] = [];
try {
  const urls: Record<string, string> = {};
  for (const version of ["before", "after"]) {
    const overrides = new Map<string, string>();
    const sourceHashes: Record<string, string> = {};
    for (const path of componentPaths) {
      const frozen = version === "before" ? spawnSync("git", ["show", `${baseline}:${path}`], { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }) : null;
      if (frozen && frozen.status !== 0) throw new Error("Frozen header fixture source is unavailable");
      const source = frozen?.stdout ?? readFileSync(join(REPO_ROOT, path), "utf8");
      sourceHashes[path] = createHash("sha256").update(source).digest("hex");
      if (frozen) overrides.set(normalizePath(join(REPO_ROOT, path)), source);
    }
    const frozenSource: Plugin = { name: "isolated-origin-header", enforce: "pre", load(id) { return overrides.get(normalizePath(id.split("?")[0])); }, configureServer(server) {
      server.middlewares.use((_req, res, next) => { res.setHeader("Content-Security-Policy", "connect-src 'self'; form-action 'none'"); next(); });
    } };
    const preview = await mountPreview(fixture, {
      entry: "/scripts/testing/origin-header-preview.tsx", route: "/__origin-header.html", title: "Synthetic Origin header", hmr: false,
      cacheDir: join(fixture.info.dataDir, `vite-header-${version}`), plugins: [frozenSource],
      aliases: [
        { find: /^@\/lib\/origin-cloud$/, replacement: fileURLToPath(new URL("./testing/origin-header-cloud.ts", import.meta.url)) },
        { find: /^@\/lib\/interface-mode$/, replacement: fileURLToPath(new URL("./testing/origin-header-mode.ts", import.meta.url)) },
        { find: /^@\//, replacement: `${join(REPO_ROOT, "src").replaceAll("\\", "/")}/` },
      ],
      extraRoutes: [{ path: "/__origin-header-fixture.json", handler: (_req, res) => {
        const currentHashes = { ...sourceHashes };
        for (const path of ["scripts/testing/origin-header-preview.tsx", "scripts/testing/origin-header-cloud.ts", "scripts/testing/origin-header-mode.ts"]) currentHashes[path] = createHash("sha256").update(readFileSync(join(REPO_ROOT, path))).digest("hex");
        res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ version, baseline, sourceHashes: currentHashes, synthetic: true }));
      } }],
    });
    previews.push(preview);
    urls[version] = `${preview.previewUrl}?platform=mac&width=240&mode=advanced&theme=dark`;
  }
  console.log(JSON.stringify({ ...fixture.info, launcherPid: process.pid, urls, baseline, synthetic: true }));
  await parkUntilSignal();
} finally {
  for (const preview of previews.reverse()) await preview.close();
  await fixture.close();
}
