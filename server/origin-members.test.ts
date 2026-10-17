import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { releases } from "../shared/origin-releases.ts";
import { json, readBody } from "./harness/http.ts";
import { createCallAgents, DEFAULT_CALL_AGENT_SETTINGS, type CallAgents } from "./origin-call-agent.ts";
import type { OriginCloudClient } from "./origin-cloud.ts";
import { convexMentionNotifier, createOriginMemberRoutes, turnIceServers } from "./origin-members.ts";
import { openRealtimeStore, type MentionNotice } from "./origin-realtime-store.ts";
import type { RequestAuth } from "./request-auth.ts";
import { dispatchRoutes } from "./routes/table.ts";

const TEAM = "team0000000001";
const OTHER_TEAM = "team0000000002";
const PROJECT = "proj0000000001";
const FOREIGN_PROJECT = "proj0000000009";
const USERS: Record<string, { _id: string; name: string; email: string }> = {
  "tok-ana": { _id: "user000000000a", name: "Ana", email: "ana@x.dev" },
  "tok-bo": { _id: "user000000000b", name: "Bo", email: "bo@x.dev" },
  "tok-cy": { _id: "user000000000c", name: "Cy", email: "cy@x.dev" },
};
const ROLES: Record<string, string> = { "tok-ana": "owner", "tok-bo": "member", "tok-cy": "viewer" };
const OWNER: RequestAuth = { kind: "loopback", scopes: ["admin", "client"] };

const servers: Server[] = [];
const folders: string[] = [];
const stores: { close(): void }[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
  for (const store of stores.splice(0)) store.close();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function fakeConvex(projectRoles: Record<string, string> = {}): OriginCloudClient {
  const answer = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    const token = String(args.sessionToken ?? "");
    const user = USERS[token];
    if (!user) throw new Error("Uncaught Error: Login required");
    if (name === "auth:me") return user;
    if (name === "workspaces:access") {
      if (args.teamId !== TEAM) throw new Error("Uncaught Error: Not a member");
      return { teamId: TEAM, slug: "ggs", role: ROLES[token] };
    }
    if (name === "workspaces:members") return Object.entries(USERS).map(([key, member]) => ({ userId: member._id, name: member.name, email: member.email, role: ROLES[key] }));
    if (name === "projects:get") {
      if (args.projectId === PROJECT) return { _id: PROJECT, teamId: TEAM, name: "Kai", memberRole: projectRoles[token] ?? ROLES[token] };
      if (args.projectId === FOREIGN_PROJECT) return { _id: FOREIGN_PROJECT, teamId: OTHER_TEAM, name: "Elsewhere", memberRole: "owner" };
      throw new Error("Uncaught Error: Project not found");
    }
    if (name === "tasks:details") return { task: { _id: args.taskId, title: "Fix login", assignedToEmail: "bo@x.dev" } };
    if (name === "tasks:authorizeLocalFile") return null;
    throw new Error(`unexpected ${name}`);
  };
  return { query: answer, mutation: answer };
}

