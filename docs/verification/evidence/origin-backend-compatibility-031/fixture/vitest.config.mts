import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const worker = resolve(import.meta.dirname, "../..");
const directory = resolve(import.meta.dirname);
const baseline = "C:/Users/aless/.codex/worktrees/origin-compat-client-030/Origin";
const candidate = "C:/Users/aless/Documents/Origin-bugfix";
const sources = [{ root: baseline, prefixes: ["server", "shared"], source: "0eb372a94715527931043a1b6d8c02a50194dbb0", role: "baseline-client" }, { root: candidate, prefixes: ["server", "shared"], source: "dd5b63ef914c5a546ea99cbef65b29b33078c7e9", role: "candidate-client" }, { root: worker.replaceAll("\\", "/"), prefixes: ["backend/convex", "backend/lib", "shared"], source: "3b85cb69c0c907a9aa08ba98b664cb5889cbe83a", role: "registered-candidate-backend" }];
const loaded = new Map<string, unknown>();
mkdirSync(directory, { recursive: true });
export default {
  root: worker,
  plugins: [{ name: "bind-original-caller-module-ids", enforce: "pre", load(id) {
    const normalized = id.replaceAll("\\", "/").split("?")[0];
    const match = sources.find(item => item.prefixes.some(prefix => normalized.startsWith(`${item.root}/${prefix}/`)));
    if (!match || !/\.[cm]?[jt]sx?$/.test(normalized)) return;
    const path = normalized.slice(match.root.length + 1);
    const contents = execFileSync("git", ["show", `${match.source}:${path}`], { cwd: match.root, encoding: "utf8" }).replaceAll("\r\n", "\n");
    const gitBlob = execFileSync("git", ["rev-parse", `${match.source}:${path}`], { cwd: match.root, encoding: "utf8" }).trim();
    loaded.set(normalized, { role: match.role, path, originalModuleId: normalized, source: match.source, gitBlob, sha256Lf: createHash("sha256").update(contents).digest("hex") });
    writeFileSync(resolve(directory, "module-loads.json"), JSON.stringify([...loaded.values()], null, 2) + "\n");
    return contents;
  } }],
  test: { environment: "node", include: [".omb-scratch/compatibility-031/compatibility.test.ts"], setupFiles: [".omb-scratch/compatibility-031/setup.ts"], fileParallelism: false, maxWorkers: 1, testTimeout: 30000, hookTimeout: 30000 },
  resolve: { alias: { "convex-test": resolve(worker, "backend/node_modules/convex-test/dist/index.js"), "vitest": resolve(worker, "backend/node_modules/vitest/dist/index.js") } },
};
