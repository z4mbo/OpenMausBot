import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const own = dirname(fileURLToPath(import.meta.url));
const parentDir = mkdtempSync(join(tmpdir(), 'origin-api-review050-'));
const platformEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => ['SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'LANG', 'LC_ALL', 'TZ'].includes(key.toUpperCase())));
Object.assign(process.env, { OMB_DATA_DIR: parentDir, HOME: parentDir, USERPROFILE: parentDir, APPDATA: join(parentDir, 'AppData/Roaming'), LOCALAPPDATA: join(parentDir, 'AppData/Local') });
const { launchVerificationServer, runControlOmb } = await import('../../scripts/control-omb.ts');
const { removeTempDir } = await import('../../server/testing/cleanup.ts');
const key = 'synthetic-origin-review-api-key';
let fixture;
const receipt = { synthetic: true, productionDataUsed: false, realProviderCalls: false, checks: [], cleanup: null };
try {
  fixture = await launchVerificationServer({ ...platformEnv, FAKE_CLAUDE_MODE: 'echo', FAKE_CLAUDE_AUTH: 'in', OMB_TEST_PORTS: '41870-41920' });
  const url = fixture.info.url;
  receipt.fixture = { url, pid: fixture.info.pid, logPath: fixture.info.logPath };
  assert.equal(new URL(url).protocol, 'http:');
  assert.equal(new URL(url).hostname, '127.0.0.1');
  assert.equal(new URL(url).origin, url);
  assert(![3210, 3211, 5199, 8799].includes(Number(new URL(url).port)));
  const api = async (method, path, body, expected = 200) => {
    const response = await fetch(url + path, { method, headers: { origin: url, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000) });
    const result = await response.json();
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(result)}`);
    assert(!JSON.stringify(result).includes(key), 'Configuration API exposed the selected fixture key');
    return result;
  };
  const fakeCli = fileURLToPath(new URL('../../server/testing/fake-claude-cli.ts', import.meta.url));
  await api('PUT', '/api/config', { anthropic: { key } });
  await api('PATCH', '/api/instances/claudeApi', { cli: fakeCli });
  const fleet = await api('GET', '/api/instances');
  const selected = fleet.instances.find(row => row.instanceId === 'claudeApi');
  const subscription = fleet.instances.find(row => row.instanceId === 'claude');
  receipt.providerSnapshots = [selected, subscription].map(instance => ({ instanceId: instance?.instanceId, snapshot: instance?.snapshot }));
  for (const instance of [selected, subscription]) {
    assert.equal(instance.snapshot.state, 'available', JSON.stringify(instance.snapshot));
    assert.equal(instance.snapshot.authenticated, true);
    assert.equal(instance.snapshot.account.method, 'api-key');
    assert.equal(instance.snapshot.billing, 'metered');
  }
  receipt.checks.push('Both configured API-key routes report API-key authentication and metered billing through HTTP');
  const model = selected.models.default;
  assert.equal(typeof model, 'string');
  const created = await api('POST', '/api/bots', { name: 'Review050 API route', modelSelection: { instanceId: 'claudeApi', model } }, 201);
  const result = await runControlOmb(['run', '--url', url, '--bot', created.bot.id, '--text', 'Synthetic API routing verification', '--wait', 'turn', '--timeout', '30s']);
  assert.equal(result.ok, true);
  assert.equal(result.state, 'completed');
  assert.equal(result.exitCode, 0);
  const dump = JSON.parse(readFileSync(fixture.fixtureDumpPath, 'utf8'));
  assert.equal(dump.env.ANTHROPIC_API_KEY, key);
  receipt.checks.push('Saved API selection reaches the fake CLI through the real HTTP send/wait path');
  receipt.checks.push('Config and provider HTTP responses omit the fixture key');
  receipt.runResult = result;
  receipt.fixture = { url, pid: fixture.info.pid, logPath: fixture.info.logPath };
  receipt.cliDumpSha256 = createHash('sha256').update(readFileSync(fixture.fixtureDumpPath)).digest('hex');
} finally {
  if (fixture) {
    await fixture.close();
    assert.equal(existsSync(fixture.info.dataDir), false);
    receipt.cleanup = { ownedServerExited: fixture.child.exitCode !== null || fixture.child.signalCode !== null, ownedDataRemoved: true };
    assert.equal(receipt.cleanup.ownedServerExited, true);
  }
  assert.equal(dirname(resolve(parentDir)), resolve(tmpdir()));
  assert(basename(parentDir).startsWith('origin-api-review050-'));
  await removeTempDir(parentDir);
  receipt.parentTemporaryHomeRemoved = !existsSync(parentDir);
  writeFileSync(join(own, '3177-live-fixture-attempt3.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
}
console.log(JSON.stringify({ checks: receipt.checks.length, cleanup: receipt.cleanup, parentTemporaryHomeRemoved: receipt.parentTemporaryHomeRemoved, realProviderCalls: false }));
