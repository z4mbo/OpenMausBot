import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const out = path.join(root, '.omb-scratch/final-checks-048');
fs.mkdirSync(out, { recursive: true });
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const selected = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(file => file && (/^(src|shared|server)\//.test(file) || /^(package\.json|pnpm-lock\.yaml|vite\.config\.ts|tsconfig.*\.json)$/.test(file)));
function fingerprint() {
  const files = selected.map(file => ({ file, sha256: sha256(fs.readFileSync(path.join(root, file))) }));
  return { files: files.length, sha256: sha256(JSON.stringify(files)) };
}
const before = fingerprint();
const receipt = { schema: 1, version: '0.4.1', head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), startedAt: new Date().toISOString(), runtime: { version: process.version, executableSha256: sha256(fs.readFileSync(process.execPath)) }, before, steps: [] };
fs.writeFileSync(path.join(out, 'started.json'), JSON.stringify(receipt, null, 2) + '\n');
function run(name, args) {
  return new Promise(resolve => {
    const log = path.join(out, name + '.log');
    const fd = fs.openSync(log, 'wx');
    const startedAt = new Date().toISOString();
    const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH }, stdio: ['ignore', fd, fd], windowsHide: true });
    child.on('error', error => { throw error; });
    child.on('exit', (exitCode, signal) => {
      fs.closeSync(fd);
      const step = { name, args, startedAt, finishedAt: new Date().toISOString(), exitCode, signal, log: name + '.log', logSha256: sha256(fs.readFileSync(log)) };
      receipt.steps.push(step);
      console.log(JSON.stringify(step));
      resolve(step);
    });
  });
}
const client = run('client-shared', ['node_modules/vitest/vitest.mjs', 'run', 'src', 'shared', '--reporter=dot']);
const other = (async () => {
  for (const [name, args] of [
    ['client-typecheck', ['node_modules/typescript/bin/tsc', '-b']],
    ['server-typecheck', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.server.json']],
    ['lint', ['node_modules/oxlint/bin/oxlint', '--deny-warnings', '.']],
    ['release-check', ['scripts/origin-release-notes.mjs', '--check']],
    ['locale-check', ['scripts/generate-locale.mjs', '--check']],
    ['electron-check', ['scripts/check-electron.mjs']],
    ['guards', ['node_modules/vitest/vitest.mjs', 'run', 'scripts/ci-scope.test.ts', 'scripts/ci-workflow.test.ts', 'scripts/testing/verification-docs.test.ts', 'scripts/testing/file-size-ratchet.test.ts', '--reporter=dot']]
  ]) {
    const result = await run(name, args);
    if (result.exitCode !== 0) break;
  }
})();
await Promise.all([client, other]);
receipt.after = fingerprint();
receipt.sourceUnchanged = JSON.stringify(receipt.before) === JSON.stringify(receipt.after);
receipt.finishedAt = new Date().toISOString();
receipt.passed = receipt.sourceUnchanged && receipt.steps.length === 8 && receipt.steps.every(step => step.exitCode === 0);
fs.writeFileSync(path.join(out, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ passed: receipt.passed, sourceUnchanged: receipt.sourceUnchanged, steps: receipt.steps.length }));
process.exitCode = receipt.passed ? 0 : 1;
