import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const table = fields => ({ tableName: 'populated', indexes: [], searchIndexes: [], vectorIndexes: [],
  documentType: { type: 'object', value: fields } });
const string = { fieldType: { type: 'string' }, optional: false };
const optional = { ...string, optional: true };

for (const [name, next, code] of [
  ['optional addition passes', [table({ existing: string, added: optional })], 0],
  ['required addition fails', [table({ existing: string, added: string })], 1],
  ['removed field fails', [table({})], 1],
  ['removed table fails', [], 1],
]) test(name, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-test-'));
  try {
    const old = path.join(temp, 'old.json'), after = path.join(temp, 'next.json');
    fs.writeFileSync(old, JSON.stringify({ tables: [table({ existing: string })] }));
    fs.writeFileSync(after, JSON.stringify({ tables: next }));
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./schema-audit.mjs', import.meta.url)), 'compare', old, after], { encoding: 'utf8' });
    assert.equal(result.status, code, result.stderr + result.stdout);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
