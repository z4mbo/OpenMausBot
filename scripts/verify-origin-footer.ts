import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizePath, type Plugin } from "vite";
import { launchVerificationServer } from "./control-omb.ts";
import { mountPreview, parkUntilSignal, REPO_ROOT, type MountedPreview } from "./testing/preview-fixture.ts";

if (process.argv.length !== 2) throw new Error("This launcher uses only its own synthetic fixture");
const baseline = "0ca15f38b8916e5cb1b7dc9c63222a3228f5fc0e";
const paths = ["src/components/Sidebar.tsx", "src/components/SidebarFooterNav.tsx"];
const fixture = await launchVerificationServer();
const previews: MountedPreview[] = [];
try {
  const urls: Record<string, string> = {};
  for (const version of ["before", "after"]) {
    const overrides = new Map<string, string>();
    const sourceHashes: Record<string, string> = {};
    for (const path of paths) {
      const frozen = version === "before" ? spawnSync("git", ["show", `${baseline}:${path}`], { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }) : null;
      if (frozen && frozen.status !== 0) throw new Error("Frozen footer source is unavailable");
      const source = frozen?.stdout ?? readFileSync(join(REPO_ROOT, path), "utf8");
      sourceHashes[path] = createHash("sha256").update(source).digest("hex");
      if (frozen) overrides.set(normalizePath(join(REPO_ROOT, path)), source);
    }
    const frozenSource: Plugin = { name: "isolated-origin-footer", enforce: "pre", load(id) { return overrides.get(normalizePath(id.split("?")[0])); }, configureServer(server) { server.middlewares.use((_request, response, next) => { response.setHeader("Content-Security-Policy", "connect-src 'self'; form-action 'none'"); next(); }); } };
    const preview = await mountPreview(fixture, {
      entry: "/scripts/testing/origin-header-preview.tsx", route: "/__origin-header.html", title: "Synthetic Origin footer", hmr: false,
      cacheDir: join(fixture.info.dataDir, `vite-footer-${version}`), plugins: [frozenSource],
      aliases: [
        { find: /^@\/lib\/origin-cloud$/, replacement: fileURLToPath(new URL("./testing/origin-header-cloud.ts", import.meta.url)) },
        { find: /^@\/lib\/interface-mode$/, replacement: fileURLToPath(new URL("./testing/origin-header-mode.ts", import.meta.url)) },
        { find: /^@\//, replacement: `${join(REPO_ROOT, "src").replaceAll("\\", "/")}/` },
      ],
      extraRoutes: [{ path: "/__origin-header-fixture.json", handler: (_request, response) => { response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ version, baseline, sourceHashes, synthetic: true })); } }],
    });
    previews.push(preview); urls[version] = `${preview.previewUrl}?platform=win&width=240&mode=advanced&theme=dark`;
  }
  console.log(JSON.stringify({ ...fixture.info, launcherPid: process.pid, urls, baseline, synthetic: true }));
  await parkUntilSignal();
} finally {
  for (const preview of previews.reverse()) await preview.close();
  await fixture.close();
}
