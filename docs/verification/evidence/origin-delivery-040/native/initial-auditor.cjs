const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const { stripTypeScriptTypes } = require('node:module');

const configPath = path.resolve(process.argv[2] || 'MISSING-040-INPUT.json');
const inputBytes = fs.readFileSync(configPath);
const input = JSON.parse(inputBytes);
const repo = path.resolve(input.repo);
const scratch = path.join(repo, '.omb-scratch');
const output = path.resolve(input.outputDir);
const hash = (data, algorithm = 'sha256') => crypto.createHash(algorithm).update(data).digest('hex');
const normalize = data => Buffer.from(data.toString('utf8').replace(/\r\n/g, '\n'));
assert.match(input.frozenSource, /^[0-9a-f]{40}$/);
assert.match(input.version, /^\d+\.\d+\.\d+$/);
assert(Number.isSafeInteger(input.nativeRun) && input.nativeRun > 0);
function owned(location) {
  const absolute = path.resolve(location);
  assert(absolute.startsWith(scratch + path.sep), 'Audit writes must stay below the supplied repository scratch directory');
  let at = absolute;
  while (at !== path.dirname(at)) {
    if (fs.existsSync(at)) assert(!fs.lstatSync(at).isSymbolicLink(), `Symbolic audit path: ${at}`);
    if (at === scratch) break;
    at = path.dirname(at);
  }
  return absolute;
}
owned(output);
fs.mkdirSync(output, { recursive: true });
const write = (name, data) => fs.writeFileSync(owned(path.join(output, name)), JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
const source = file => cp.execFileSync('git', ['show', `${input.frozenSource}:${file}`], { cwd: repo, maxBuffer: 30_000_000 });
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const ts = require(path.join(repo, 'node_modules/typescript'));
const asar = require(path.join(repo, 'node_modules/.pnpm/@electron+asar@3.4.1/node_modules/@electron/asar/lib/asar.js'));
const plist = require(path.join(repo, 'node_modules/.pnpm/plist@3.1.0/node_modules/plist'));
const yaml = require(path.join(repo, 'node_modules/.pnpm/yaml@2.9.0/node_modules/yaml'));
const parse = (text, file = 'bundle.js') => {
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.ES2023, true, ts.ScriptKind.JS);
  assert.equal(ast.parseDiagnostics.length, 0, `${file}: JS parse failure`);
  return ast;
};
const walk = (node, match) => {
  const result = [];
  const visit = item => { if (match(item)) result.push(item); ts.forEachChild(item, visit); };
  visit(node);
  return result;
};
const declarations = ast => {
  const functions = new Map(), variables = new Map();
  for (const node of ast.statements) {
    if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node);
    if (ts.isVariableStatement(node)) for (const item of node.declarationList.declarations) if (ts.isIdentifier(item.name)) variables.set(item.name.text, item);
  }
  return { functions, variables };
};
const usageSource = source('server/plan-usage.ts');
const configSource = source('server/config.ts');
const expectedUsage = declarations(parse(stripTypeScriptTypes(usageSource.toString('utf8'))));
const expectedConfig = declarations(parse(stripTypeScriptTypes(configSource.toString('utf8'))));
const externalNames = new Set([...expectedUsage.functions.keys(), ...expectedUsage.variables.keys(), 'claudeInstanceOwnsRouting', 'CLAUDE_ROUTING_ENV']);
const originalName = name => {
  if (externalNames.has(name)) return name;
  const match = /^(.*?)(\d+)$/.exec(name);
  return match && externalNames.has(match[1]) ? match[1] : name;
};
function named(map, name) {
  const matches = [...map].filter(([key]) => originalName(key) === name);
  assert.equal(matches.length, 1, `${name}: expected one emitted definition`);
  return matches[0][1];
}
function canonical(node, functionNode = false) {
  const text = functionNode
    ? `${node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword) ? 'async ' : ''}function${node.asteriskToken ? '*' : ''} __auditRoot(${node.parameters.map(parameter => parameter.getText()).join(',')}) ${node.body.getText()}`
    : `const __auditValue = ${node.getText()};`;
  const file = parse(text, 'canonical.js');
  const options = { allowJs: true, noLib: true, noResolve: true, target: ts.ScriptTarget.ES2023 };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = name => name === 'canonical.js' ? file : undefined;
  host.fileExists = name => name === 'canonical.js';
  host.readFile = name => name === 'canonical.js' ? text : undefined;
  const checker = ts.createProgram(['canonical.js'], options, host).getTypeChecker();
  const root = functionNode ? file.statements[0] : file.statements[0].declarationList.declarations[0].initializer;
  const symbols = new Map();
  const local = symbol => symbol?.declarations?.some(declaration => declaration.pos >= root.pos && declaration.end <= root.end);
  const identity = symbol => { if (!symbols.has(symbol)) symbols.set(symbol, symbols.size); return ['Local', symbols.get(symbol)]; };
  const key = name => ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? ['Property', name.text] : tree(name);
  function tree(item) {
    if (ts.isParenthesizedExpression(item)) return tree(item.expression);
    if ((ts.isIdentifier(item) && item.text === 'undefined' && !checker.getSymbolAtLocation(item)?.declarations?.length) || (ts.isVoidExpression(item) && ts.isNumericLiteral(item.expression) && Number(item.expression.text) === 0)) return ['Undefined'];
    if (ts.isMethodDeclaration(item)) { const children = []; ts.forEachChild(item, child => { if (child !== item.name) children.push(tree(child)); }); return ['MethodDeclaration', key(item.name), children]; }
    if (ts.isShorthandPropertyAssignment(item)) { const symbol = checker.getShorthandAssignmentValueSymbol(item); assert(symbol, 'Unbound shorthand'); return ['PropertyAssignment', key(item.name), local(symbol) ? identity(symbol) : ['Global', originalName(item.name.text)], item.objectAssignmentInitializer ? tree(item.objectAssignmentInitializer) : null]; }
    if (ts.isPropertyAssignment(item)) return ['PropertyAssignment', key(item.name), tree(item.initializer), null];
    if (ts.isBindingElement(item)) return ['BindingElement', Boolean(item.dotDotDotToken), ts.isObjectBindingPattern(item.parent) ? key(item.propertyName ?? item.name) : null, tree(item.name), item.initializer ? tree(item.initializer) : null];
    if (ts.isPropertyAccessExpression(item)) return ['PropertyAccessExpression', tree(item.expression), key(item.name), Boolean(item.questionDotToken)];
    if (ts.isIdentifier(item)) { const symbol = checker.getSymbolAtLocation(item); return local(symbol) ? identity(symbol) : ['Global', originalName(item.text)]; }
    if (ts.isStringLiteralLike(item)) return ['String', item.text];
    if (ts.isNumericLiteral(item)) return ['Number', Number(item.text.replaceAll('_', ''))];
    const children = []; ts.forEachChild(item, child => { children.push(tree(child)); });
    return [ts.SyntaxKind[item.kind], ...(ts.isVariableDeclarationList(item) ? [item.flags & (ts.NodeFlags.Const | ts.NodeFlags.Let)] : []), children];
  }
  return hash(JSON.stringify(tree(root)));
}
async function fingerprint(file, algorithm = 'sha256', encoding = 'hex') {
  const stat = fs.lstatSync(file);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0, `Expected a nonempty regular artifact: ${file}`);
  const digest = crypto.createHash(algorithm);
  for await (const bytes of fs.createReadStream(file)) digest.update(bytes);
  return { bytes: stat.size, digest: digest.digest(encoding) };
}
function inspectUsageBundle(bytes, label) {
  const ast = parse(bytes.toString('utf8'), `${label}-server.js`), table = declarations(ast);
  const functions = ['planAccountsFromInstances', 'unavailableUsageCredential', 'usageAccessRefused', 'fetchProvider', 'fetchClaude', 'fetchCodex', 'fetchGrok', 'fetchPlanUsage', 'loadPlanUsage'];
  const verified = functions.map(name => {
    const expected = named(expectedUsage.functions, name), actual = named(table.functions, name);
    const expectedHash = canonical(expected, true), actualHash = canonical(actual, true);
    assert.equal(actualHash, expectedHash, `${label}: ${name} differs from frozen source`);
    return { name, emittedName: actual.name.text, sourceAstSha256: expectedHash, emittedAstSha256: actualHash, line: ast.getLineAndCharacterOfPosition(actual.getStart(ast)).line + 1 };
  });
  const routing = named(table.functions, 'claudeInstanceOwnsRouting');
  assert.equal(canonical(routing, true), canonical(named(expectedConfig.functions, 'claudeInstanceOwnsRouting'), true), `${label}: operational Claude routing differs`);
  const routingReference = [...new Set(walk(routing, node => ts.isIdentifier(node) && originalName(node.text) === 'CLAUDE_ROUTING_ENV').map(node => node.text))];
  assert.equal(routingReference.length, 1);
  assert.equal(canonical(table.variables.get(routingReference[0]).initializer), canonical(expectedConfig.variables.get('CLAUDE_ROUTING_ENV').initializer), `${label}: Claude routing flags differ`);
  const routes = [...table.functions].filter(([name]) => /^createStatusRoutes\d*$/.test(name));
  assert.equal(routes.length, 1, `${label}: status route missing`);
  const calls = walk(routes[0][1], node => ts.isCallExpression(node));
  const usageCalls = calls.filter(call => ts.isIdentifier(call.expression) && originalName(call.expression.text) === 'loadPlanUsage');
  assert.equal(usageCalls.length, 1, `${label}: expected actual usage route call`);
  const accountCalls = walk(usageCalls[0], node => ts.isCallExpression(node) && ts.isIdentifier(node.expression) && originalName(node.expression.text) === 'planAccountsFromInstances');
  assert.equal(accountCalls.length, 1, `${label}: route bypasses account eligibility filter`);
  assert(ts.isObjectLiteralExpression(usageCalls[0].arguments[0]));
  const accountsProperty = usageCalls[0].arguments[0].properties.find(property => ts.isPropertyAssignment(property) && property.name.getText() === 'accounts');
  assert(accountsProperty && accountsProperty.initializer === accountCalls[0], `${label}: filtered accounts are not passed to loadPlanUsage`);
  const mounted = walk(ast, node => ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === routes[0][0]);
  assert.equal(mounted.length, 1, `${label}: status routes are not installed exactly once`);
  return { bundleBytes: bytes.length, bundleSha256: hash(bytes), functions: verified, operationalClaudeRoutingAstMatches: true, actualStatusRouteFilterAndMount: true };
}
function inspectRenderer(appAsar, entries, label) {
  const matches = [];
  for (const entry of entries.filter(entry => /^dist\/.*\.js$/.test(entry))) {
    const bytes = asar.extractFile(appAsar, path.normalize(entry));
    const text = bytes.toString('utf8');
    if (!text.includes('planUsage.availabilitySubtitle')) continue;
    const ast = parse(text, entry);
    const subtitles = walk(ast, node => ts.isCallExpression(node) && node.arguments.some(argument => ts.isStringLiteralLike(argument) && argument.text === 'planUsage.availabilitySubtitle'));
    for (const subtitle of subtitles) {
      assert(ts.isPropertyAssignment(subtitle.parent) && subtitle.parent.name.getText() === 'subtitle', `${label}: usage availability subtitle is not rendered`);
      let component = subtitle.parent;
      while (component && !ts.isFunctionDeclaration(component) && !ts.isFunctionExpression(component) && !ts.isArrowFunction(component)) component = component.parent;
      assert(component?.body, `${label}: actual Usage component missing`);
      const fallbacks = walk(component.body, node => ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.BarBarToken && ts.isPropertyAccessExpression(node.left) && node.left.name.text === 'error' && walk(node.right, part => ts.isStringLiteralLike(part) && part.text === 'planUsage.fetchError').length > 0);
      assert.equal(fallbacks.length, 1, `${label}: missing null-error Usage fallback`);
      let container = fallbacks[0].parent;
      while (container && !ts.isObjectLiteralExpression(container)) container = container.parent;
      const tone = container?.properties.find(property => ts.isPropertyAssignment(property) && property.name.getText() === 'className');
      assert(tone && ts.isStringLiteralLike(tone.initializer) && tone.initializer.text.includes('text-ink-secondary') && !tone.initializer.text.includes('text-danger'), `${label}: quota status still renders as model-auth danger`);
      matches.push({ asset: entry, bytes: bytes.length, sha256: hash(bytes), emittedComponent: component.name?.text ?? '<anonymous>', componentSha256: hash(component.getText()), subtitleRendered: true, neutralErrorFallback: true });
    }
  }
  assert.equal(matches.length, 1, `${label}: expected one actual PlanUsage renderer`);
  return matches[0];
}
async function audit() {
  const run = readJson(input.runJson), jobs = readJson(input.jobsJson), artifacts = readJson(input.artifactsJson);
  assert.equal(run.id, input.nativeRun); assert.equal(run.head_sha, input.frozenSource); assert.equal(run.name, 'Origin desktop');
  assert.equal(run.head_branch, `origin-v${input.version}`); assert.equal(run.status, 'completed'); assert.equal(run.conclusion, 'success');
  for (const name of ['Version and changelog', 'macOS (arm64 + x64)', 'Windows x64']) {
    const found = jobs.jobs.filter(job => job.name === name); assert.equal(found.length, 1); assert.equal(found[0].status, 'completed'); assert.equal(found[0].conclusion, 'success');
  }
  assert.equal(artifacts.total_count, 2); assert.equal(input.artifactArchives.length, 2);
  const outerArchives = [];
  for (const item of input.artifactArchives) {
    const found = artifacts.artifacts.filter(artifact => artifact.name === item.name); assert.equal(found.length, 1);
    const expected = found[0]; assert.equal(expected.expired, false); assert.equal(expected.workflow_run.id, input.nativeRun); assert.equal(expected.workflow_run.head_sha, input.frozenSource);
    const actual = await fingerprint(item.path); assert.equal(actual.bytes, expected.size_in_bytes); assert.equal(`sha256:${actual.digest}`, expected.digest);
    outerArchives.push({ name: item.name, path: item.path, artifactId: expected.id, ...actual, matchesApiSizeAndDigest: true });
  }
  const manifestPath = path.join(input.distributionDir, `release-manifest-${input.version}.json`);
  const sumsPath = path.join(input.distributionDir, `SHA256SUMS-${input.version}.txt`);
  const manifest = readJson(manifestPath); assert.equal(manifest.version, input.version); assert.equal(manifest.commit, input.frozenSource); assert.equal(manifest.desktopRun, input.nativeRun); assert.equal(manifest.files.length, 13);
  const payloads = [];
  for (const item of manifest.files) {
    assert.equal(path.basename(item.name), item.name);
    const actual = await fingerprint(path.join(input.distributionDir, item.name)); assert.equal(actual.bytes, item.size); assert.equal(actual.digest, item.sha256);
    payloads.push({ name: item.name, bytes: actual.bytes, sha256: actual.digest });
  }
  assert.equal(fs.readFileSync(sumsPath, 'utf8'), manifest.files.map(item => `${item.sha256}  ${item.name}`).join('\n') + '\n');
  const frozenPackage = JSON.parse(source('package.json')); assert.equal(frozenPackage.version, input.version);
  const releaseAst = parse(stripTypeScriptTypes(source('shared/origin-releases.ts').toString('utf8')));
  assert(releaseAst.statements.every(statement => ts.isVariableStatement(statement)), 'Unexpected executable release notes module');
  const releasesModule = await import(`data:text/javascript;base64,${Buffer.from(releaseAst.text).toString('base64')}`);
  const release = releasesModule.releases[0]; assert.equal(release.version, input.version);
  const notes = `# Origin ${release.version}: ${release.title}\n\n${release.date}\n\n${release.changes.map(change => `## ${change.title}\n\n${change.body}`).join('\n\n')}\n`;
  const feeds = [];
  for (const entry of input.feeds) {
    const feed = yaml.parse(fs.readFileSync(entry.path, 'utf8')); assert.equal(feed.version, input.version); assert.equal(feed.releaseNotes, notes);
    const expected = entry.label === 'mac' ? ['arm64.zip', 'x64.zip', 'arm64.dmg', 'x64.dmg'].map(suffix => `Origin-${input.version}-${suffix}`) : [`Origin-${input.version}-setup.exe`];
    assert.deepEqual(feed.files.map(file => file.url).sort(), expected.sort());
    for (const file of feed.files) { const actual = await fingerprint(path.join(input.distributionDir, file.url), 'sha512', 'base64'); assert.equal(actual.bytes, file.size); assert.equal(actual.digest, file.sha512); }
    assert.equal(feed.path, feed.files[0].url); assert.equal(feed.sha512, feed.files[0].sha512);
    feeds.push({ label: entry.label, path: entry.path, sha256: hash(fs.readFileSync(entry.path)), version: feed.version, files: feed.files, canonicalNotesMatch: true });
  }
  const builder = yaml.parse(source('electron-builder.yml').toString('utf8'));
  assert(builder.files.includes('electron/**') && builder.files.includes('!electron/**/*.test.*'), 'Reviewed Electron source selection changed');
  const expectedElectron = cp.execFileSync('git', ['ls-tree', '-r', '--name-only', input.frozenSource, '--', 'electron/'], { cwd: repo, encoding: 'utf8' }).trim().split(/\r?\n/).filter(name => /\.(mjs|cjs)$/.test(name) && !/\.test\./.test(name)).sort();
  const targets = [];
  assert.equal(input.targets.length, 3);
  for (const target of input.targets) {
    const payloadName = target.platform === 'windows' ? `Origin-${input.version}-windows-x64.zip` : `Origin-${input.version}-${target.arch}.zip`;
    const payload = payloads.find(item => item.name === payloadName); assert(payload);
    const archive = await fingerprint(target.archive); assert.equal(archive.bytes, payload.bytes); assert.equal(archive.digest, payload.sha256);
    const extracted = owned(target.extractedTo);
    const extraction = readJson(path.join(extracted, 'archive-manifest.json'));
    assert.equal(path.resolve(extraction.archive), path.resolve(target.archive)); assert.equal(extraction.archiveBytes, archive.bytes);
    for (const entry of extraction.entries.filter(entry => entry.selected && entry.sha256)) {
      const actual = await fingerprint(owned(path.join(extracted, entry.name))); assert.equal(actual.bytes, entry.bytes); assert.equal(actual.digest, entry.sha256);
    }
    const resources = target.platform === 'mac' ? path.join(extracted, 'Origin.app/Contents/Resources') : path.join(extracted, target.resourceRelative || 'resources');
    const appAsar = path.join(resources, 'app.asar');
    const entries = asar.listPackage(appAsar).map(entry => entry.replace(/^[/\\]+/, '').replace(/\\/g, '/'));
    const pkg = JSON.parse(asar.extractFile(appAsar, 'package.json').toString('utf8')); assert.equal(pkg.name, 'origin'); assert.equal(pkg.version, input.version); assert.equal(pkg.author.name, 'Origin');
    const updater = yaml.parse(fs.readFileSync(path.join(resources, 'app-update.yml'), 'utf8')); assert.equal(updater.provider, 'generic'); assert.equal(updater.url, 'https://origin.imbored.fun/downloads/');
    assert.deepEqual(normalize(asar.extractFile(appAsar, 'shared/product-brand.mjs')), normalize(source('shared/product-brand.mjs')));
    const electronFiles = entries.filter(entry => /^electron\/.+\.(mjs|cjs)$/.test(entry)).sort(); assert.deepEqual(electronFiles, expectedElectron);
    const compared = electronFiles.map(file => { const actual = asar.extractFile(appAsar, path.normalize(file)), expected = source(file); assert.deepEqual(normalize(actual), normalize(expected), `${target.label}: ${file} differs`); return { path: file, bytes: actual.length, sha256: hash(actual), sourceSha256: hash(expected) }; });
    const bundle = fs.readFileSync(path.join(resources, 'server/index.js'));
    const result = { label: target.label, platform: target.platform, arch: target.arch, archive: { path: target.archive, ...archive }, resources, asarSha256: hash(fs.readFileSync(appAsar)), package: { name: pkg.name, version: pkg.version, author: pkg.author, main: pkg.main }, updater, plainElectronSources: compared, usage: inspectUsageBundle(bundle, target.label), renderer: inspectRenderer(appAsar, entries, target.label) };
    if (target.platform === 'mac') {
      const info = plist.parse(fs.readFileSync(path.join(extracted, 'Origin.app/Contents/Info.plist'), 'utf8'));
      for (const [field, expected] of Object.entries({ CFBundleName: 'Origin', CFBundleDisplayName: 'Origin', CFBundleIdentifier: 'com.imbored.origin', CFBundleExecutable: 'Origin', CFBundleShortVersionString: input.version, CFBundleVersion: input.version })) assert.equal(info[field], expected);
      assert(info.CFBundleURLTypes.some(type => type.CFBundleURLSchemes.includes('origin-app')));
      const executable = fs.readFileSync(path.join(extracted, 'Origin.app/Contents/MacOS/Origin')); assert.equal(executable.readUInt32LE(0), 0xfeedfacf); assert.equal(executable.readUInt32LE(4), target.arch === 'arm64' ? 0x0100000c : 0x01000007);
      assert(fs.readFileSync(path.join(resources, 'server/openmausbot.js'), 'utf8').includes('--check-install'));
      result.mac = { info, executableSha256: hash(executable), machOCpuType: executable.readUInt32LE(4), sentinelLayoutPresent: true };
    }
    targets.push(result);
  }
  const report = { status: 'pass', frozenSource: input.frozenSource, version: input.version, nativeRun: input.nativeRun, createdAt: new Date().toISOString(), inputSha256: hash(inputBytes), helperSha256: hash(fs.readFileSync(__filename)), sourceDigests: ['package.json', 'server/plan-usage.ts', 'server/config.ts', 'server/routes/status.ts', 'src/components/PlanUsage.tsx', 'src/locales/en.json', 'shared/origin-releases.ts'].map(file => ({ path: file, sha256: hash(source(file)) })), manifestSha256: hash(fs.readFileSync(manifestPath)), checksumFileSha256: hash(fs.readFileSync(sumsPath)), outerArchives, payloads, feeds, targets, qualification: 'Static downloaded ZIP, ASAR, source AST/call-site, renderer and update-metadata proof. Windows Node-resource smoke is a separate explicit command. No installed app, native GUI, Mac execution, installer or updater acceptance, real provider quota, credentials or production mutation proved.' };
  write('metadata-results-040.json', report);
  console.log(JSON.stringify({ status: report.status, frozenSource: report.frozenSource, nativeRun: report.nativeRun, targets: targets.length, payloads: payloads.length, usageAstAndCalls: true, renderer: true }));
}
async function smoke() {
  assert.equal(process.platform, 'win32'); assert.equal(process.arch, 'x64');
  const prior = readJson(path.join(output, 'metadata-results-040.json')); assert.equal(prior.status, 'pass'); assert.equal(prior.frozenSource, input.frozenSource); assert.equal(prior.nativeRun, input.nativeRun);
  const windows = prior.targets.find(target => target.platform === 'windows'); assert(windows);
  assert.equal(hash(fs.readFileSync(path.join(windows.resources, 'server/index.js'))), windows.usage.bundleSha256);
  const script = path.join(repo, 'scripts/smoke-packaged-server.mjs'); assert.deepEqual(normalize(fs.readFileSync(script)), normalize(source('scripts/smoke-packaged-server.mjs')));
  const home = owned(path.join(output, 'smoke-own-home')), temp = owned(path.join(output, 'smoke-own-temp'));
  assert(!fs.existsSync(home) && !fs.existsSync(temp), 'Refusing to reuse a previous smoke home');
  for (const dir of [home, temp, path.join(home, 'AppData/Roaming'), path.join(home, 'AppData/Local')]) fs.mkdirSync(dir, { recursive: true });
  const env = { PATH: 'C:\\Windows\\System32', SystemRoot: 'C:\\Windows', WINDIR: 'C:\\Windows', TEMP: temp, TMP: temp, HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData/Roaming'), LOCALAPPDATA: path.join(home, 'AppData/Local'), XDG_CONFIG_HOME: path.join(home, '.config'), XDG_CACHE_HOME: path.join(home, '.cache'), XDG_DATA_HOME: path.join(home, '.local/share'), OMB_DATA_DIR: path.join(home, '.openmausbot'), OMB_SMOKE_DIST: path.join(windows.resources, 'server') };
  const node = path.resolve(input.nodePath); const version = cp.execFileSync(node, ['--version'], { env, encoding: 'utf8' }).trim(); assert.match(version, /^v24\./);
  const args = [script, '--browser-bundle', path.join(windows.resources, 'browser-engine')];
  const record = { frozenSource: input.frozenSource, nativeRun: input.nativeRun, node, version, args, cwd: repo, env, scriptSha256: hash(fs.readFileSync(script)), helperSha256: hash(fs.readFileSync(__filename)), startedAt: new Date().toISOString() };
  const log = fs.openSync(path.join(output, 'packaged-smoke-040.log'), 'wx');
  const child = cp.spawn(node, args, { cwd: repo, env, stdio: ['ignore', log, log], windowsHide: true }); fs.closeSync(log); record.pid = child.pid; write('smoke-command-040.json', record);
  console.log(JSON.stringify({ started: true, pid: child.pid }));
  const result = await new Promise(resolve => { child.once('error', error => resolve({ error: String(error) })); child.once('exit', (code, signal) => resolve({ code, signal })); });
  write('smoke-result-040.json', { ...result, pid: child.pid, finishedAt: new Date().toISOString(), retainedOwnTempEntries: fs.readdirSync(temp), qualification: 'Extracted Windows server/browser resources under Node, fresh whitelisted environment. Child process/listener closure must be independently checked; no installed executable or GUI acceptance.' });
  assert.equal(result.code, 0, 'Isolated packaged-resource smoke failed');
  console.log(JSON.stringify({ ...result, pid: child.pid }));
}
(process.argv.includes('--smoke') ? smoke() : audit()).catch(error => { console.error(error.stack); process.exitCode = 1; });
