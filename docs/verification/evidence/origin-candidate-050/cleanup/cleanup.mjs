import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, writeFileSync, writeSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const OWN = import.meta.dirname;
const INPUTS = resolve(OWN, '..');
const MANIFEST_SHA = '30d8f56ef58c392993d31f4639cc9121bd785ec8c8fc95a7348e1c41b197ed44';
const IMAGE = 'sha256:78a8daf8ce012d91fa9cb6d041c97ede04c5b2c3d42cec140945ab7a7ab9ab52';
const BACKUPS = String.raw`C:\Users\aless\Documents\Origin-bugfix\.omb-scratch\distribution`;
const DIRECTORIES = ['/root/origin-release-staging/0.2.8/downloads', '/root/origin-release-staging/0.2.9/downloads', '/root/origin-release-staging/0.2.12-candidate-032-d09a92021/downloads'];
const SUFFIXES = ['arm64.dmg', 'arm64.dmg.blockmap', 'arm64.zip', 'arm64.zip.blockmap', 'setup.exe', 'setup.exe.blockmap', 'windows-x64.zip', 'x64.dmg', 'x64.dmg.blockmap', 'x64.zip', 'x64.zip.blockmap'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const identity = info => ({ device: String(info.dev), inode: String(info.ino), bytes: Number(info.size), nlink: Number(info.nlink), mode: String(info.mode), mtimeNs: String(info.mtimeNs), ctimeNs: String(info.ctimeNs) });
const present = path => { try { lstatSync(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const writeOnce = (name, value) => writeFileSync(join(OWN, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });

function boundedRegular(path, maximum = 4 * 1024 * 1024) {
  const info = lstatSync(path);
  assert.ok(info.isFile() && !info.isSymbolicLink() && info.size > 0 && info.size <= maximum, 'Regular bounded input required');
  return readFileSync(path);
}

function inputs() {
  const bytes = boundedRegular(join(INPUTS, 'capacity-manifest.json'));
  assert.equal(sha(bytes), MANIFEST_SHA, 'Root-reviewed literal manifest changed');
  const manifest = JSON.parse(bytes);
  assert.equal(manifest.count, 33);
  assert.deepEqual(manifest.candidates.map(row => row.privateDirectory), DIRECTORIES);
  assert.equal(manifest.candidates.length, 3);
  for (const candidate of manifest.candidates) {
    assert.equal(candidate.files.length, 11);
    assert.deepEqual(candidate.files.map(row => row.name).sort(), SUFFIXES.map(suffix => `Origin-${candidate.version}-${suffix}`).sort());
    for (const file of candidate.files) {
      assert.equal(file.privatePath, candidate.privateDirectory + '/' + file.name);
      assert.equal(file.publicCopyPresent, false);
      assert.equal(file.private.nlink, 1);
    }
  }
  const proof = boundedRegular(join(INPUTS, 'capacity-two-copy-proof.json'));
  assert.equal(sha(proof), manifest.evidence.find(row => row.file === 'capacity-two-copy-proof.json').sha256);
  assert.equal(JSON.parse(proof).currentImage, IMAGE);
  return { bytes, manifest, proof };
}

export function plan() {
  const { manifest } = inputs();
  return { mode: 'plan only', manifestSha256: MANIFEST_SHA, count: 33, exactPrivateDirectories: DIRECTORIES, allocatedBytes: manifest.privateAllocatedBytes, expectedImage: IMAGE, retainedBackups: BACKUPS, actual049SitePreserved: '/root/origin-release-staging/0.4.2-cycle049/site', authorized: false, order: ['write-once admitted intent', 'rehash and pin all33 retained local copies while holding descriptors', 'open and rehash all33 exact remote descriptors with O_NOFOLLOW before any unlink', 'verify protected metadata/image/feeds/all-images snapshot and fresh disk', 'recheck exact directory/file identity and SHA before each descriptor-relative unlink', 'stream and fsync per-file intent/outcome locally; stop on drift', 'verify protected closure, local copies and actual remaining free bytes'], exclusions: ['public downloads/aliases', 'all local backups', 'rollback0.2.14', 'private feeds/manifests/checksums/directories', 'all049 site/context', 'all images/build cache/volumes', 'backend/app data/env/logs'], noRecursiveDelete: true, automaticReplayAllowed: false, remoteOrLocalPayloadRemovals: false };
}

function validateAdmission(admission, methods) {
  assert.equal(admission.authorized, true, 'Root has not admitted execution');
  assert.equal(admission.operation, 'private-cache-cleanup-050');
  assert.equal(admission.approvedBy, 'root');
  assert.ok(Number.isFinite(Date.parse(admission.approvedAt)));
  assert.equal(admission.executeOnce, true);
  assert.equal(admission.manifestSha256, MANIFEST_SHA);
  assert.equal(admission.expectedImage, IMAGE);
  assert.deepEqual(admission.exactPrivateDirectories, DIRECTORIES);
  assert.equal(admission.payloadCount, 33);
  assert.equal(admission.operatorSha256, methods.operatorSha256);
  assert.equal(admission.remoteMethodSha256, methods.remoteMethodSha256);
}

function directoryTree(path) {
  let current = resolve(path);
  assert.equal(realpathSync(current).toLowerCase(), current.toLowerCase(), 'Local backup path is redirected');
  for (;;) {
    const info = lstatSync(current);
    assert.ok(info.isDirectory() && !info.isSymbolicLink(), 'Local backup directory symlink refused');
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

async function verifyLocal(manifest, held, event) {
  const result = [];
  for (const candidate of manifest.candidates) {
    const folder = candidate.privateDirectory.split('/').at(-2);
    const directory = resolve(BACKUPS, folder);
    assert.equal(directory.toLowerCase(), resolve(candidate.localBackupRoot).toLowerCase());
    assert.ok(!relative(BACKUPS, directory).startsWith('..'));
    directoryTree(directory);
    const releaseManifest = boundedRegular(join(directory, `release-manifest-${candidate.version}.json`));
    assert.equal(sha(releaseManifest), candidate.localManifestSha256);
    for (const file of candidate.files) {
      const path = resolve(directory, file.name);
      assert.equal(dirname(path), directory);
      assert.equal(relative(resolve(BACKUPS, '..', '..'), path).split('\\').join('/'), file.localBackup);
      const before = lstatSync(path, { bigint: true });
      assert.ok(before.isFile() && !before.isSymbolicLink() && before.nlink === 1n);
      assert.deepEqual(identity(before), file.localIdentity, 'Retained local file identity changed');
      const handle = await open(path, constants.O_RDONLY);
      held.push({ handle, path, expected: file.localIdentity });
      assert.deepEqual(identity(await handle.stat({ bigint: true })), file.localIdentity);
      const hash = createHash('sha256');
      for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
      assert.equal(hash.digest('hex'), file.sha256, 'Retained local SHA256 changed');
      assert.deepEqual(identity(await handle.stat({ bigint: true })), file.localIdentity);
      assert.deepEqual(identity(lstatSync(path, { bigint: true })), file.localIdentity);
      result.push({ path, bytes: file.bytes, sha256: file.sha256, identity: file.localIdentity });
      event({ phase: 'local-verified', name: file.name, sha256: file.sha256 });
    }
  }
  assert.equal(result.length, 33);
  return result;
}

export async function execute(admissionPath) {
  const selected = inputs();
  const remote = boundedRegular(join(OWN, 'remote-cleanup.py'));
  const methods = { operatorSha256: sha(boundedRegular(import.meta.filename)), remoteMethodSha256: sha(remote) };
  const admissionBytes = boundedRegular(resolve(admissionPath));
  const admission = JSON.parse(admissionBytes);
  validateAdmission(admission, methods);
  for (const name of ['intent.json', 'events.jsonl', 'execution.json', 'transport.stderr.log']) assert.equal(present(join(OWN, name)), false, 'Prior attempt requires reconciliation; automatic replay refused');
  const nonce = randomUUID(), startedAt = new Date().toISOString();
  writeOnce('intent.json', { operation: admission.operation, nonce, startedAt, admissionSha256: sha(admissionBytes), manifestSha256: MANIFEST_SHA, ...methods, count: 33, directories: DIRECTORIES, unknownOutcomeRequiresReconciliation: true });
  const journal = openSync(join(OWN, 'events.jsonl'), 'wx');
  const held = [], events = [];
  const event = value => { const entry = { observedAt: new Date().toISOString(), ...value }; writeSync(journal, JSON.stringify(entry) + '\n'); fsyncSync(journal); events.push(entry); if (['preflight-complete', 'unlinked', 'complete', 'stopped'].includes(value.phase)) console.log(JSON.stringify(value)); };
  let outcome = { exitCode: null, signal: null, error: null }, localStable = false, stderr = '';
  try {
    const local = await verifyLocal(selected.manifest, held, event);
    const localBytes = Buffer.from(JSON.stringify(local));
    writeOnce('retained-local-verification.json', { nonce, completedAt: new Date().toISOString(), count: local.length, sha256: sha(localBytes), files: local });
    const request = { execute: true, approvedBy: 'root', nonce, manifestSha256: MANIFEST_SHA, manifestBase64: selected.bytes.toString('base64'), proofBase64: selected.proof.toString('base64'), expectedImage: IMAGE, localBackupsSha256: sha(localBytes) };
    const program = 'import json\nREQUEST=json.loads(' + JSON.stringify(JSON.stringify(request)) + ')\n' + remote.toString();
    const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'HOME', 'SYSTEMDRIVE', 'PROGRAMDATA', 'ProgramFiles', 'ProgramFiles(x86)', 'HOMEDRIVE', 'HOMEPATH', 'USERNAME', 'USERDOMAIN'].filter(name => process.env[name] !== undefined).map(name => [name, process.env[name]]));
    outcome = await new Promise(resolveOutcome => {
      const child = spawn('ssh', ['-T', '-o', 'BatchMode=yes', '-o', 'ControlMaster=no', '-o', 'ControlPath=none', '-o', 'ForwardAgent=no', 'hetzner', 'python3 -'], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      let pending = '', bytes = 0, failure;
      const timer = setTimeout(() => { failure = 'SSH outcome timed out; reconcile exact files without replay'; child.kill(); }, 30 * 60_000);
      child.on('error', error => { failure = error.message; });
      child.stdin.on('error', error => { failure = error.message; });
      child.stderr.on('data', chunk => { stderr += chunk.toString(); if (stderr.length > 65536) { failure = 'SSH stderr exceeded'; child.kill(); } });
      child.stdout.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 4 * 1024 * 1024) { failure = 'SSH event stream exceeded'; child.kill(); return; }
        pending += chunk.toString();
        for (;;) {
          const end = pending.indexOf('\n');
          if (end < 0) break;
          const line = pending.slice(0, end); pending = pending.slice(end + 1);
          try { const value = JSON.parse(line); assert.equal(typeof value.phase, 'string'); event(value); }
          catch { failure = 'SSH event stream is unconfirmed; reconcile without replay'; child.kill(); }
        }
      });
      child.on('close', (code, signal) => { clearTimeout(timer); if (pending.trim()) failure = 'Incomplete SSH event; reconcile without replay'; resolveOutcome({ exitCode: code, signal, error: failure ?? null }); });
      child.stdin.end(program);
    });
    for (const value of held) {
      assert.deepEqual(identity(await value.handle.stat({ bigint: true })), value.expected, 'Retained local descriptor changed during cleanup');
      assert.deepEqual(identity(lstatSync(value.path, { bigint: true })), value.expected, 'Retained local path changed during cleanup');
    }
    localStable = true;
  } catch (error) {
    outcome.error = error.message;
    event({ phase: 'local-stopped', reason: error.message, reconciliationRequired: true });
  } finally {
    for (const value of held) {
      try { await value.handle.close(); }
      catch (error) { outcome.error = error.message; }
    }
    closeSync(journal);
    writeFileSync(join(OWN, 'transport.stderr.log'), stderr, { flag: 'wx' });
    const completed = events.findLast(value => value.phase === 'complete');
    const confirmed = events.filter(value => value.phase === 'unlinked');
    const expectedPaths = selected.manifest.candidates.flatMap(candidate => candidate.files.map(file => file.privatePath)).sort();
    const exactOutcomes = JSON.stringify(confirmed.map(value => value.path).sort()) === JSON.stringify(expectedPaths) && JSON.stringify(completed?.deleted?.toSorted()) === JSON.stringify(expectedPaths);
    const success = outcome.exitCode === 0 && !outcome.error && completed?.count === 33 && exactOutcomes && localStable;
    writeOnce('execution.json', { operation: admission.operation, nonce, startedAt, completedAt: new Date().toISOString(), status: success ? 'complete' : 'partial-or-unknown-reconciliation-required', outcome, confirmedUnlinked: confirmed.map(value => value.path), completedRemoteReceipt: completed ?? null, retainedLocalCopiesStable: localStable, manifestSha256: MANIFEST_SHA, ...methods, eventsSha256: sha(readFileSync(join(OWN, 'events.jsonl'))), automaticReplayAllowed: false });
    assert.ok(success, 'Cleanup is partial or unknown; retained intent/events require exact reconciliation, no retry');
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (!args.length || args.length === 1 && args[0] === '--plan') console.log(JSON.stringify(plan(), null, 2));
  else { assert.ok(args.length === 2 && args[0] === '--execute', 'Use --plan or --execute reviewed-admission.json'); await execute(args[1]); }
}
