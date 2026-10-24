// The real Convex functions of backend/convex, run in memory by convex-test and
// served over the HTTP wire ConvexHttpClient speaks, so the Campaigns fixture
// exercises the deployed code without a deployment. Vite loads the backend's
// extensionless TypeScript imports; nothing here reaches the network.
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer as createViteServer } from "vite";
import { WebSocketServer, type WebSocket } from "ws";
import { REPO_ROOT } from "./preview-fixture.ts";

type Json = Record<string, unknown>;
type Loader = () => Promise<Record<string, unknown>>;
type ConvexTest = {
  query(ref: unknown, args: Json): Promise<unknown>;
  mutation(ref: unknown, args: Json): Promise<unknown>;
  action(ref: unknown, args: Json): Promise<unknown>;
  run<T>(fn: (ctx: { db: { insert(table: string, doc: Json): Promise<string>; patch(id: string, doc: Json): Promise<void>; query(table: string): { first(): Promise<Json | null> } } }) => Promise<T>): Promise<T>;
};

const BACKEND = join(REPO_ROOT, "backend");
const CONVEX = join(BACKEND, "convex");

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

export interface FakeConvex {
  url: string;
  t: ConvexTest;
  ref(name: string): unknown;
  load<T = Record<string, unknown>>(path: string): Promise<T>;
  wireId(id: string): string;
  nativeId(id: string): string;
  setOffline(sessionToken: string, offline: boolean): void;
  close(): Promise<void>;
}

