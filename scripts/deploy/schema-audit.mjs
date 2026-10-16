// Local-only schema export/diff. Never deploys or contacts a backend.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const [mode, before, after] = process.argv.slice(2);
if (mode === 'export') {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'origin-schema-'));
  const visited = new Map();
  function compile(file) {
    file = path.resolve(file);
    if (visited.has(file)) return visited.get(file);
    const out = path.join(temp, `${visited.size}.mjs`);
    visited.set(file, out);
    let js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    js = js.replace(/from\s+["']([^"']+)["']/g, (_, spec) => {
      const url = spec.startsWith('.')
        ? pathToFileURL(compile(path.resolve(path.dirname(file), spec + (path.extname(spec) ? '' : '.ts')))).href
        : import.meta.resolve(spec);
      return `from ${JSON.stringify(url)}`;
    });
    fs.writeFileSync(out, js);
    return out;
  }
  try {
    const { default: schema } = await import(pathToFileURL(compile(before)).href);
    process.stdout.write(JSON.stringify(JSON.parse(schema.export()), null, 2) + '\n');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
} else if (mode === 'compare') {
  function load(file) {
    let data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if ('active' in data) {
      if (!data.active) throw new Error('No active production schema; manual review required');
      data = JSON.parse(data.active);
    }
    return data;
  }
  const old = load(before), next = load(after), issues = [], changes = [];
  const stable = value => JSON.stringify(value, (key, val) => val && !Array.isArray(val) && typeof val === 'object'
    ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b))) : val);
  const byName = data => new Map(data.tables.map(t => [t.tableName, t]));
  const oldTables = byName(old), newTables = byName(next);
  if (next.schemaValidation === false) issues.push('Schema validation disabled');
  for (const [name, prev] of oldTables) {
    const curr = newTables.get(name);
    if (!curr) { issues.push(`Removed table ${name}`); continue; }
    if (prev.documentType?.type !== 'object' || curr.documentType?.type !== 'object') {
      if (stable(prev.documentType) !== stable(curr.documentType)) issues.push(`Changed non-object ${name}`);
      continue;
    }
    const a = prev.documentType.value, b = curr.documentType.value;
    for (const [field, validator] of Object.entries(a)) {
      if (!(field in b) || stable(validator) !== stable(b[field])) issues.push(`Changed existing validator ${name}.${field}`);
    }
    for (const [field, validator] of Object.entries(b)) if (!(field in a)) {
      if (!validator.optional) issues.push(`Required new field ${name}.${field}`);
      else changes.push(`Optional field ${name}.${field}`);
    }
    for (const group of ['indexes', 'searchIndexes', 'vectorIndexes']) {
      for (const idx of prev[group] || []) if (!(curr[group] || []).some(i => stable(i) === stable(idx))) issues.push(`Removed/changed ${name} ${group}`);
    }
  }
  for (const name of newTables.keys()) if (!oldTables.has(name)) changes.push(`New table ${name}`);
  console.log(JSON.stringify({ oldTableCount: oldTables.size, newTableCount: newTables.size,
    additiveOnly: issues.length === 0, changes, issues }, null, 2));
  if (issues.length) process.exitCode = 1;
} else throw new Error('Usage: schema-audit.mjs export SCHEMA.ts | compare OLD.json NEW.json');