async function start(options: { notices?: MentionNotice[]; delayMs?: number; callAgents?: CallAgents; projectRoles?: Record<string, string> } = {}) {
  const folder = mkdtempSync(join(tmpdir(), "omb-origin-members-"));
  folders.push(folder);
  const store = openRealtimeStore(join(folder, "realtime.sqlite"));
  stores.push(store);
  const convex = fakeConvex(options.projectRoles);
  const route = createOriginMemberRoutes({
    store: () => store,
    convex: () => convex,
    filesDir: join(folder, "files"),
    turn: () => ({ host: "turn.example", secret: "turn-secret" }),
    notifyMentions: options.notices ? async (notice) => {
      if (options.delayMs) await new Promise((done) => setTimeout(done, options.delayMs));
      options.notices!.push(notice);
    } : null,
    ...(options.callAgents ? { callAgents: options.callAgents } : {}),
  });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!(await dispatchRoutes([route], { req, res, url, path: url.pathname, method: req.method ?? "GET", auth: OWNER, json, readBody }))) json(res, 404, { error: "no route" });
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (token: string | null, method: string, path: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(token ? { "x-origin-session": token } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
  return { base, call, store };
}

describe("turnIceServers", () => {
  it("issues coturn REST credentials that expire in an hour", () => {
    const servers = turnIceServers({ host: "turn.example", secret: "s3cret" }, "user1", 1_700_000_000_000);
    const username = `${1_700_000_000 + 3600}:user1`;
    expect(servers).toEqual([
      { urls: "stun:turn.example:3478" },
      { urls: ["turn:turn.example:3478?transport=udp", "turn:turn.example:3478?transport=tcp"], username, credential: createHmac("sha1", "s3cret").update(username).digest("base64") },
    ]);
    expect(turnIceServers({}, "user1", 0)).toEqual([]);
    expect(turnIceServers({ host: "turn.example" }, "user1", 0)).toEqual([{ urls: "stun:turn.example:3478" }]);
  });
});

describe("origin member calls", () => {
  it("needs an Origin session for the workspace", async () => {
    const { call } = await start();
    expect((await call(null, "GET", `/api/local-voice/config?teamId=${TEAM}`)).status).toBe(401);
    expect((await call("tok-ana", "GET", `/api/local-voice/config?teamId=${OTHER_TEAM}`)).status).toBe(401);
    const config = await call("tok-ana", "GET", `/api/local-voice/config?teamId=${TEAM}`);
    expect(config.status).toBe(200);
    expect(config.body.iceServers[1].username).toMatch(/:user000000000a$/);
  });

  it("signals between two people in one project room and keeps rooms apart", async () => {
    const { call } = await start();
    const room = `teamId=${TEAM}&room=${PROJECT}`;
    const ana = await call("tok-ana", "POST", `/api/local-voice/participants?${room}`, { action: "join", audioEnabled: true });
    const bo = await call("tok-bo", "POST", `/api/local-voice/participants?${room}`, { action: "join", videoEnabled: true });
    expect(ana.status).toBe(200);
    const listed = await call("tok-bo", "GET", `/api/local-voice/participants?${room}`);
    expect(listed.body.participants.map((p: { name: string }) => p.name)).toEqual(["Ana", "Bo"]);
    expect((await call("tok-bo", "GET", `/api/local-voice/participants?teamId=${TEAM}`)).body.participants).toEqual([]);

    const sent = await call("tok-ana", "POST", `/api/local-voice/signals?${room}`, { toUserId: USERS["tok-bo"]!._id, kind: "offer", payload: "{}", fromJoinedAt: ana.body.joinedAt, toJoinedAt: bo.body.joinedAt, sessionId: ana.body.sessionId, toSessionId: bo.body.sessionId });
    expect(sent.body.signal.kind).toBe("offer");
    const stale = await call("tok-ana", "POST", `/api/local-voice/signals?${room}`, { toUserId: USERS["tok-bo"]!._id, kind: "offer", payload: "{}", toJoinedAt: 1, sessionId: ana.body.sessionId, toSessionId: bo.body.sessionId });
    expect(stale.body.signal).toBeNull();
    const inbox = await call("tok-bo", "GET", `/api/local-voice/signals?${room}&sessionId=${bo.body.sessionId}`);
    expect(inbox.body.signals).toHaveLength(1);
    await call("tok-bo", "DELETE", `/api/local-voice/signals?${room}`, { signalIds: [inbox.body.signals[0].id], sessionId: bo.body.sessionId });
    expect((await call("tok-bo", "GET", `/api/local-voice/signals?${room}&sessionId=${bo.body.sessionId}`)).body.signals).toEqual([]);

    await call("tok-bo", "POST", `/api/local-voice/participants?${room}`, { action: "leave", sessionId: bo.body.sessionId });
    expect((await call("tok-ana", "POST", `/api/local-voice/signals?${room}`, { toUserId: USERS["tok-bo"]!._id, kind: "offer", payload: "{}", sessionId: ana.body.sessionId, toSessionId: bo.body.sessionId })).status).toBe(400);
  });

  it("fences delayed call updates and leaves after the same person joins from another machine", async () => {
    const { call } = await start();
    const path = `/api/local-voice/participants?teamId=${TEAM}&room=${PROJECT}`;
    const first = await call("tok-ana", "POST", path, { action: "join", audioEnabled: true });
    const current = await call("tok-ana", "POST", path, { action: "join", audioEnabled: false });
    for (const action of ["update", "leave"]) {
      expect(await call("tok-ana", "POST", path, { action, audioEnabled: true, sessionId: first.body.sessionId })).toEqual({ status: 409, body: { error: "Rejoin the call to continue" } });
      expect((await call("tok-ana", "POST", path, { action })).status).toBe(409);
    }
    expect(first.body.sessionId).toBeTypeOf("string");
    expect(current.body.sessionId).not.toBe(first.body.sessionId);
    expect((await call("tok-ana", "GET", path)).body.participants).toEqual([expect.objectContaining({ sessionId: current.body.sessionId, audioEnabled: false })]);
    expect((await call("tok-ana", "POST", path, { action: "update", audioEnabled: true, sessionId: current.body.sessionId })).status).toBe(200);
    expect((await call("tok-ana", "POST", path, { action: "leave", sessionId: current.body.sessionId })).status).toBe(200);
    expect((await call("tok-ana", "GET", path)).body.participants).toEqual([]);
    expect((await call("tok-ana", "POST", path, { action: "unknown" })).status).toBe(400);
    expect((await call("tok-ana", "GET", path)).body.participants).toEqual([]);
  });

  it("keeps a replaced machine from consuming or sending the current call's signaling", async () => {
    const { call } = await start();
    const room = `teamId=${TEAM}&room=${PROJECT}`;
    const first = await call("tok-ana", "POST", `/api/local-voice/participants?${room}`, { action: "join" });
    const current = await call("tok-ana", "POST", `/api/local-voice/participants?${room}`, { action: "join" });
    const bo = await call("tok-bo", "POST", `/api/local-voice/participants?${room}`, { action: "join" });
    const body = { toUserId: USERS["tok-ana"]!._id, kind: "offer", payload: "{}", sessionId: bo.body.sessionId, toSessionId: current.body.sessionId };
    const sent = await call("tok-bo", "POST", `/api/local-voice/signals?${room}`, body);
    expect(sent.status).toBe(200);
    const signalId = sent.body.signal.id;
    expect((await call("tok-ana", "GET", `/api/local-voice/signals?${room}&sessionId=${first.body.sessionId}`)).status).toBe(409);
    expect((await call("tok-ana", "DELETE", `/api/local-voice/signals?${room}`, { signalIds: [signalId], sessionId: first.body.sessionId })).status).toBe(409);
    expect((await call("tok-ana", "POST", `/api/local-voice/signals?${room}`, { ...body, toUserId: USERS["tok-bo"]!._id, sessionId: first.body.sessionId, toSessionId: bo.body.sessionId })).status).toBe(409);
    expect((await call("tok-ana", "GET", `/api/local-voice/signals?${room}&sessionId=${current.body.sessionId}`)).body.signals.map((signal: { id: string }) => signal.id)).toEqual([signalId]);
    expect((await call("tok-bo", "POST", `/api/local-voice/signals?${room}`, { ...body, toSessionId: first.body.sessionId })).body.signal).toBeNull();
  });

  it("refuses a project from another workspace and a view-only member", async () => {
    const { call } = await start();
    expect((await call("tok-ana", "GET", `/api/local-voice/participants?teamId=${TEAM}&room=${FOREIGN_PROJECT}`)).status).toBe(400);
    const viewer = await call("tok-cy", "POST", `/api/local-voice/participants?teamId=${TEAM}&room=${PROJECT}`, { action: "join" });
    expect(viewer).toEqual({ status: 400, body: { error: "View-only workspace access" } });
  });

  it("keeps project viewers from joining calls even when they can write in the workspace", async () => {
    const { call } = await start({ projectRoles: { "tok-bo": "viewer" } });
    const room = `teamId=${TEAM}&room=${PROJECT}`;
    expect((await call("tok-bo", "GET", `/api/local-voice/participants?${room}`)).status).toBe(200);
    expect((await call("tok-bo", "POST", `/api/local-voice/participants?${room}`, { action: "join" })).status).toBe(400);
    expect((await call("tok-ana", "GET", `/api/local-voice/participants?${room}`)).body.participants).toEqual([]);
    expect((await call("tok-bo", "POST", `/api/local-voice/participants?teamId=${TEAM}`, { action: "join" })).status).toBe(200);
  });

  it("brings the project's chief into the call for people in it, with captions and audio that is never kept", async () => {
    const heard: number[] = [];
    const callAgents = createCallAgents({
      bot: (botId) => (botId === "chief" ? { id: "chief", name: "GGs" } : null),
      allowed: ({ botId, room }) => botId === "chief" && room === PROJECT,
      ask: async () => "On it.",
      summarize: async () => "{}",
      post: () => {},
      transcribe: async ({ audio }) => { heard.push(audio.length); return "hello team"; },
      settings: () => DEFAULT_CALL_AGENT_SETTINGS,
    });
    const { base, call } = await start({ callAgents });
    const room = `teamId=${TEAM}&room=${PROJECT}`;
    expect((await call("tok-ana", "POST", `/api/local-voice/agent?${room}`, { action: "join", botId: "chief" })).body).toEqual({ error: "Join the call first" });
    await call("tok-ana", "POST", `/api/local-voice/participants?${room}`, { action: "join", audioEnabled: true });
    expect((await call("tok-ana", "POST", `/api/local-voice/agent?teamId=${TEAM}`, { action: "join", botId: "chief" })).status).toBe(400);
    const joined = await call("tok-ana", "POST", `/api/local-voice/agent?${room}`, { action: "join", botId: "chief" });
    expect(joined.body.agent).toMatchObject({ name: "GGs", state: "listening" });
    const audio = await fetch(`${base}/api/local-voice/agent-audio?${room}&mime=audio%2Fwebm`, { method: "POST", headers: { "x-origin-session": "tok-ana" }, body: new Uint8Array(64) });
    expect(((await audio.json()) as { line: unknown }).line).toMatchObject({ speaker: "Ana", text: "hello team" });
    expect(heard).toEqual([64]);
    const seen = await call("tok-bo", "GET", `/api/local-voice/agent?${room}`);
    expect(seen.body.agent.name).toBe("GGs");
    expect(seen.body.lines.map((line: { text: string }) => line.text)).toEqual(["hello team"]);
    expect((await call("tok-bo", "POST", `/api/local-voice/agent?${room}`, { action: "line", text: "hi" })).body).toEqual({ error: "Join the call first" });
    expect((await call(null, "GET", `/api/local-voice/agent?${room}`)).status).toBe(401);
  });
});

describe("origin member chat", () => {
  it("keeps a project channel with edits, reactions, references and queued mentions", async () => {
    const notices: MentionNotice[] = [];
    const { call } = await start({ notices });
    const channel = `teamId=${TEAM}&conversation=project:${PROJECT}`;
    const posted = await call("tok-ana", "POST", `/api/local-chat/messages?${channel}`, {
      body: "Look at this", mentionUserIds: [USERS["tok-bo"]!._id], references: [{ type: "issue", projectId: PROJECT, id: "task0000000001" }],
    });
    expect(posted.status).toBe(200);
    expect(posted.body.message.references).toEqual([{ type: "issue", projectId: PROJECT, id: "task0000000001", label: "Fix login" }]);
    await new Promise((done) => setTimeout(done, 20));
    expect(notices).toEqual([{ teamId: TEAM, actorId: USERS["tok-ana"]!._id, messageId: posted.body.message.id, userIds: [USERS["tok-bo"]!._id], conversation: `project:${PROJECT}`, preview: "Look at this" }]);

    const id = posted.body.message.id;
    expect((await call("tok-bo", "PATCH", `/api/local-chat/messages?${channel}`, { id, body: "hijack" })).status).toBe(400);
    expect((await call("tok-bo", "PATCH", `/api/local-chat/messages?${channel}`, { id, reaction: "heart" })).body.message.reactions).toEqual({ heart: [USERS["tok-bo"]!._id] });
    expect((await call("tok-ana", "PATCH", `/api/local-chat/messages?${channel}`, { id, body: "Edited" })).body.message.body).toBe("Edited");
    expect((await call("tok-bo", "GET", `/api/local-chat/messages?${channel}`)).body.messages.map((m: { body: string }) => m.body)).toEqual(["Edited"]);
    expect((await call("tok-bo", "GET", `/api/local-chat/messages?teamId=${TEAM}`)).body.messages).toEqual([]);
    expect((await call("tok-bo", "GET", `/api/local-chat/messages?${channel}&search=edit`)).body.messages).toHaveLength(1);
    expect((await call("tok-ana", "PATCH", `/api/local-chat/messages?${channel}`, { id, delete: true })).body.message).toBeNull();
    expect((await call("tok-ana", "POST", `/api/local-chat/messages?${channel}`, { body: "hi", mentionUserIds: ["user00000stranger"] })).status).toBe(400);
  });

  it("delivers each queued mention once while several messages flush at the same time", async () => {
    const notices: MentionNotice[] = [];
    const { call } = await start({ notices, delayMs: 30 });
    const channel = `teamId=${TEAM}&conversation=project:${PROJECT}`;
    const mention = { mentionUserIds: [USERS["tok-bo"]!._id] };
    const sent = await Promise.all(["one", "two", "three"].map((body) => call("tok-ana", "POST", `/api/local-chat/messages?${channel}`, { body, ...mention })));
    await new Promise((done) => setTimeout(done, 200));
    expect(notices.map((notice) => notice.messageId).sort()).toEqual(sent.map((answer) => answer.body.message.id).sort());
  });

  it("opens direct conversations only between members and counts unread", async () => {
    const { call } = await start();
    expect((await call("tok-ana", "POST", `/api/local-chat/conversations?teamId=${TEAM}`, { recipientId: "user00000stranger" })).status).toBe(400);
    const opened = await call("tok-ana", "POST", `/api/local-chat/conversations?teamId=${TEAM}`, { recipientId: USERS["tok-bo"]!._id });
    const dm = `teamId=${TEAM}&conversation=${encodeURIComponent(opened.body.conversationId)}`;
    const message = await call("tok-ana", "POST", `/api/local-chat/messages?${dm}`, { body: "psst" });
    expect((await call("tok-cy", "GET", `/api/local-chat/messages?${dm}`)).status).toBe(400);
    const listed = await call("tok-bo", "GET", `/api/local-chat/conversations?teamId=${TEAM}`);
    expect(listed.body.conversations).toMatchObject([{ otherUserId: USERS["tok-ana"]!._id, unread: 1 }]);
    await call("tok-bo", "PATCH", `/api/local-chat/conversations?${dm}`, { messageId: message.body.message.id });
    expect((await call("tok-bo", "GET", `/api/local-chat/conversations?teamId=${TEAM}`)).body.conversations[0].unread).toBe(0);
  });

  it("keeps project viewers from writing or changing project chat while retaining workspace chat access", async () => {
    const { call } = await start({ projectRoles: { "tok-bo": "viewer" } });
    const channel = `teamId=${TEAM}&conversation=project:${PROJECT}`;
    const sent = await call("tok-ana", "POST", `/api/local-chat/messages?${channel}`, { body: "Project update" });
    expect((await call("tok-bo", "GET", `/api/local-chat/messages?${channel}`)).body.messages).toHaveLength(1);
    expect((await call("tok-bo", "POST", `/api/local-chat/messages?${channel}`, { body: "Viewer write" })).status).toBe(400);
    expect((await call("tok-bo", "PATCH", `/api/local-chat/messages?${channel}`, { id: sent.body.message.id, pinned: true })).status).toBe(400);
    const messages = (await call("tok-ana", "GET", `/api/local-chat/messages?${channel}`)).body.messages;
    expect(messages).toHaveLength(1);
    expect(messages[0].pinned).toBeUndefined();
    expect((await call("tok-bo", "POST", `/api/local-chat/messages?teamId=${TEAM}`, { body: "Workspace update" })).status).toBe(200);
  });

  it("notifies a direct message's other participant and refuses mentions of anyone else there", async () => {
    const notices: MentionNotice[] = [];
    const { call } = await start({ notices });
    const opened = await call("tok-ana", "POST", `/api/local-chat/conversations?teamId=${TEAM}`, { recipientId: USERS["tok-bo"]!._id });
    const dm = `teamId=${TEAM}&conversation=${encodeURIComponent(opened.body.conversationId)}`;
    expect((await call("tok-ana", "POST", `/api/local-chat/messages?${dm}`, { body: "@Cy look", mentionUserIds: [USERS["tok-cy"]!._id] })).status).toBe(400);
    const sent = await call("tok-ana", "POST", `/api/local-chat/messages?${dm}`, { body: "@Bo look", mentionUserIds: [USERS["tok-bo"]!._id] });
    await new Promise((done) => setTimeout(done, 20));
    expect(notices).toEqual([{ teamId: TEAM, actorId: USERS["tok-ana"]!._id, messageId: sent.body.message.id, userIds: [USERS["tok-bo"]!._id], conversation: opened.body.conversationId, preview: "@Bo look" }]);
  });

  it("limits how often one person can mention others", async () => {
    const { call } = await start({ notices: [] });
    const channel = `teamId=${TEAM}`;
    const statuses: number[] = [];
    for (let i = 0; i < 22; i += 1) statuses.push((await call("tok-ana", "POST", `/api/local-chat/messages?${channel}`, { body: `@Bo ${i}`, mentionUserIds: [USERS["tok-bo"]!._id] })).status);
    expect(statuses.slice(0, 20).every((status) => status === 200)).toBe(true);
    expect(statuses.at(-1)).toBe(400);
  });

  it("uploads a file, attaches it, and serves it only inside its conversation", async () => {
    const { base, call } = await start();
    const channel = `teamId=${TEAM}&conversation=project:${PROJECT}`;
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }), "dot.png");
    const uploaded = await fetch(`${base}/api/local-chat/files?${channel}&projectId=${PROJECT}`, { method: "POST", headers: { "x-origin-session": "tok-ana" }, body: form }).then((r) => r.json() as Promise<{ file: { id: string } }>);
    expect(uploaded.file).toMatchObject({ name: "dot.png", contentType: "image/png", size: 4, projectId: PROJECT });
    const sent = await call("tok-ana", "POST", `/api/local-chat/messages?${channel}`, { attachmentIds: [uploaded.file.id] });
    expect(sent.body.message.attachments).toHaveLength(1);
    const download = await fetch(`${base}/api/local-chat/files?${channel}&id=${uploaded.file.id}`, { headers: { "x-origin-session": "tok-bo" } });
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));
    expect((await fetch(`${base}/api/local-chat/files?teamId=${TEAM}&id=${uploaded.file.id}`, { headers: { "x-origin-session": "tok-bo" } })).status).toBe(404);
  });
});

