// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemberCallHost, type MemberCallState } from "./CallPage";
import { currentMemberCall, endMemberCall, memberCallKey, startMemberCall, useMemberCallState } from "@/lib/member-call-session";
import { OriginRealtimeError } from "@/lib/origin-realtime";

const fixture = vi.hoisted(() => ({ request: vi.fn(), participants: [] as { userId: string; name: string; email: string; joinedAt: number; lastSeenAt: number; sessionId: string; audioEnabled: boolean; videoEnabled: boolean }[] }));
vi.mock("@/lib/origin-realtime", () => ({
  originRealtime: (...args: unknown[]) => fixture.request(...args),
  OriginRealtimeError: class extends Error { constructor(message: string, public status: number) { super(message); } },
  usePolled: () => ({ value: fixture.participants, error: "", refresh() {} }),
}));
vi.mock("@/lib/call-agent", () => ({ useCallAgent: () => ({ participant: null }) }));
vi.mock("@/lib/audio-level", () => ({ SPEAKING_LEVEL: 0.1, watchAudioLevel: () => () => {} }));
vi.mock("@/state/store", () => ({ useStore: () => ({ state: { bots: [] } }) }));

class FakeStream {
  constructor(private tracks: MediaStreamTrack[] = []) {}
  getTracks() { return this.tracks; }
  getAudioTracks() { return this.tracks.filter((track) => track.kind === "audio"); }
  getVideoTracks() { return this.tracks.filter((track) => track.kind === "video"); }
  addTrack(track: MediaStreamTrack) { this.tracks.push(track); }
  removeTrack(track: MediaStreamTrack) { this.tracks = this.tracks.filter((current) => current !== track); }
}

let root: Root;
let container: HTMLElement;
let call: MemberCallState | null;
function Probe() {
  call = useMemberCallState<MemberCallState>();
  return null;
}
function join(room: string) {
  const target = { teamId: "fixture-team", room };
  flushSync(() => startMemberCall({ key: memberCallKey(target), target, me: { _id: "fixture-user", name: "Fixture user", email: "fixture@example.test" }, name: room,
    media: { audioEnabled: false, videoEnabled: false, audioDevice: "", videoDevice: "" }, open() {} }));
}
beforeEach(() => {
  call = null;
  fixture.participants = [];
  let joinedAt = 0;
  fixture.request.mockReset().mockImplementation(async (path: string, _target: unknown, options?: { json?: { action?: string } }) => {
    if (path.endsWith("/config")) return { iceServers: [] };
    if (options?.json?.action === "join") return { joinedAt: ++joinedAt, sessionId: `fixture-session-${joinedAt}` };
    if (path.endsWith("/signals")) return { signals: [] };
    return {};
  });
  vi.stubGlobal("MediaStream", FakeStream);
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn(async () => new FakeStream()) } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  flushSync(() => root.render(createElement("div", null, createElement(MemberCallHost), createElement(Probe))));
});
afterEach(() => {
  flushSync(() => root.unmount());
  const config = currentMemberCall();
  if (config) endMemberCall(config.nonce);
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("member call session ownership", () => {
  it("keeps a replacement call after the previous call's delayed leave completes", async () => {
    join("first");
    await vi.waitFor(() => expect(call?.inCall).toBe(true));
    const first = call!;
    let finishLeave!: () => void;
    fixture.request.mockImplementationOnce(() => new Promise<void>((resolve) => { finishLeave = resolve; }));
    const leaving = first.leaveCall();
    join("second");
    await vi.waitFor(() => expect(call?.key).toBe("fixture-team:second"));
    await vi.waitFor(() => expect(call?.inCall).toBe(true));
    finishLeave();
    await leaving;
    expect(currentMemberCall()?.key).toBe("fixture-team:second");
    await vi.waitFor(() => expect(call?.inCall).toBe(true));
  });

  it("ends the local call when another machine has replaced its server session", async () => {
    fixture.request.mockImplementation(async (path: string, _target: unknown, options?: { json?: { action?: string; sessionId?: string }; query?: { sessionId?: string } }) => {
      if (path.endsWith("/config")) return { iceServers: [] };
      if (options?.json?.action === "join") return { joinedAt: 1, sessionId: "fixture-session" };
      if (options?.json?.action === "update") {
        expect(options.json.sessionId).toBe("fixture-session");
        throw new OriginRealtimeError("Rejoin the call to continue", 409);
      }
      if (path.endsWith("/signals")) {
        expect(options?.query?.sessionId).toBe("fixture-session");
        return { signals: [] };
      }
      return {};
    });
    join("first");
    await vi.waitFor(() => expect(fixture.request.mock.calls.some(([, , options]) => options?.json?.action === "update")).toBe(true));
    await vi.waitFor(() => expect(currentMemberCall()).toBeNull());
    expect(fixture.request.mock.calls.some(([, , options]) => options?.json?.action === "leave" && options.json.sessionId === "fixture-session")).toBe(true);
  });

  it("cleans up a late join response using that abandoned session's own identity", async () => {
    let finishJoin!: (presence: { joinedAt: number; sessionId: string }) => void;
    fixture.request.mockImplementation(async (path: string, target: { room: string }, options?: { json?: { action?: string } }) => {
      if (path.endsWith("/config")) return { iceServers: [] };
      if (options?.json?.action === "join") {
        if (target.room === "first") return new Promise((resolve) => { finishJoin = resolve; });
        return { joinedAt: 2, sessionId: "new-session" };
      }
      if (path.endsWith("/signals")) return { signals: [] };
      return {};
    });
    join("first");
    await vi.waitFor(() => expect(finishJoin).toBeTypeOf("function"));
    join("second");
    await vi.waitFor(() => expect(call?.inCall).toBe(true));
    finishJoin({ joinedAt: 1, sessionId: "abandoned-session" });
    await vi.waitFor(() => expect(fixture.request.mock.calls.some(([, target, options]) => target.room === "first" && options?.json?.action === "leave" && options.json.sessionId === "abandoned-session")).toBe(true));
    expect(currentMemberCall()?.key).toBe("fixture-team:second");
  });

});
