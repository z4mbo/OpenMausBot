import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { transformWithEsbuild } from 'vite';
import { mountPreview, parkUntilSignal } from '../../../scripts/testing/preview-fixture.ts';
import { statusResponse } from './status-responses.mjs';

const own = import.meta.dirname;
const root = resolve(own, '../../..');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const args = process.argv.slice(2);
const expected = args[args.indexOf('--expected-head') + 1];
const runId = args[args.indexOf('--run-id') + 1];
if (!args.includes('--expected-head') || !args.includes('--run-id')) {
  console.log(JSON.stringify({ mode: 'plan only; no listeners started', required: '--expected-head FULL_COMMIT --run-id SAFE_UNIQUE_NAME', route: '/__origin048.html', rootOwnsBrowser: true, launches: 'One synthetic read-only status listener and documented mountPreview Vite listener, both free loopback ports', noProductServer: true, noBackendOrProvider: true, protectedPorts: [3210, 3211, 5199, 8799] }, null, 2));
} else {
  assert.equal(process.version, 'v24.21.0');
  assert.match(expected, /^[a-f0-9]{40}$/);
  assert.match(runId, /^[a-z0-9][a-z0-9-]{0,40}$/);
  assert.equal(git(['rev-parse', 'HEAD']), expected, 'Expected final source differs');
  assert.equal(git(['status', '--porcelain', '--untracked-files=no']), '', 'Launch only after the integration source is final and clean');
  assert.equal(git(['ls-files', '-u']), '', 'Unresolved index entries remain');
  const run = join(own, 'runs', runId);
  assert.ok(!existsSync(run), 'Fresh owned run directory required');
  mkdirSync(run, { recursive: true });
  const names = JSON.parse(readFileSync(join(own, 'binding-paths.json'), 'utf8'));
  const source = { source: expected, capturedAt: new Date().toISOString(), workingTree: false, files: names.map(name => { const bytes = readFileSync(join(root, name)); return { name, bytes: bytes.length, sha256: digest(bytes) }; }), qualification: 'Actual final-source UI with synthetic query/status data; no persistence/provider/native/publication acceptance' };
  writeFileSync(join(run, 'source.json'), JSON.stringify(source, null, 2) + '\n', { flag: 'wx' });
  const calls = [];
  const api = createHttpServer((req, res) => {
    const path = (req.url ?? '').split('?')[0];
    if (calls.length < 1000) calls.push({ method: req.method, path });
    writeFileSync(join(run, 'http-calls-live.json'), JSON.stringify({ bounded: true, limit: 1000, calls }, null, 2) + '\n');
    const allowed = req.method === 'GET' || req.method === 'HEAD';
    const data = allowed ? statusResponse(path) : undefined;
    res.writeHead(data === undefined ? 405 : 200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(data ?? { error: 'The isolated preview blocks this operation; nothing was saved, sent or published.' }));
  });
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  const apiPort = api.address().port;
  assert.ok(![3210, 3211, 5199, 8799].includes(apiPort));
  const files = { '/__origin048.tsx': 'preview.tsx', '/__core048.tsx': 'core-preview.tsx', '/__cloud048.ts': 'cloud.ts', '/__data048.mjs': 'data.mjs', '/__chiefdata048.ts': 'chief-data.ts', '/__guard048.mjs': 'guard.mjs', '/__pipeline048.mjs': 'pipeline-api.mjs' };
  const plugin = {
    name: 'origin048-reviewed-fixture-adapter', enforce: 'pre',
    config() { return { optimizeDeps: { entries: ['src/components/ChatView.tsx', 'src/components/ModelHostingSettings.tsx', 'src/components/origin-broadcast/BroadcastPage.tsx', 'src/components/origin-pipeline/PipelinePage.tsx', 'src/components/OriginDraw.tsx', 'src/components/origin-org/OrgPage.tsx'], include: ['react', 'react-dom/client', 'react-markdown'] } }; },
    resolveId(id, importer) {
      if (files[id]) return '\0' + id;
      if (id === './pipeline-api' && importer?.replaceAll('\\', '/').includes('/src/components/origin-pipeline/')) return '\0/__pipeline048.mjs';
    },
    async load(id) {
      const name = files[id.slice(1)];
      if (!id.startsWith('\0') || !name) return;
      const code = readFileSync(join(own, name), 'utf8');
      return /\.tsx?$/.test(name) ? (await transformWithEsbuild(code, name, { loader: name.endsWith('.tsx') ? 'tsx' : 'ts', jsx: 'automatic' })).code : code;
    },
    transform(code, id) {
      if (id.includes('/src/')) return code.replace(/from\s+(["'])@\/lib\/origin-cloud\1/g, 'from "/__cloud048.ts"');
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if ((req.url ?? '').split('?')[0] === '/__origin048.html') res.setHeader('Content-Security-Policy', "connect-src 'self'; img-src 'self' data: blob:; media-src 'self' data: blob:; frame-src 'none'; form-action 'none'");
        next();
      });
    },
  };
  let preview;
  try {
    preview = await mountPreview({ info: { url: `http://127.0.0.1:${apiPort}`, dataDir: run } }, { entry: '/__origin048.tsx', route: '/__origin048.html', title: 'Origin isolated merged UI', hmr: false, cacheDir: join(run, 'vite-cache'), plugins: [plugin] });
    const url = new URL(preview.previewUrl);
    assert.equal(url.hostname, '127.0.0.1');
    assert.ok(![3210, 3211, 5199, 8799].includes(Number(url.port)));
    const info = { pid: process.pid, apiPort, url: preview.previewUrl, runId, source: expected, sourceManifestSha256: digest(readFileSync(join(run, 'source.json'))), rootOwnsBrowser: true, noProductServer: true };
    writeFileSync(join(run, 'fixture.json'), JSON.stringify(info, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify(info));
    await parkUntilSignal();
  } finally {
    writeFileSync(join(run, 'http-calls.json'), JSON.stringify(calls, null, 2) + '\n', { flag: 'wx' });
    await preview?.close();
    await new Promise(resolve => api.close(resolve));
  }
}
