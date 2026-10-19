import { join } from "node:path";
import { launchVerificationServer } from "./control-omb.ts";
import { mountPreview, parkUntilSignal } from "./testing/preview-fixture.ts";
import { json, readBody } from "../server/harness/http.ts";
import { createOriginMemberRoutes } from "../server/origin-members.ts";
import { openRealtimeStore } from "../server/origin-realtime-store.ts";
import { dispatchRoutes } from "../server/routes/table.ts";

const fixture = await launchVerificationServer();
const store = openRealtimeStore(join(fixture.info.dataDir, "calls-preview.sqlite"));
const user = { _id: "fixturecalluser", name: "Fixture user", email: "fixture@example.test" };
const scope = (room: string) => ({ user: { userId: user._id, name: user.name, email: user.email, teamId: "fixturecallteam", role: "owner" }, room });
const deferredLeaves = new Set<() => void>();
const requestLog: unknown[] = [];
const routes = createOriginMemberRoutes({ store: () => store, filesDir: join(fixture.info.dataDir, "call-files"), turn: () => ({}), convex: () => ({
  query: async (name, args) => {
    if (args.sessionToken !== "fixture-call-token") throw new Error("Login required");
    if (name === "auth:me") return user;
    if (name === "workspaces:access") return { teamId: "fixturecallteam", role: "owner" };
    if (name === "projects:get") return { _id: args.projectId, teamId: "fixturecallteam", name: "Fixture call", memberRole: "owner" };
    throw new Error(`Unsupported fixture query ${name}`);
  }, mutation: async () => { throw new Error("Fixture has no Convex mutations"); },
}) });
let preview: Awaited<ReturnType<typeof mountPreview>> | undefined;
try {
  preview = await mountPreview(fixture, { entry: "/scripts/testing/origin-calls-preview.tsx", route: "/__origin-calls.html", title: "Isolated Origin call verification", extraRoutes: [
    { path: /^\/api\/local-voice\//, handler: async (req, res) => {
      const url = new URL(req.url ?? "/", "http://fixture.invalid");
      if (url.pathname === "/api/local-voice/agent") { json(res, 200, { agent: null, lines: [], cursor: 0, ended: null }); return; }
      await dispatchRoutes([routes], { req, res, url, path: url.pathname, method: req.method ?? "GET", auth: { kind: "loopback", scopes: ["admin", "client"] }, json,
        readBody: async (...args) => {
          const body = await readBody(...args);
          if (url.pathname.endsWith("/participants") && body.action === "leave" && url.searchParams.get("room") === "fixturefirstroom") {
            await new Promise<void>((resolve) => deferredLeaves.add(resolve));
          }
          requestLog.push({ path: req.url, body });
          return body;
        },
      });
    } },
    { path: "/__call-fixture/release", handler: (_req, res) => { deferredLeaves.forEach((resolve) => resolve()); deferredLeaves.clear(); json(res, 200, { ok: true }); } },
    { path: "/__call-fixture/replace", handler: (req, res) => { const room = new URL(req.url ?? "/", "http://fixture.invalid").searchParams.get("room") ?? "fixtureotherroom"; store.join(scope(room), { audioEnabled: false, videoEnabled: false, screenSharing: false }); json(res, 200, { ok: true }); } },
    { path: "/__call-fixture/evidence", handler: (_req, res) => { json(res, 200, { requestLog, first: store.participants(scope("fixturefirstroom")), second: store.participants(scope("fixtureotherroom")) }); } },
  ] });
  console.log(JSON.stringify({ ...fixture.info, previewUrl: preview.previewUrl }));
  await parkUntilSignal();
} finally {
  deferredLeaves.forEach((resolve) => resolve());
  await preview?.close();
  store.close();
  await fixture.close();
}
