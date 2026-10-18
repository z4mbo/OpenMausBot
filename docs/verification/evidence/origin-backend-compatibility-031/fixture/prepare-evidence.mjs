import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { COMPATIBILITY_COVERAGE, REVIEWED_BACKEND_FILES } from "../backend-phase-031-contract.mjs";

const root = resolve(import.meta.dirname, "../..");
const directory = resolve(root, "docs/verification/evidence/origin-backend-compatibility-031");
const normalize = text => text.replaceAll("\r\n", "\n");
const hash = value => createHash("sha256").update(value).digest("hex");
const read = name => readFileSync(resolve(import.meta.dirname, name), "utf8");
const observations = JSON.parse(read("observations.json"));
const bindings = JSON.parse(read("module-loads.json"));
const rawLog = read("run.log");
assert.match(rawLog, /Tests\s+7 passed \(7\)/);
assert.doesNotMatch(rawLog, /\d+ failed/);
assert.equal(observations.releaseSource, null); assert.equal(observations.listenerClosed, true);
assert.equal(observations.providerCalls, 0); assert.equal(observations.externalRequestsBlocked, 0);
assert.deepEqual(observations.coverage, COMPATIBILITY_COVERAGE);
assert.equal(observations.cases.length, 10); assert.ok(observations.cases.every(item => item.passed));
assert.equal(observations.requests.length, 34); assert.ok(observations.requests.every(item => item.registeredHandlerInvoked));
assert.equal(observations.requests.filter(item => item.outcome === "error").length, 4);
const original = bindings.find(item => item.role === "baseline-client" && item.path === "server/origin-cloud.ts");
const current = bindings.find(item => item.role === "candidate-client" && item.path === "server/origin-cloud.ts");
assert.ok(original && current); assert.notEqual(original.originalModuleId, current.originalModuleId);
assert.notEqual(original.gitBlob, current.gitBlob);
const workerBackend = bindings.filter(item => item.role === "registered-candidate-backend");
assert.equal(workerBackend.length, 26);
const sourceChecks = [];
for (const binding of bindings) {
  const repo = binding.role === "baseline-client" ? "C:/Users/aless/.codex/worktrees/origin-compat-client-030/Origin" : binding.role === "candidate-client" ? "C:/Users/aless/Documents/Origin-bugfix" : root;
  const blob = execFileSync("git", ["rev-parse", `${binding.source}:${binding.path}`], { cwd: repo, encoding: "utf8" }).trim();
  const source = normalize(execFileSync("git", ["show", `${binding.source}:${binding.path}`], { cwd: repo, encoding: "utf8" }));
  assert.equal(blob, binding.gitBlob); assert.equal(hash(source), binding.sha256Lf);
  if (binding.role === "registered-candidate-backend") {
    const integratedBlob = execFileSync("git", ["rev-parse", `${observations.observedCandidateSource}:${binding.path}`], { cwd: "C:/Users/aless/Documents/Origin-bugfix", encoding: "utf8" }).trim();
    assert.equal(integratedBlob, blob);
    sourceChecks.push({ path: binding.path, gitBlob: blob, sha256Lf: binding.sha256Lf });
  }
}
for (const file of REVIEWED_BACKEND_FILES) assert.equal(execFileSync("git", ["rev-parse", `${observations.observedCandidateSource}:${file.path}`], { cwd: root, encoding: "utf8" }).trim(), file.gitBlob);
const legacy = observations.cases.find(item => item.tasksAndLinksByteEqual);
assert.ok(legacy); assert.deepEqual(legacy.before, legacy.after); assert.equal(legacy.beforeSha256, legacy.afterSha256);
assert.equal(legacy.existingTaskCount, 6); assert.equal(legacy.existingIssueLinks, 3); assert.equal(legacy.existingPullRequestLinks, 3);
assert.equal(legacy.checks.length, 12);
assert.deepEqual(Object.fromEntries(["columns", "legacyIdeas", "projects"].map(phase => [phase, observations.migrations.filter(item => item.phase === phase).length])), { columns: 3, legacyIdeas: 3, projects: 2 });
for (const name of ["release-inputs-031.json", "release-delivery-state-031.json", "backend-phase-031.json", "backend-compatibility-031.json"]) assert.equal(existsSync(resolve(root, ".omb-scratch", name)), false);
assert.equal(existsSync(directory), false);
mkdirSync(resolve(directory, "fixture"), { recursive: true });
const write = (file, value) => writeFileSync(resolve(directory, file), normalize(value), { flag: "wx" });
for (const name of ["vitest.config.mts", "setup.ts", "compatibility.test.ts", "prepare-evidence.mjs"]) write(`fixture/${name}`, read(name));
write("observations.json", JSON.stringify(observations, null, 2) + "\n");
write("module-loads.json", JSON.stringify(bindings, null, 2) + "\n");
const log = normalize(rawLog).replace(/\u001b\[[0-9;]*m/g, "").trimEnd() + "\n";
write("checks.log", log);
const report = {
  schemaVersion: 1, status: "isolated-request-contract-verified-unpublished", passed: true,
  verifiedAt: observations.verifiedAt, releaseSource: null,
  baseline: { version: "0.2.10", source: observations.baselineSource, originalCaller: original, transportSdk: "convex1.47.0, matching the baseline lockfile" },
  candidate: { observedIntegrationSource: observations.observedCandidateSource, workerBackendSource: observations.backendRuntime, originalCaller: current, registeredBackendModules: sourceChecks, draftImplementationFiles: REVIEWED_BACKEND_FILES },
  coverage: COMPATIBILITY_COVERAGE,
  checks: { files: 1, passed: 7, failed: 0, caseObservations: 10, protocolRequests: 34, successfulRequests: 30, intentionalRegisteredRejections: 4, sourceModulesBound: bindings.length, sourceRoles: { baselineClient: 90, candidateClient: 93, registeredBackend: 26 }, sourceBlobsIndependentlyRechecked: bindings.length, sourceDigestsIndependentlyRechecked: bindings.length, migrationPages: { columns: 3, legacyIdeas: 3, projects: 2 }, legacyPrivacyObservations: 12, existingTasksPreserved: 6, embeddedGitHubIssueLinksPreserved: 3, pullRequestLinkRowsPreserved: 3 },
  boundary: { protocol: "Actual untouched original server caller and ConvexHttpClient serialize real HTTP requests to a disposable port0 loopback protocol adapter; the adapter dispatches candidate registered Convex queries/mutations and validators with convex-test.", queryResultAndWriteLogic: "The actual registered candidate functions read/write synthetic fixture documents; no cloud response data or task-creation result is emulated.", operatorPhases: "Actual internal registered functions run directly through convex-test; raw cursors remain in memory and only hashes are published.", productionDataUsed: false, actualConvexDeployment: false, fullBaselineReactApp: false, packagedClient: false, actualBrowser: false, localMainPortsTouched: false, providerCalls: 0, externalNetworkRequests: 0, listenerClosed: true, temporaryData: "Worker-owned ignored synthetic data directory; no user home/profile changed." },
  freezeGate: { authorizedReleaseSource: null, required: "Before authorizing the root compatibility summary, compare every candidate-client and registered-backend loaded source blob/digest, plus all nine reviewed Draft implementation files, with the actual final frozen release. Require source-specific successful CI/native/private-draft/site preflight separately. This detail report cannot create release authority." },
  filenames: { detailReport: ".omb-scratch/backend-compatibility-report-031.json", rootAuthoritySummary: ".omb-scratch/backend-compatibility-031.json", summaryReportSha256Meaning: "The root summary hashes the separate detail-report bytes; it never self-hashes." },
  evidence: { observationsSha256Lf: hash(normalize(JSON.stringify(observations, null, 2) + "\n")), moduleBindingsSha256Lf: hash(normalize(JSON.stringify(bindings, null, 2) + "\n")), rawPrivateLogSha256: hash(rawLog), normalizedPublishedLogSha256: hash(log), logSanitization: "ANSI SGR removed, CRLF normalized to LF and trailing blank lines reduced to one newline; the raw ignored log is retained." },
  limitations: ["This proves specified backward-compatible request contracts through registered handler logic. It does not claim a hosted Convex backend, a full baseline React app, a real browser, a packaged desktop app, GitHub mirroring, mail delivery or production acceptance.", "An old caller without an explicit destination is checked after all three repair phases complete. This evidence does not authorize publishing clients before the complete ordered repair, cleanup and mail gates.", "The initial viewer fixture had only workspace membership and was denied at the earlier project-access guard. The final fixture also grants explicit viewer project membership, proves board-read access, then proves the editor guard rejects its write; this was a fixture correction, not an application code change."],
};
const reportText = JSON.stringify(report, null, 2) + "\n";
write("backend-compatibility-report-031.json", reportText);
writeFileSync(resolve(root, ".omb-scratch/backend-compatibility-report-031.json"), reportText, { flag: "wx" });
function filesAt(base, relative = "") { return readdirSync(resolve(base, relative), { withFileTypes: true }).flatMap(item => item.isDirectory() ? filesAt(base, `${relative}${item.name}/`) : [`${relative}${item.name}`]); }
const files = filesAt(directory).sort().map(file => { const bytes = readFileSync(resolve(directory, file)); return { file, bytes: bytes.length, sha256: hash(bytes) }; });
write("manifest.json", JSON.stringify({ schemaVersion: 1, hashFormat: "Raw bytes; all published text is UTF-8 LF", files }, null, 2) + "\n");
console.log(JSON.stringify({ sourceModules: bindings.length, requests: observations.requests.length, testsPassed: 7, releaseSource: null, detailReportSha256: hash(reportText), manifestSha256: hash(readFileSync(resolve(directory, "manifest.json"))), payloads: files.length }));