export async function startFakeConvex(options: { subscriptions?: boolean } = {}): Promise<FakeConvex> {
  const vite = await createViteServer({ root: BACKEND, configFile: false, logLevel: "error", appType: "custom", server: { middlewareMode: true, hmr: false, watch: null } });
  const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
  const fromBackend = (name: string) => import(pathToFileURL(join(BACKEND, "node_modules", name)).href);
  const { convexTest } = await fromBackend("convex-test/dist/index.js") as { convexTest(schema: unknown, modules: Record<string, Loader>): ConvexTest };
  const { makeFunctionReference } = await fromBackend("convex/dist/esm/server/index.js") as { makeFunctionReference(name: string): unknown };
  const { convexToJson, jsonToConvex } = await fromBackend("convex/dist/esm/values/index.js") as { convexToJson(value: unknown): unknown; jsonToConvex(value: unknown): unknown };
  const modules: Record<string, Loader> = Object.fromEntries(files(CONVEX)
    .filter((path) => /\.(ts|js)$/.test(path) && !path.endsWith(".test.ts"))
    .map((path) => [`./${relative(CONVEX, path).split("\\").join("/")}`, path.endsWith(".d.ts") ? async () => ({}) : () => load(path)]));
  const schema = (await load<{ default: unknown }>(join(CONVEX, "schema.ts"))).default;
  const t = convexTest(schema, modules);
  const ids = new Map<string, string>(), nativeIds = new Map<string, string>();
  const wireId = (id: string) => {
    if (!options.subscriptions || !/^\d+[A-Za-z]\w*$/.test(id) || id.length !== 32) return id;
    if (!ids.has(id)) { const wire = (ids.size + 1).toString(36).padStart(32, "0"); ids.set(id, wire); nativeIds.set(wire, id); }
    return ids.get(id)!;
  };
  const nativeId = (id: string) => nativeIds.get(id) ?? id;
  const mapIds = (value: unknown, convert: (id: string) => string): unknown => {
    if (typeof value === "string") return convert(value);
    if (Array.isArray(value)) return value.map(item => mapIds(item, convert));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapIds(item, convert)]));
    return value;
  };
  let pending = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const result = pending.then(fn);
    pending = result.then(() => undefined, () => undefined);
    return result;
  };

  const answer = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Convex-Client", "Access-Control-Allow-Methods": "POST, OPTIONS" });
    res.end(JSON.stringify(body));
  };
  const read = async (req: IncomingMessage) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Json;
  };
  const server = createHttpServer(async (req, res) => {
    if (req.method === "OPTIONS") return answer(res, 204, null);
    const kind = req.url === "/api/query" ? "query" : req.url === "/api/mutation" ? "mutation" : req.url === "/api/action" ? "action" : null;
    if (req.method !== "POST" || !kind) return answer(res, 404, { status: "error", errorMessage: "Not found" });
    try {
      const body = await read(req);
      const args = mapIds(jsonToConvex((body.args as unknown[])[0] ?? {}), nativeId) as Json;
      const value = await serial(() => t[kind](makeFunctionReference(String(body.path)), args));
      answer(res, 200, { status: "success", value: mapIds(convexToJson(value ?? null), wireId), logLines: [] });
    } catch (error) {
      answer(res, 560, { status: "error", errorMessage: error instanceof Error ? error.message : String(error), logLines: [] });
    }
  });
  const sockets = new Map<WebSocket, { version: { querySet: number; identity: number; ts: string }; querySet: number; queries: Map<number, { path: string; args: Json; last?: string }> }>();
  const offline = new Set<string>();
  let timestamp = 0n;
  const tick = () => { const bytes = Buffer.alloc(8); bytes.writeBigUInt64LE(++timestamp); return bytes.toString("base64"); };
  const refresh = async (socket: WebSocket) => {
    const state = sockets.get(socket);
    if (!state || socket.readyState !== 1) return;
    const modifications = [];
    for (const [queryId, query] of state.queries) {
      if (offline.has(String(query.args.sessionToken))) continue;
      let update: Json;
      try { update = { type: "QueryUpdated", queryId, value: mapIds(convexToJson(await t.query(makeFunctionReference(query.path), query.args)), wireId), logLines: [], journal: null }; }
      catch (error) { update = { type: "QueryFailed", queryId, errorMessage: String(error), errorData: null, logLines: [], journal: null }; }
      const encoded = JSON.stringify(update);
      if (encoded !== query.last) { modifications.push(update); query.last = encoded; }
    }
    if (!modifications.length && state.querySet === state.version.querySet) return;
    const endVersion = { querySet: state.querySet, identity: 0, ts: tick() };
    if (socket.readyState === 1) socket.send(JSON.stringify({ type: "Transition", startVersion: state.version, endVersion, modifications }));
    state.version = endVersion;
  };
  const websocket = options.subscriptions ? new WebSocketServer({ server }) : null;
  websocket?.on("connection", socket => {
    sockets.set(socket, { version: { querySet: 0, identity: 0, ts: Buffer.alloc(8).toString("base64") }, querySet: 0, queries: new Map() });
    socket.on("close", () => sockets.delete(socket));
    socket.on("message", data => {
      void serial(async () => {
        const message = JSON.parse(data.toString()) as { type: string; newVersion: number; modifications: { type: string; queryId: number; udfPath: string; args: unknown[] }[] };
        const state = sockets.get(socket);
        if (!state || message.type !== "ModifyQuerySet") return;
        state.querySet = message.newVersion;
        for (const change of message.modifications) {
          if (change.type === "Add") state.queries.set(change.queryId, { path: change.udfPath, args: mapIds(jsonToConvex(change.args[0]), nativeId) as Json });
          else state.queries.delete(change.queryId);
        }
        await refresh(socket);
      });
    });
  });
  let refreshing = false;
  const timer = websocket ? setInterval(() => {
    if (refreshing) return;
    refreshing = true;
    void serial(async () => { for (const socket of sockets.keys()) await refresh(socket); }).finally(() => { refreshing = false; });
  }, 100) : null;
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("The fake Convex server has no port");
  return {
    url: `http://127.0.0.1:${address.port}`,
    t,
    wireId,
    nativeId,
    setOffline(sessionToken, disconnected) {
      if (disconnected) offline.add(sessionToken);
      else offline.delete(sessionToken);
      if (disconnected) for (const [socket, state] of sockets) if ([...state.queries.values()].some(query => query.args.sessionToken === sessionToken)) socket.terminate();
    },
    ref: makeFunctionReference,
    load: (path) => load(join(BACKEND, path)),
    async close() {
      if (timer) clearInterval(timer);
      for (const socket of sockets.keys()) socket.terminate();
      websocket?.close();
      await pending;
      await new Promise((resolve) => server.close(resolve));
      await vite.close();
    },
  };
}
