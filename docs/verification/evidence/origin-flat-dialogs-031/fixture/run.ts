import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { transformWithEsbuild } from "vite";
import { launchVerificationServer, runControlOmb } from "../../scripts/control-omb.ts";
import { mountPreview } from "../../scripts/testing/preview-fixture.ts";

const stage = process.argv[2];
if (!["before", "focus-after", "after"].includes(stage)) throw new Error("Choose before, focus-after or after");
const outputName = process.argv[3] ?? stage;
if (!/^[a-z0-9-]+$/.test(outputName)) throw new Error("Invalid owned output name");
const out = resolve(".omb-scratch/flat-dialogs-031", outputName);
await mkdir(out);
const paths = ["src/components/AboutDialog.tsx", "src/components/ConfirmDialog.tsx", "src/components/FilesView.tsx", "src/styles.css", "shared/origin-theme.css", "src/hooks/use-modal-dialog.ts"];
const baseline = "37a3b2c450e8a47e489284d6abaa232078541cad";
const sourceBytes = new Map(await Promise.all(paths.map(async path => [path, stage === "before" ? execFileSync("git", ["show", `${baseline}:${path}`]) : await readFile(path)])));
const sources = paths.map(path => { const bytes = sourceBytes.get(path)!; return { path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }; });
const fixture = await launchVerificationServer();
let preview: Awaited<ReturnType<typeof mountPreview>> | undefined;
const record = { stage, source: stage === "before" ? baseline : execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), sourceSelection: stage === "before" ? "Exact frozen Git blobs at original module IDs" : "Working production source with recorded byte hashes", ownerPid: process.pid, ...fixture.info, sources, frozenLoads: [], closed: false };
try {
  await runControlOmb(["doctor", "--url", fixture.info.url]);
  const sourceCode = await readFile(resolve(".omb-scratch/flat-dialogs-031/preview.tsx"), "utf8");
  const code = (await transformWithEsbuild(sourceCode, "origin-flat-dialogs-031.tsx", { loader: "tsx", jsx: "automatic" })).code;
  const probe = createServer();
  await new Promise<void>(resolve => probe.listen(0, "127.0.0.1", resolve));
  const previewPort = (probe.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  if ([5199, 8799, 3210].includes(previewPort)) throw new Error("Protected preview port");
  const virtual = "\0origin-flat-dialogs-031.tsx";
  preview = await mountPreview(fixture, { entry: "/__origin-flat-dialogs-entry.tsx", route: "/__origin-flat-dialogs.html", title: "Origin flat dialog verification", hmr: false, logLevel: "error", plugins: [{ name: "flat-dialogs-031-entry", config: () => ({ server: { port: previewPort, strictPort: true } }), resolveId: id => id === "/__origin-flat-dialogs-entry.tsx" ? virtual : undefined, load: id => id === virtual ? code : undefined }, { name: "flat-dialogs-031-frozen-source", enforce: "pre", load(id) {
    if (stage !== "before" || id.startsWith("\0")) return;
    const file = paths.find(path => resolve(path).toLowerCase() === resolve(id.split("?")[0]!).toLowerCase());
    if (!file) return;
    if (!record.frozenLoads.includes(file)) record.frozenLoads.push(file);
    return sourceBytes.get(file)!.toString("utf8");
  } }] });
  if (Number(new URL(preview.previewUrl).port) !== previewPort) throw new Error("Owned preview port differs");
  record.previewUrl = preview.previewUrl;
  await writeFile(resolve(out, "provenance.json"), JSON.stringify(record, null, 2) + "\n");
  console.log(JSON.stringify({ stage, url: fixture.info.url, serverPid: fixture.info.pid, ownerPid: process.pid, previewUrl: preview.previewUrl }));
  const { check } = await import("./check.mjs");
  await check(preview.previewUrl, out, stage);
} finally {
  await preview?.close(); await fixture.close();
  record.closed = true; record.closedAt = new Date().toISOString();
  await writeFile(resolve(out, "provenance.json"), JSON.stringify(record, null, 2) + "\n");
  console.log(JSON.stringify({ stage, closed: true, ownerPid: process.pid, serverPid: fixture.info.pid, previewUrl: preview?.previewUrl }));
}
