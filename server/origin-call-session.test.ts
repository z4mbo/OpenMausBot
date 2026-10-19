import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openRealtimeStore } from "./origin-realtime-store.ts";

const scope = { user: { userId: "fixture-user", teamId: "fixture-team", name: "Fixture user", email: "fixture@example.test", role: "member" }, room: "fixture-room" };
const media = { audioEnabled: true, videoEnabled: false, screenSharing: false };
const fixtures: { directory: string; store: ReturnType<typeof openRealtimeStore> }[] = [];
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "omb-call-session-"));
  let now = 100_000;
  const store = openRealtimeStore(join(directory, "realtime.sqlite"), () => now);
  fixtures.push({ directory, store });
  return { store, advance: (ms: number) => { now += ms; } };
}
afterEach(() => {
  for (const { directory, store } of fixtures.splice(0)) {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("member call presence ownership", () => {
  it("does not let a replaced machine overwrite or remove the active call session", () => {
    const { store } = fixture();
    const first = store.join(scope, media);
    const current = store.join(scope, { ...media, audioEnabled: false });
    expect(() => store.heartbeat(scope, media, first.sessionId)).toThrow("Rejoin the call to continue");
    expect(() => store.leave(scope, first.sessionId)).toThrow("Rejoin the call to continue");
    expect(first.sessionId).toBeTypeOf("string");
    expect(current.sessionId).not.toBe(first.sessionId);
    expect(store.participants(scope)).toEqual([current]);
    expect(store.heartbeat(scope, media, current.sessionId).sessionId).toBe(current.sessionId);
    store.leave(scope, current.sessionId);
    expect(store.participants(scope)).toEqual([]);
  });

  it("never revives expired presence from an old heartbeat", () => {
    const { store, advance } = fixture();
    const first = store.join(scope, media);
    advance(30_001);
    expect(() => store.heartbeat(scope, media, first.sessionId)).toThrow("Rejoin the call to continue");
    expect(store.participants(scope)).toEqual([]);
  });

  it("requires a session marker even from older clients and gives a new join a unique identity in the same millisecond", () => {
    const { store } = fixture();
    const first = store.join(scope, media);
    expect(() => store.heartbeat(scope, media)).toThrow("Rejoin the call to continue");
    expect(() => store.leave(scope)).toThrow("Rejoin the call to continue");
    store.leave(scope, first.sessionId);
    const second = store.join(scope, media);
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(() => store.leave(scope, first.sessionId)).toThrow("Rejoin the call to continue");
    expect(store.participants(scope)).toEqual([second]);
  });
});
