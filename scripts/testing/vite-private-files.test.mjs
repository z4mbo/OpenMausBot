import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createTcpServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createServer, normalizePath } from "vite";

const marker = "synthetic-origin-vite-private-files";
const temporaryParent = realpathSync.native(tmpdir());
const root = realpathSync.native(mkdtempSync(join(temporaryParent, "origin-vite-private-files-")));
const configFile = resolve(process.cwd(), "vite.config.ts");
const scratchFiles = ["credential.env", "create-token.log", "receipt.json"].flatMap(name => [`.omb-scratch/${name}`, `nested/.omb-scratch/${name}`]);
const defaultDeniedFiles = [".env", ".env.local", "private.crt", "private.pem", ".git/config"];
const encodings = ["ordinary", "fs", "encoded", "encoded-fs"];
const samples = [];
let server;
let origin;
let port;

function listenerPort(listener) {
  const address = listener.address();
  assert.ok(address && typeof address === "object");
  return address.port;
}

async function unusedPort() {
  const listener = createTcpServer();
  await new Promise((success, failure) => { listener.once("error", failure); listener.listen(0, "127.0.0.1", success); });
  const chosen = listenerPort(listener);
  await new Promise((success, failure) => listener.close(error => error ? failure(error) : success()));
  assert.ok(![3210, 5173, 5174, 5175, 5176, 5199, 8799].includes(chosen));
  return chosen;
}

function requestPath(file, encoding) {
  const ordinary = `/${file}`;
  const absolute = `/@fs/${normalizePath(join(root, file))}`;
  return encoding === "ordinary" ? ordinary : encoding === "fs" ? absolute : (encoding === "encoded" ? ordinary : absolute).replace(/\./g, "%2e");
}

beforeAll(async () => {
  writeFileSync(join(root, ".origin-private-files-fixture"), marker);
  for (const file of ["ordinary.txt", ...scratchFiles, ...defaultDeniedFiles]) {
    const target = join(root, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, marker);
  }
  port = await unusedPort();
  server = await createServer({ configFile, root, envDir: root, publicDir: false, cacheDir: join(root, "cache"), appType: "custom", logLevel: "silent", optimizeDeps: { noDiscovery: true, include: [] }, server: { host: "127.0.0.1", port, strictPort: true, hmr: false, watch: null, fs: { allow: [root] } } });
  await server.listen();
  assert.equal(listenerPort(server.httpServer), port);
  origin = `http://127.0.0.1:${port}`;
}, 30_000);

afterAll(async () => {
  await server?.close();
  if (port) {
    const listener = createTcpServer();
    await new Promise((success, failure) => { listener.once("error", failure); listener.listen(port, "127.0.0.1", success); });
    await new Promise((success, failure) => listener.close(error => error ? failure(error) : success()));
  }
  assert.equal(dirname(root), temporaryParent);
  assert.ok(basename(root).startsWith("origin-vite-private-files-") && root.startsWith(temporaryParent + sep));
  assert.equal(readFileSync(join(root, ".origin-private-files-fixture"), "utf8"), marker);
  rmSync(root, { recursive: true, force: true });
  console.info(JSON.stringify({ fixture: marker, pid: process.pid, origin, root, configFile, closed: true, removed: true, samples }));
}, 30_000);

it.each(["ordinary", "fs"])("serves ordinary synthetic assets through %s", async encoding => {
  const path = requestPath("ordinary.txt", encoding);
  const response = await fetch(origin + path, { redirect: "error", signal: AbortSignal.timeout(5000) });
  const body = await response.text();
  samples.push({ file: "ordinary.txt", encoding, status: response.status });
  expect(response.status).toBe(200);
  expect(body).toBe(marker);
});

it.each([...scratchFiles, ...defaultDeniedFiles].flatMap(file => encodings.map(encoding => [file, encoding])))("denies %s through %s", async (file, encoding) => {
  const path = requestPath(file, encoding);
  const response = await fetch(origin + path, { redirect: "error", signal: AbortSignal.timeout(5000) });
  const body = await response.text();
  samples.push({ file, encoding, status: response.status });
  expect(response.status).toBe(403);
  expect(body).not.toContain(marker);
});
