import assert from "node:assert/strict";
import { DocumentSyncQueue } from "../lib/document-sync";

async function main() {
  let release!: () => void;
  const first = new Promise<void>(resolve => { release = resolve; });
  const sent: number[][] = [];
  const queue = new DocumentSyncQueue(async updates => { sent.push(updates.map(update => update[0])); if (sent.length === 1) await first; });
  queue.add(Uint8Array.of(1));
  const inFlight = queue.flush();
  queue.add(Uint8Array.of(2));
  assert.equal(queue.flush(), inFlight);
  assert.equal(queue.restore().length, 2);
  release();
  await inFlight;
  assert.deepEqual(sent, [[1], [2]]);
  assert.equal(queue.snapshot().pending, 0);
  let attempts = 0;
  const retry = new DocumentSyncQueue(async () => { if (++attempts === 1) throw new Error("Offline"); });
  retry.add(Uint8Array.of(3));
  await retry.flush();
  assert.equal(retry.snapshot().error, "Offline");
  assert.equal(retry.restore().length, 1);
  await retry.flush();
  assert.equal(retry.snapshot().pending, 0);
  assert.equal(retry.snapshot().error, "");
  console.log("PASS document save draining, navigation safety, retry and pending edit recovery");
}
void main();