describe("convexMentionNotifier", () => {
  const notice: MentionNotice = { teamId: TEAM, actorId: "user000000000a", messageId: "m1", userIds: ["user000000000b"], conversation: "", preview: "hi" };
  afterEach(() => vi.unstubAllGlobals());

  it("signs the notice for the deployment's site, derived from the connected Convex address", async () => {
    const fetchMock = vi.fn(async () => new Response("null", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const secret = "s".repeat(32);
    await convexMentionNotifier({ ORIGIN_INTEGRATION_SECRET: secret }, () => "http://127.0.0.1:3210")!(notice);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:3211/integrations");
    const body = String(init.body);
    expect(JSON.parse(body)).toMatchObject({ operation: "chatMentions", args: notice });
    expect((init.headers as Record<string, string>)["x-origin-signature"]).toBe(createHmac("sha256", secret).update(body).digest("hex"));
  });

  it("drops a notice the deployment refuses and retries one it could not reach", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const notify = convexMentionNotifier({ ORIGIN_INTEGRATION_SECRET: "s".repeat(32), ORIGIN_CONVEX_SITE_URL: "https://site.example" }, () => null)!;
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 400 })));
    await expect(notify(notice)).resolves.toBeUndefined();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    await expect(notify(notice)).rejects.toThrow(/503/);
    expect(convexMentionNotifier({ ORIGIN_INTEGRATION_SECRET: "short" }, () => null)).toBeNull();
  });
});

describe("releases", () => {
  it("serves the What's new history", async () => {
    const { call } = await start();
    expect((await call(null, "GET", "/api/releases")).body).toEqual(releases);
  });
});
