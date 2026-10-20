// The real Convex functions of backend/convex, run in memory by convex-test and
// served over the HTTP wire ConvexHttpClient speaks, so the Campaigns fixture
// exercises the deployed code without a deployment. Vite loads the backend's
// extensionless TypeScript imports; nothing here reaches the network.
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer as createViteServer } from "vite";
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
  close(): Promise<void>;
}

export async function startFakeConvex(): Promise<FakeConvex> {
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
      const args = jsonToConvex((body.args as unknown[])[0] ?? {}) as Json;
      const value = await t[kind](makeFunctionReference(String(body.path)), args);
      answer(res, 200, { status: "success", value: convexToJson(value ?? null), logLines: [] });
    } catch (error) {
      answer(res, 560, { status: "error", errorMessage: error instanceof Error ? error.message : String(error), logLines: [] });
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("The fake Convex server has no port");
  return {
    url: `http://127.0.0.1:${address.port}`,
    t,
    ref: makeFunctionReference,
    load: (path) => load(join(BACKEND, path)),
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await vite.close();
    },
  };
}
