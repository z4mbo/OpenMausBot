import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, cp, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepare, targetSpec } from '../apps/desktop/scripts/prepare.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const desktop = path.join(root, 'apps/desktop');
const config = JSON.parse(await readFile(path.join(desktop, 'src-tauri/tauri.conf.json')));
const triple = process.env.ORIGIN_DESKTOP_TARGET || execFileSync('rustc', ['-vV'], { encoding: 'utf8' }).match(/host: (.+)/)[1].trim();
const spec = targetSpec(triple);
const version = config.version;
const tag = process.env.GITHUB_REF_NAME || `desktop-v${version}`;
if (tag !== `desktop-v${version}` || !/^desktop-v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag)) throw new Error('Desktop tag must match tauri.conf.json version');
const packageVersion = JSON.parse(await readFile(path.join(desktop, 'package.json'))).version;
const cargoVersion = (await readFile(path.join(desktop, 'src-tauri/Cargo.toml'), 'utf8')).match(/^version = "(.+)"/m)?.[1];
if (packageVersion !== version || cargoVersion !== version) throw new Error('Desktop package, Cargo and Tauri versions must match');
if (!process.env.ORIGIN_AGENT_HOST_DIR) throw new Error('Release builds require the real ORIGIN_AGENT_HOST_DIR');
const signed = Boolean(process.env.TAURI_SIGNING_PRIVATE_KEY);
if (signed && !config.plugins.updater.pubkey.trim()) throw new Error('Commit the updater public key before signing a release');
const signingEnvironment = { ...process.env };
// Empty/partial Apple credentials should not turn the unsigned path into a failed import/notarization.
if (!signingEnvironment.APPLE_CERTIFICATE || !signingEnvironment.APPLE_SIGNING_IDENTITY) {
  for (const name of ['APPLE_CERTIFICATE', 'APPLE_CERTIFICATE_PASSWORD', 'APPLE_SIGNING_IDENTITY']) delete signingEnvironment[name];
}
if (!signingEnvironment.APPLE_CERTIFICATE || !signingEnvironment.APPLE_ID || !signingEnvironment.APPLE_PASSWORD || !signingEnvironment.APPLE_TEAM_ID) {
  for (const name of ['APPLE_ID', 'APPLE_PASSWORD', 'APPLE_TEAM_ID']) delete signingEnvironment[name];
}
if (!signed) {
  delete signingEnvironment.TAURI_SIGNING_PRIVATE_KEY;
  delete signingEnvironment.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;
}
process.env.ORIGIN_DESKTOP_TARGET = triple;
await prepare();
const override = { bundle: { createUpdaterArtifacts: signed } };
if (process.platform === 'darwin') {
  override.bundle.macOS = { entitlements: 'Entitlements.plist', minimumSystemVersion: '13.5' };
  // Apple Silicon requires ad-hoc signatures even for a non-distribution build.
  if (!signingEnvironment.APPLE_SIGNING_IDENTITY) override.bundle.macOS.signingIdentity = '-';
}
if (process.env.ORIGIN_WINDOWS_CERTIFICATE_THUMBPRINT) {
  override.bundle.windows = { certificateThumbprint: process.env.ORIGIN_WINDOWS_CERTIFICATE_THUMBPRINT, digestAlgorithm: 'sha256', timestampUrl: 'http://timestamp.digicert.com' };
}
const generated = path.join(desktop, 'src-tauri/tauri.release.generated.json');
await writeFile(generated, JSON.stringify(override));
const bundles = process.platform === 'win32' ? 'nsis' : process.platform === 'darwin' ? 'app,dmg' : 'appimage,deb';
const args = ['build', '--ci', '--target', triple, '--bundles', bundles, '--config', generated];
if (process.platform === 'darwin') args.push('--config', path.join(desktop, 'src-tauri/tauri.macos.conf.json'));
// Always use the locked local CLI; npm's frontend hook runs from the desktop cwd.
execFileSync(process.execPath, [path.join(desktop, 'node_modules/@tauri-apps/cli/tauri.js'), ...args], { cwd: desktop, env: signingEnvironment, stdio: 'inherit' });
const bundleRoot = path.join(desktop, 'src-tauri/target', triple, 'release/bundle');
const os = process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'windows' : 'linux';
const arch = spec.arch === 'x64' ? 'x86_64' : 'aarch64';
const platform = `${os}-${arch}`;
const output = path.join(root, 'artifacts/desktop', platform);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const formats = os === 'windows' ? [['nsis', '.exe']] : os === 'darwin' ? [['dmg', '.dmg'], ...(signed ? [['macos', '.app.tar.gz']] : [])] : [['appimage', '.AppImage'], ['deb', '.deb']];
const platforms = {};
for (const [directory, extension] of formats) {
  const files = (await readdir(path.join(bundleRoot, directory))).filter(name => name.endsWith(extension));
  if (files.length !== 1) throw new Error(`Expected exactly one ${extension} in ${directory}, found ${files.length}`);
  const source = path.join(bundleRoot, directory, files[0]);
  const filename = `Origin_${version}_${platform}${extension}`;
  await cp(source, path.join(output, filename));
  const updater = os === 'windows' || extension === '.app.tar.gz' || extension === '.AppImage';
  if (signed && updater) {
    const signature = (await readFile(source + '.sig', 'utf8')).trim();
    if (!signature) throw new Error('Updater signature is empty');
    await cp(source + '.sig', path.join(output, filename + '.sig'));
    platforms[platform] = { signature, url: `https://github.com/z4mbo/origin-workspace/releases/download/${tag}/${filename}` };
  }
}
await writeFile(path.join(output, `manifest-${platform}.json`), JSON.stringify({ version, signed, platform, platforms }, null, 2));
console.log(`Desktop artifacts: ${output}; updater signing: ${signed}`);
