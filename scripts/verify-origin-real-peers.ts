import { join } from "node:path";
import { launchVerificationServer } from "./control-omb.ts";
import { mountPreview, parkUntilSignal } from "./testing/preview-fixture.ts";
import { json, readBody } from "../server/harness/http.ts";
import { createOriginMemberRoutes } from "../server/origin-members.ts";
import { openRealtimeStore } from "../server/origin-realtime-store.ts";
import { dispatchRoutes } from "../server/routes/table.ts";

const fixture = await launchVerificationServer();
const store = openRealtimeStore(join(fixture.info.dataDir, "real-peer-calls.sqlite"));
const users = Object.fromEntries(["a", "b"].map((peer) => [`fixture-peer-${peer}`, { _id: `fixturepeer${peer}`, name: `Peer ${peer.toUpperCase()}`, email: `${peer}@example.test` }]));
const calls: unknown[] = [];
const routes = createOriginMemberRoutes({ store: () => store, filesDir: join(fixture.info.dataDir, "peer-call-files"), turn: () => ({}), convex: () => ({
  query: async (name, args) => {
    const user = users[String(args.sessionToken)];
    if (!user) throw new Error("Unknown fixture identity");
    if (name === "auth:me") return user;
    if (name === "workspaces:access") return { teamId: "fixturepeerteam", role: "owner" };
    if (name === "projects:get") return { _id: args.projectId, teamId: "fixturepeerteam", name: "Real peer fixture", memberRole: "owner" };
    throw new Error(`Unsupported fixture query ${name}`);
  }, mutation: async () => { throw new Error("No fixture mutations"); },
}) });
let preview: Awaited<ReturnType<typeof mountPreview>> | undefined;
try {
  preview = await mountPreview(fixture, { entry: "/scripts/testing/real-peer-calls-preview.tsx", route: "/__origin-real-peers.html", title: "Isolated native two-peer call", hmr: false, extraRoutes: [
    { path: /^\/api\/local-voice\//, handler: async (req, res) => {
      const url = new URL(req.url ?? "/", "http://fixture.invalid");
      if (url.pathname === "/api/local-voice/agent") { json(res, 200, { agent: null, lines: [], cursor: 0, ended: null }); return; }
      await dispatchRoutes([routes], { req, res, url, path: url.pathname, method: req.method ?? "GET", auth: { kind: "loopback", scopes: ["admin", "client"] }, json,
        readBody: async (...args) => {
          const body = await readBody(...args);
          calls.push({ path: url.pathname, identity: req.headers["x-origin-session"], method: req.method, action: body.action, kind: body.kind, payloadBytes: typeof body.payload === "string" ? body.payload.length : 0, sessionId: body.sessionId, toSessionId: body.toSessionId });
          return body;
        },
      });
    } },
    { path: "/__peer-fixture/evidence", handler: (_req, res) => json(res, 200, { fixtureKind: "origin-native-real-peers-v1", calls, participants: store.participants({ user: { userId: "fixturepeera", name: "Peer A", email: "a@example.test", teamId: "fixturepeerteam", role: "owner" }, room: "fixturepeerroom" }) }) },
  ] });
  console.log(JSON.stringify({ ...fixture.info, previewUrl: preview.previewUrl }));
  await parkUntilSignal();
} finally { await preview?.close(); store.close(); await fixture.close(); }
