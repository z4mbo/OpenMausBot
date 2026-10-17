import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const directory = path.resolve(process.argv[2] || 'artifacts/desktop-release');
const files = await readdir(directory);
const fragments = await Promise.all(files.filter(file => /^manifest-.+\.json$/.test(file)).map(async file => JSON.parse(await readFile(path.join(directory, file)))));
const expected = ['darwin-aarch64', 'darwin-x86_64', 'linux-x86_64', 'windows-x86_64'];
if (fragments.length !== expected.length || expected.some(platform => fragments.filter(f => f.platform === platform).length !== 1)) throw new Error('Missing or duplicate release platform');
if (new Set(fragments.map(f => `${f.version}:${f.signed}`)).size !== 1) throw new Error('Mixed release versions/signing modes');
const { version, signed } = fragments[0];
const platforms = Object.assign({}, ...fragments.map(f => f.platforms));
if (signed && expected.some(platform => !platforms[platform]?.signature)) throw new Error('Incomplete signed updater manifest');
for (const entry of Object.values(platforms)) {
  const filename = path.basename(new URL(entry.url).pathname);
  if (!files.includes(filename)) throw new Error(`Updater asset missing: ${filename}`);
  if ((await readFile(path.join(directory, filename + '.sig'), 'utf8')).trim() !== entry.signature) throw new Error('Signature does not match uploaded sidecar');
}
const manifest = { version, notes: signed ? `Origin Desktop ${version}` : 'Unsigned installers; automatic updates are unavailable for this build.', pub_date: new Date().toISOString(), platforms };
await writeFile(path.join(directory, 'latest.json'), JSON.stringify(manifest, null, 2) + '\n');
const assets = [...files.filter(file => !file.startsWith('manifest-') && file !== 'latest.json' && file !== 'SHA256SUMS'), 'latest.json'].sort();
await writeFile(path.join(directory, 'SHA256SUMS'), (await Promise.all(assets.map(async file => `${createHash('sha256').update(await readFile(path.join(directory, file))).digest('hex')}  ${file}`))).join('\n') + '\n');
console.log(`Manifest assembled: ${version}, ${signed ? 'signed for all four platforms' : 'updater disabled'}, ${assets.length} assets`);
