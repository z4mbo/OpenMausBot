import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const merge = fileURLToPath(new URL('./desktop-manifest.mjs', import.meta.url));
const platforms = ['darwin-aarch64', 'darwin-x86_64', 'linux-x86_64', 'windows-x86_64'];
test('release aggregation accepts complete signatures, rejects partial/mixed releases and handles unsigned builds', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'origin-release-'));
  try {
    const fragment = (platform, signed) => ({ version: '0.1.0', platform, signed, platforms: signed ? { [platform]: { url: `https://github.com/z4mbo/origin-workspace/releases/download/desktop-v0.1.0/${platform}.bundle`, signature: `test-${platform}` } } : {} });
    const put = async (platform, signed) => writeFile(path.join(dir, `manifest-${platform}.json`), JSON.stringify(fragment(platform, signed)));
    const run = () => spawnSync(process.execPath, [merge, dir], { encoding: 'utf8' });
    for (const platform of platforms) {
      await put(platform, true);
      await writeFile(path.join(dir, `${platform}.bundle`), 'synthetic installer');
      await writeFile(path.join(dir, `${platform}.bundle.sig`), `test-${platform}`);
    }
    assert.equal(run().status, 0);
    assert.deepEqual(Object.keys(JSON.parse(await readFile(path.join(dir, 'latest.json'))).platforms).sort(), platforms);
    await writeFile(path.join(dir, 'linux-x86_64.bundle.sig'), 'mismatched');
    assert.match(run().stderr, /Signature does not match/);
    await put('windows-x86_64', false);
    assert.match(run().stderr, /Mixed release/);
    for (const platform of platforms) await put(platform, false);
    assert.equal(run().status, 0);
    assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'latest.json'))).platforms, {});
    await rm(path.join(dir, 'manifest-darwin-aarch64.json'));
    assert.match(run().stderr, /Missing or duplicate/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
