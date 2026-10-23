import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { removeTempDir } from '../../../server/testing/cleanup.ts';
const own=import.meta.dirname;
const handle=JSON.parse(readFileSync(resolve(own,'handle.json'),'utf8'));
assert.equal(handle.owner,'5273847f-b0b4-4d97-a245-1bdb3c104a70');
const target=resolve(handle.fixture.dataDir);
assert.equal(dirname(target).toLowerCase(),resolve(tmpdir()).toLowerCase());
assert.equal(basename(target),'openmausbot-verify-data-WqDvAb');
if(existsSync(target)) {
  const stat=lstatSync(target);
  assert(stat.isDirectory()&&!stat.isSymbolicLink());
  assert.equal(stat.birthtime.toISOString(),'2026-10-21T20:03:33.658Z');
  await removeTempDir(target);
}
assert(!existsSync(target));
writeFileSync(resolve(own,'closure-reconciled.json'),JSON.stringify({owner:handle.owner,observedAt:new Date().toISOString(),foregroundSessionAvailable:false,ownedProcessesAlreadyAbsent:true,ownedListenersAlreadyAbsent:true,shutdownRequestWritten:true,normalFinallyReceiptPresent:existsSync(resolve(own,'cleanup.json')),retainedDataRemoved:target,temporaryDataAbsent:true,protectedProcessesTouched:false,browserSessionsPreviouslyClosed:true,qualification:'Foreground process handle unavailable and exact owned processes/listeners absent on fresh inspection; removed only its identity-checked retained temporary data. No claim of graceful launcher shutdown.'},null,2)+'\n',{flag:'wx'});
