import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '../..');
const refs = { fallback: 'fb7b838aab70c1308023e5df27209641fff5e9c1', features: '84b0ccedb30615f2fa0a1c9c0d3fd18da0f730d3' };
const backendRequire = createRequire(join(root, 'backend/package.json'));
const git = args => { const result = spawnSync('git', args, { cwd: root, windowsHide: true, timeout: 60000, maxBuffer: 64 * 1024 * 1024 }); assert.equal(result.status, 0); return result.stdout; };
const canonical = value => JSON.stringify(value && typeof value === 'object' ? Array.isArray(value) ? value.map(item => JSON.parse(canonical(item))) : Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(canonical(value[key]))])) : value);
const digest = value => createHash('sha256').update(value).digest('hex');
function accepts(before, after) {
  if (canonical(before) === canonical(after)) return true;
  if (after?.type === 'union') return before?.type === 'union' ? before.value.every(value => after.value.some(next => accepts(value, next))) : after.value.some(next => accepts(before, next));
  if (before?.type === 'object' && after?.type === 'object') return Object.entries(before.value).every(([name, field]) => after.value[name] && (!field.optional || after.value[name].optional) && accepts(field.fieldType, after.value[name].fieldType)) && Object.entries(after.value).every(([name, field]) => name in before.value || field.optional);
  if (before?.type === 'array' && after?.type === 'array') return accepts(before.value, after.value);
  return false;
}
async function load(name, base) {
  const output = join(import.meta.dirname, `${name}-schema.mjs`);
  await build({ entryPoints: [join(base, 'backend/convex/schema.ts')], outfile: output, bundle: true, platform: 'node', format: 'esm', alias: { 'convex/server': backendRequire.resolve('convex/server'), 'convex/values': backendRequire.resolve('convex/values') }, logLevel: 'silent' });
  return JSON.parse((await import(pathToFileURL(output))).default.export());
}
const schemas = {};
for (const [name, ref] of Object.entries(refs)) {
  const base = join(import.meta.dirname, `parent-${name}`); mkdirSync(base, { recursive: true });
  const unpack = spawnSync('tar', ['-xf', '-'], { cwd: base, input: git(['-c', 'core.autocrlf=false', 'archive', ref, '--', 'backend/convex', 'shared']), windowsHide: true, timeout: 60000 }); assert.equal(unpack.status, 0);
  schemas[name] = await load(name, base);
}
schemas.merged = await load('merged', root);
const modules = text => [...text.matchAll(/^import type \* as (\w+) from /gm)].map(match => match[1]).sort();
const currentApi = readFileSync(join(root, 'backend/convex/_generated/api.d.ts'), 'utf8');
const proof = { passed: true, productionDataUsed: false, generatedAt: new Date().toISOString(), parents: {}, mergedSchemaSha256: digest(canonical(schemas.merged)), mergedSchemaSourceSha256: digest(readFileSync(join(root, 'backend/convex/schema.ts'))), mergedGeneratedApiSha256: digest(currentApi), mergedTables: schemas.merged.tables.length, modelHostFields: ['agentHosts.deviceId', 'agentHosts.credentialHash', 'workspaceAgentRuns.executedByUserId', 'workspaceAgentRuns.modelExecutionId'], requiredMigrationsIntroducedByResolution: [], limits: ['A source-level schema/API union proof; not a Convex push or production acceptance.'] };
for (const [name, ref] of Object.entries(refs)) {
  const prior = schemas[name]; assert.equal(prior.schemaValidation, schemas.merged.schemaValidation);
  for (const table of prior.tables) {
    const after = schemas.merged.tables.find(value => value.tableName === table.tableName); assert.ok(after, `Missing ${name} table ${table.tableName}`); assert.ok(accepts(table.documentType, after.documentType), `Narrowed ${name} validator ${table.tableName}`);
    for (const kind of ['indexes', 'searchIndexes', 'vectorIndexes', 'stagedDbIndexes', 'stagedSearchIndexes', 'stagedVectorIndexes']) for (const index of table[kind] ?? []) assert.ok((after[kind] ?? []).some(value => canonical(value) === canonical(index)), `Missing ${name} index ${table.tableName}.${index.indexDescriptor}`);
  }
  const previousModules = modules(git(['show', `${ref}:backend/convex/_generated/api.d.ts`]).toString());
  for (const module of previousModules) assert.ok(modules(currentApi).includes(module), `Missing ${name} API module ${module}`);
  proof.parents[name] = { source: ref, tables: prior.tables.length, tableValidatorsPreservedOrWidened: true, existingIndexesPreserved: true, apiModules: previousModules.length, apiModulesPreserved: true };
}
assert.ok(accepts({ type: 'object', value: { a: { fieldType: { type: 'string' }, optional: false } } }, { type: 'object', value: { a: { fieldType: { type: 'string' }, optional: false }, b: { fieldType: { type: 'string' }, optional: true } } }));
assert.ok(!accepts({ type: 'object', value: { a: { fieldType: { type: 'string' }, optional: true } } }, { type: 'object', value: { a: { fieldType: { type: 'string' }, optional: false } } }));
assert.ok(!accepts({ type: 'union', value: [{ type: 'literal', value: 'a' }, { type: 'literal', value: 'b' }] }, { type: 'union', value: [{ type: 'literal', value: 'a' }] }));
writeFileSync(join(import.meta.dirname, 'merge-schema-proof.json'), JSON.stringify(proof, null, 2) + '\n'); console.log(JSON.stringify(proof));
