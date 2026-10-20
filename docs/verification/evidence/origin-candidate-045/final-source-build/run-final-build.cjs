const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const output = __dirname;
const node = 'C:\\Users\\aless\\Documents\\Origin-bugfix\\.omb-scratch\\runtimes\\node-v24.21.0-win-x64\\node.exe';
const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'origin-final-build-045-'));
const home = path.join(runtimeRoot, 'home');
const temp = path.join(runtimeRoot, 'temp');
fs.mkdirSync(home, { recursive: true });
fs.mkdirSync(temp, { recursive: true });
for (let current = runtimeRoot; ; current = path.dirname(current)) {
  if (fs.existsSync(path.join(current, 'node_modules'))) throw new Error('Smoke temp ancestor exposes node_modules');
  if (path.dirname(current) === current) break;
}
const systemRoot = process.env.SystemRoot || 'C:\\Windows';
const cleanEnv = {
  SystemRoot: systemRoot,
  WINDIR: systemRoot,
  ComSpec: path.join(systemRoot, 'System32', 'cmd.exe'),
  PATH: [path.dirname(node), path.join(systemRoot, 'System32')].join(path.delimiter),
  HOME: home,
  USERPROFILE: home,
  APPDATA: path.join(home, 'AppData', 'Roaming'),
  LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
  XDG_CONFIG_HOME: path.join(home, '.config'),
  XDG_CACHE_HOME: path.join(home, '.cache'),
  XDG_DATA_HOME: path.join(home, '.local', 'share'),
  TEMP: temp,
  TMP: temp,
  NODE_OPTIONS: '--max-old-space-size=8192',
  NO_COLOR: '1',
};
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const head = () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)
  .filter(file => !file.startsWith('docs/') && !file.endsWith('.md') && !['.gitattributes', '.gitignore'].includes(file));
