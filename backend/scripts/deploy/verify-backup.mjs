// Windows/local verifier: stream a GNU/PAX tar without extracting credentials.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const archive = process.argv[2];
const fd = fs.openSync(archive, 'r');
const records = new Map();
const read = (offset, length) => {
  const b = Buffer.alloc(length);
  if (fs.readSync(fd, b, 0, length, offset) !== length) throw new Error('Truncated archive');
  return b;
};
const field = b => b.toString('utf8').replace(/\0.*$/s, '');
let offset = 0, pending = {};
try {
  while (offset < fs.fstatSync(fd).size) {
    const header = read(offset, 512);
    if (header.every(n => n === 0)) break;
    const size = parseInt(field(header.subarray(124, 136)).trim() || '0', 8);
    const type = String.fromCharCode(header[156]);
    let name = field(header.subarray(0, 100));
    const prefix = field(header.subarray(345, 500));
    if (prefix) name = prefix + '/' + name;
    let link = field(header.subarray(157, 257));
    const start = offset + 512;
    if (['L', 'K', 'x', 'g'].includes(type)) {
      const text = field(read(start, size));
      if (type === 'L') pending.path = text;
      else if (type === 'K') pending.linkpath = text;
      else {
        for (const line of text.split('\n')) {
          const match = line.match(/^\d+ (path|linkpath)=(.*)$/);
          if (match) pending[match[1]] = match[2];
        }
      }
    } else {
      name = (pending.path || name).replace(/^\.\//, '');
      link = pending.linkpath || link;
      pending = {};
      const hash = crypto.createHash('sha256');
      for (let n = 0; n < size; n += 1024 * 1024) hash.update(read(start + n, Math.min(1024 * 1024, size - n)));
      records.set(name, { start, size, type, link, hash: hash.digest('hex') });
    }
    offset = start + Math.ceil(size / 512) * 512;
  }
  const contents = name => {
    const entry = records.get(name);
    if (!entry) throw new Error('Missing archive entry: ' + name);
    return read(entry.start, entry.size);
  };
  const manifest = JSON.parse(contents('manifest.json'));
  for (const [name, expected] of Object.entries(manifest.files)) {
    if (records.get(name)?.hash !== expected.sha256) throw new Error('Checksum mismatch: ' + name);
  }
  for (const [name, expected] of Object.entries(manifest.symlinks)) {
    if (records.get(name)?.link !== expected) throw new Error('Symlink mismatch: ' + name);
  }
  const databases = JSON.parse(contents('sqlite.json'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'origin-restore-'));
  try {
    for (const [i, name] of databases.entries()) {
      const file = path.join(tmp, `${i}.sqlite`);
      fs.writeFileSync(file, contents(name));
      const db = new DatabaseSync(file, { readOnly: true });
      try {
        const result = db.prepare('PRAGMA integrity_check').all();
        if (result.length !== 1 || Object.values(result[0])[0] !== 'ok') throw new Error('SQLite integrity failure');
      } finally { db.close(); }
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  console.log(JSON.stringify({ checksums: Object.keys(manifest.files).length,
    symlinks: Object.keys(manifest.symlinks).length, sqliteIntegrityChecks: databases.length, result: 'PASS' }));
} finally { fs.closeSync(fd); }
