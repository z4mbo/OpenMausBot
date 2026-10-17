import { createServer } from "node:http";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import { launchVerificationServer } from "./control-omb.ts";
import { mountPreview, parkUntilSignal } from "./testing/preview-fixture.ts";

type Mode = "failure" | "refresh-failure" | "revoked" | "pending" | "ready" | "offline";
let mode: Mode = "failure";
const events: { type: string; query?: string; outcome?: string }[] = [];
const sockets = new Map<import("ws").WebSocket, { version: { querySet: number; identity: number; ts: string }; queries: Map<number, string>; sequence: bigint }>();
const stamp = (value: bigint) => { const bytes = Buffer.alloc(8); bytes.writeBigUInt64LE(value); return bytes.toString("base64"); };
const queryValue = (name: string) => {
  if (name === "auth:me") return { _id: "fixture-user", name: "Fixture user", email: "user@example.test" };
  if (name === "projects:get") return { _id: "fixture-project", name: "Fixture project", memberRole: "owner", status: "active", accent: "green" };
  if (name === "design:list") return { assets: [{ _id: "fixture-asset", name: "Recovered synthetic asset", type: "document", updatedAt: 1 }], tokens: [] };
  if (name === "fixture:pages") return { page: ["Recovered synthetic page"], isDone: true, continueCursor: "" };
  return [];
};
const resultFor = (queryId: number, name: string) => {
  if (mode === "revoked" && name === "projects:get") return { type: "QueryFailed", queryId, errorMessage: "No active project access: SYNTHETIC_PRIVATE_MARKER", errorData: null, logLines: [], journal: null };
  const target = ["design:list", "fixture:pages"].includes(name);
  if (target && mode === "pending") return null;
  if (target && (mode === "failure" || mode === "refresh-failure")) return { type: "QueryFailed", queryId, errorMessage: `${mode === "failure" ? "Synthetic access denial" : "Synthetic refresh outage"}: SYNTHETIC_PRIVATE_MARKER`, errorData: null, logLines: [], journal: null };
  return { type: "QueryUpdated", queryId, value: queryValue(name), logLines: [], journal: null };
};
const transition = (socket: import("ws").WebSocket, modifications: unknown[], patch: Partial<{ querySet: number; identity: number }> = {}) => {
  const state = sockets.get(socket)!;
  const startVersion = state.version;
  state.sequence++;
  const endVersion = { ...startVersion, ...patch, ts: stamp(state.sequence) };
  state.version = endVersion;
  socket.send(JSON.stringify({ type: "Transition", startVersion, endVersion, modifications }));
};
const cloud = createServer((req, res) => {
  if (req.url === "/state") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ mode, events })); return; }
  if (req.method === "POST" && req.url === "/mode") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const request = JSON.parse(body);
      const next = request.mode;
      if (!["failure", "refresh-failure", "revoked", "pending", "ready", "offline"].includes(next)) { res.writeHead(400).end(); return; }
      mode = next;
      if (mode === "offline") { for (const socket of sockets.keys()) socket.close(1013, "Synthetic offline transport"); res.end("ok"); return; }
      if (request.publish !== false) for (const [socket, state] of sockets) transition(socket, [...state.queries].flatMap(([id, name]) => { const result = resultFor(id, name); return result ? [result] : []; }));
      res.end("ok");
    });
    return;
  }
  res.writeHead(404).end();
});
const websocket = new WebSocketServer({ server: cloud });
websocket.on("connection", (socket) => {
  if (mode === "offline") { socket.close(1013, "Synthetic offline transport"); return; }
  sockets.set(socket, { version: { querySet: 0, identity: 0, ts: stamp(0n) }, sequence: 0n, queries: new Map() });
  socket.on("close", () => sockets.delete(socket));
  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    const state = sockets.get(socket)!;
    if (message.type === "Connect") { events.push({ type: "Connect" }); return; }
    if (message.type === "Authenticate") { transition(socket, [], { identity: message.baseVersion + 1 }); return; }
    if (message.type !== "ModifyQuerySet") return;
    const modifications = [];
    for (const change of message.modifications) {
      if (change.type === "Remove") { state.queries.delete(change.queryId); modifications.push({ type: "QueryRemoved", queryId: change.queryId }); continue; }
      state.queries.set(change.queryId, change.udfPath);
      const result = resultFor(change.queryId, change.udfPath);
      events.push({ type: "Query", query: change.udfPath, outcome: result?.type ?? "pending" });
      if (result) modifications.push(result);
    }
    transition(socket, modifications, { querySet: message.newVersion });
  });
});
await new Promise<void>((resolve) => cloud.listen(0, "127.0.0.1", resolve));
const cloudAddress = cloud.address();
if (!cloudAddress || typeof cloudAddress === "string") throw new Error("The synthetic query server did not bind a port");
const cloudUrl = `http://127.0.0.1:${cloudAddress.port}`;
const fixture = await launchVerificationServer();
let preview: Awaited<ReturnType<typeof mountPreview>> | undefined;
try {
  preview = await mountPreview(fixture, { entry: "/scripts/testing/origin-query-errors-preview.tsx", route: "/__origin-query-errors.html", title: "Origin isolated query error verification", hmr: false, cacheDir: join(fixture.info.dataDir, "vite-query-cache") });
  console.log(JSON.stringify({ ...fixture.info, cloudUrl, previewUrl: `${preview.previewUrl}?backend=${encodeURIComponent(cloudUrl)}` }));
  await parkUntilSignal();
} finally { await preview?.close(); await fixture.close(); for (const socket of sockets.keys()) socket.terminate(); websocket.close(); await new Promise<void>((resolve) => cloud.close(() => resolve())); }