function fingerprint(files) {
  const entries = files.map(file => {
    const absolute = path.join(root, file);
    const bytes = fs.readFileSync(absolute);
    return { path: file.replaceAll('\\', '/'), bytes: bytes.length, sha256: digest(bytes) };
  }).sort((a, b) => a.path.localeCompare(b.path, 'en'));
  return { count: entries.length, sha256: digest(JSON.stringify(entries)), entries };
}
function treeFingerprint(name) {
  const directory = path.join(root, name);
  const files = [];
  function visit(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const absolute = path.join(folder, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) files.push(path.relative(root, absolute));
      else throw new Error(`Unexpected output entry ${absolute}`);
    }
  }
  visit(directory);
  return fingerprint(files);
}
const initial = fingerprint(tracked);
const receipt = {
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  headAtStart: head(),
  packageVersion: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version,
  platform: process.platform,
  architecture: process.arch,
  node: { version: execFileSync(node, ['--version'], { encoding: 'utf8' }).trim(), sha256: digest(fs.readFileSync(node)) },
  source: { count: initial.count, sha256: initial.sha256, manifest: 'input-source.json', excludes: ['docs/**', '**/*.md', '.gitattributes', '.gitignore'], trackedOnly: true },
  isolation: { ownedHome: true, inheritedEnvironment: Object.keys(cleanEnv).sort(), pathEntries: ['portable-node-directory', 'System32'], noEnvironmentFilesExceptExample: true, smokeTempOutsideCheckout: true, noNodeModulesAncestor: true, productionDataUsed: false, protectedPortsTouched: false },
  steps: [],
  limits: ['Build and copied packaged-server Node smoke only; not an installed Electron GUI, real provider, physical macOS, updater or production acceptance.'],
};
fs.writeFileSync(path.join(output, 'input-source.json'), JSON.stringify(initial, null, 2) + '\n');
function sanitize(value) {
  return value.replaceAll(runtimeRoot, '<owned-temporary-root>').replaceAll(runtimeRoot.replaceAll('\\', '/'), '<owned-temporary-root>')
    .replaceAll(root, '<checkout>').replaceAll(root.replaceAll('\\', '/'), '<checkout>')
    .replaceAll(path.dirname(node), '<portable-node-directory>').replaceAll(path.dirname(node).replaceAll('\\', '/'), '<portable-node-directory>');
}
function save() {
  fs.writeFileSync(path.join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
}
async function run(name, args) {
  const before = fingerprint(tracked);
  if (before.sha256 !== initial.sha256) throw new Error(`Input source changed before ${name}`);
  const step = { name, args, startedAt: new Date().toISOString(), sourceBefore: before.sha256, log: `${name}.log` };
  receipt.steps.push(step);
  save();
  console.log(`${name}: started`);
  let combined = '';
  const result = await new Promise((resolve, reject) => {
    const child = spawn(node, args, { cwd: root, env: cleanEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', chunk => { combined += chunk.toString(); });
    child.stderr.on('data', chunk => { combined += chunk.toString(); });
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  const log = sanitize(combined);
  fs.writeFileSync(path.join(output, step.log), log);
  const after = fingerprint(tracked);
  Object.assign(step, { endedAt: new Date().toISOString(), ...result, sourceAfter: after.sha256, sourceUnchanged: after.sha256 === initial.sha256, logBytes: Buffer.byteLength(log), logSha256: digest(log) });
  save();
  console.log(`${name}: exit ${result.code}; source unchanged ${step.sourceUnchanged}; log ${step.log}`);
  if (result.code !== 0) { console.error(log.slice(-6000)); throw new Error(`${name} failed`); }
  if (!step.sourceUnchanged) throw new Error(`Input source changed during ${name}`);
}
(async () => {
  try {
    await run('client-typecheck', ['node_modules/typescript/bin/tsc', '-b']);
    await run('client-vite-build', ['node_modules/vite/bin/vite.js', 'build']);
    const serverOutput = path.resolve(root, 'dist-server');
    if (serverOutput !== path.join(root, 'dist-server') || !serverOutput.startsWith(root + path.sep)) throw new Error('Output cleanup escaped workspace');
    fs.rmSync(serverOutput, { recursive: true, force: true });
    await run('server-typescript-emit', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.server.build.json']);
    await run('server-bundle', ['scripts/bundle-server.mjs']);
    const clientOutputs = treeFingerprint('dist');
    const serverOutputs = treeFingerprint('dist-server');
    fs.writeFileSync(path.join(output, 'client-output.json'), JSON.stringify(clientOutputs, null, 2) + '\n');
    fs.writeFileSync(path.join(output, 'server-output.json'), JSON.stringify(serverOutputs, null, 2) + '\n');
    receipt.outputs = { client: { count: clientOutputs.count, sha256: clientOutputs.sha256, manifest: 'client-output.json' }, server: { count: serverOutputs.count, sha256: serverOutputs.sha256, manifest: 'server-output.json' } };
    save();
    await run('packaged-server-smoke', ['scripts/smoke-packaged-server.mjs']);
    receipt.serverOutputUnchangedAfterSmoke = treeFingerprint('dist-server').sha256 === serverOutputs.sha256;
    receipt.success = receipt.steps.every(step => step.code === 0 && step.sourceUnchanged) && receipt.serverOutputUnchangedAfterSmoke;
  } catch (error) {
    receipt.success = false;
    receipt.error = sanitize(String(error.stack || error));
    console.error(receipt.error);
    process.exitCode = 1;
  } finally {
    receipt.endedAt = new Date().toISOString();
    receipt.headAtEnd = head();
    receipt.sourceUnchanged = fingerprint(tracked).sha256 === initial.sha256;
    save();
    const checkedRuntimeRoot = path.resolve(runtimeRoot);
    if (checkedRuntimeRoot.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(checkedRuntimeRoot).startsWith('origin-final-build-045-')) {
      fs.rmSync(checkedRuntimeRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      receipt.isolation.ownedTemporaryRootRemoved = !fs.existsSync(checkedRuntimeRoot);
      save();
    }
    console.log(`receipt: ${path.join(output, 'receipt.json')}`);
  }
})();
