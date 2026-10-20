import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import { WebSocket, WebSocketServer } from "ws";

export async function createModelHostResponseProxy(target: string) {
  assert.equal(target, "http://127.0.0.1:54851");
  type Held = { response: ServerResponse; status: number; headers: Headers; bytes: Buffer; path: string };
  let fault: { path: string; mode: "drop" | "hold" } | undefined;
  let held: Held | undefined;
  const observations: Array<{ path: string; status: number; outcome: "forwarded" | "dropped" | "held" | "released" }> = [];
  const sockets = new Set<WebSocket>();
  const send = ({ response, status, headers, bytes }: Held) => {
    response.writeHead(status, { ...Object.fromEntries([...headers].filter(([key]) => !["transfer-encoding", "connection", "content-encoding", "content-length"].includes(key.toLowerCase()))), "content-length": bytes.length });
    response.end(bytes);
  };
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of request) { const part = Buffer.from(chunk); size += part.length; if (size > 1_048_576) throw new Error("Oversized fixture proxy request"); chunks.push(part); }
      const bytes = Buffer.concat(chunks);
      let functionPath = "";
      if (request.method === "POST" && request.url === "/api/mutation") { try { functionPath = JSON.parse(bytes.toString()).path ?? ""; } catch {} }
      const destination = new URL(request.url ?? "/", target); assert.equal(destination.origin, target);
      const upstream = await fetch(destination, { method: request.method, headers: Object.fromEntries(Object.entries(request.headers).filter(([key, value]) => value !== undefined && !["host", "connection", "content-length", "transfer-encoding", "accept-encoding"].includes(key.toLowerCase())).map(([key, value]) => [key, Array.isArray(value) ? value.join(",") : value!])), ...(bytes.length ? { body: bytes } : {}), signal: AbortSignal.timeout(30_000) });
      const body = Buffer.from(await upstream.arrayBuffer());
      const answer = { response, status: upstream.status, headers: upstream.headers, bytes: body, path: functionPath };
      let succeeded = false; try { succeeded = JSON.parse(body.toString()).status === "success"; } catch {}
      if (fault?.path === functionPath && upstream.ok && succeeded) {
        const mode = fault.mode; fault = undefined;
        observations.push({ path: functionPath, status: upstream.status, outcome: mode === "hold" ? "held" : "dropped" });
        if (mode === "hold") held = answer;
        else response.destroy();
        return;
      }
      if (functionPath) observations.push({ path: functionPath, status: upstream.status, outcome: "forwarded" });
      send(answer);
    } catch { if (!response.headersSent) response.writeHead(502, { "content-type": "application/json" }); response.end(JSON.stringify({ error: "Synthetic model host response proxy failed" })); }
  });
  const websocket = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    websocket.handleUpgrade(request, socket, head, peer => {
      const protocols = request.headers["sec-websocket-protocol"]?.split(",").map(value => value.trim()).filter(Boolean);
      const destination = new URL(request.url ?? "/", target.replace("http:", "ws:")); assert.equal(destination.origin, target.replace("http:", "ws:"));
      const remote = new WebSocket(destination, protocols);
      sockets.add(peer); sockets.add(remote);
      const queued: Array<{ bytes: Buffer; binary: boolean }> = []; let queuedBytes = 0;
      let closed = false;
      const close = () => { if (closed) return; closed = true; peer.terminate(); remote.terminate(); sockets.delete(peer); sockets.delete(remote); };
      peer.on("error", close); remote.on("error", close); peer.on("close", close); remote.on("close", close);
      peer.on("message", (data, binary) => {
        const bytes = Buffer.from(data as ArrayBuffer);
        if (remote.readyState === WebSocket.OPEN) remote.send(bytes, { binary });
        else { queuedBytes += bytes.length; if (queuedBytes > 1_048_576) close(); else queued.push({ bytes, binary }); }
      });
      remote.on("open", () => { for (const row of queued) remote.send(row.bytes, { binary: row.binary }); queued.length = 0; });
      remote.on("message", (data, binary) => { if (peer.readyState === WebSocket.OPEN) peer.send(data, { binary }); });
    });
  });
  await new Promise<void>((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  const address = server.address(); assert.ok(address && typeof address === "object");
  return {
    url: `http://127.0.0.1:${address.port}`,
    observations,
    arm(path: "modelHosts:begin" | "modelHosts:advance" | "modelHosts:offerExisting" | "agentRuns:cancel" | "agentThreads:create", mode: "drop" | "hold") { assert.ok(!fault && !held); fault = { path, mode }; },
    held: () => held ? { path: held.path, status: held.status } : null,
    release() { assert.ok(held); const answer = held; held = undefined; observations.push({ path: answer.path, status: answer.status, outcome: "released" }); send(answer); },
    dropHeld() { assert.ok(held); const answer = held; held = undefined; observations.push({ path: answer.path, status: answer.status, outcome: "dropped" }); answer.response.destroy(); },
    async close() { held?.response.destroy(); held = undefined; for (const socket of sockets) socket.terminate(); websocket.close(); server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); },
  };
}
