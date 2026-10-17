import { describe, expect, it } from "vitest";
import { createCallSignaling, formatElapsed, galleryColumns, isScreenTrack, parseCallMessage, selectCallFocus } from "./member-call";

type Description = { type: string; sdp?: string };

function fakeConnection(name: string) {
  const log: string[] = [];
  const connection = {
    signalingState: "stable" as RTCSignalingState,
    localDescription: null as Description | null,
    remoteDescription: null as Description | null,
    async createOffer() { return { type: "offer", sdp: `${name}-offer` }; },
    async createAnswer() { return { type: "answer", sdp: `${name}-answer` }; },
    async setLocalDescription(description: Description) {
      log.push(`local:${description.type}`);
      if (description.type === "rollback") { connection.signalingState = "stable"; connection.localDescription = null; return; }
      connection.localDescription = description;
      connection.signalingState = description.type === "offer" ? "have-local-offer" : "stable";
    },
    async setRemoteDescription(description: Description) {
      log.push(`remote:${description.type}`);
      connection.remoteDescription = description;
      connection.signalingState = description.type === "offer" ? "have-remote-offer" : "stable";
    },
    async addIceCandidate(candidate: RTCIceCandidateInit) { log.push(`candidate:${candidate.candidate}`); },
  };
  return { connection: connection as unknown as RTCPeerConnection, log };
}

describe("selectCallFocus", () => {
  it("jumps to a newly shared screen, then keeps the chosen tile, then prefers someone else's camera", () => {
    const tiles = [{ id: "self:camera" }, { id: "bo:camera" }, { id: "bo:screen", screenSharing: true }];
    expect(selectCallFocus(tiles, "self:camera", new Set())).toBe("bo:screen");
    expect(selectCallFocus(tiles, "self:camera", new Set(["bo:screen"]))).toBe("self:camera");
    expect(selectCallFocus(tiles.slice(0, 2), null, new Set())).toBe("bo:camera");
    expect(selectCallFocus([], null, new Set())).toBeNull();
  });
});

describe("isScreenTrack", () => {
  it("treats any video track after the first video transceiver as a screen", () => {
    const camera = { kind: "video" };
    const screen = { kind: "video" };
    const transceivers = [{ receiver: { track: { kind: "audio" } } }, { receiver: { track: camera } }, { receiver: { track: screen } }];
    expect(isScreenTrack(transceivers, camera)).toBe(false);
    expect(isScreenTrack(transceivers, screen)).toBe(true);
    expect(isScreenTrack(transceivers, { kind: "audio" })).toBe(false);
  });
});

describe("createCallSignaling", () => {
  it("answers an offer and applies candidates that arrived before it", async () => {
    const { connection, log } = fakeConnection("bo");
    const sent: string[] = [];
    const signaling = createCallSignaling(connection, true, async (kind, payload) => { sent.push(`${kind}:${JSON.parse(payload).sdp}`); });
    await signaling.receive("candidate", JSON.stringify({ candidate: "c1" }));
    await signaling.receive("offer", JSON.stringify({ type: "offer", sdp: "ana-offer" }));
    expect(log).toEqual(["remote:offer", "candidate:c1", "local:answer"]);
    expect(sent).toEqual(["answer:bo-answer"]);
  });

  it("lets the impolite side ignore a colliding offer and the polite side roll back", async () => {
    const impolite = fakeConnection("ana");
    const ana = createCallSignaling(impolite.connection, false, async () => {});
    await ana.offer();
    await ana.receive("offer", JSON.stringify({ type: "offer", sdp: "bo-offer" }));
    expect(impolite.log).toEqual(["local:offer"]);

    const polite = fakeConnection("bo");
    const sent: string[] = [];
    const bo = createCallSignaling(polite.connection, true, async (kind) => { sent.push(kind); });
    await bo.offer();
    await bo.offer(true);
    expect(polite.log).toEqual(["local:offer", "local:rollback", "local:offer"]);
    expect(sent).toEqual(["offer", "offer"]);
  });

  it("rejects a description whose type does not match its signal", async () => {
    const { connection } = fakeConnection("bo");
    const signaling = createCallSignaling(connection, true, async () => {});
    await expect(signaling.receive("offer", JSON.stringify({ type: "answer" }))).rejects.toThrow("Invalid call description");
  });
});

describe("formatElapsed", () => {
  it("shows minutes and seconds", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(754)).toBe("12:34");
  });
});

describe("call channel messages", () => {
  it("keeps known reactions and hand flags", () => {
    expect(parseCallMessage(JSON.stringify({ kind: "reaction", emoji: "🎉" }))).toEqual({ kind: "reaction", emoji: "🎉" });
    expect(parseCallMessage(JSON.stringify({ kind: "hand", up: true }))).toEqual({ kind: "hand", up: true });
  });

  it("drops anything else", () => {
    expect(parseCallMessage(JSON.stringify({ kind: "reaction", emoji: "<img src=x>" }))).toBeNull();
    expect(parseCallMessage(JSON.stringify({ kind: "hand", up: "yes" }))).toBeNull();
    expect(parseCallMessage("not json")).toBeNull();
    expect(parseCallMessage(new ArrayBuffer(4))).toBeNull();
    expect(parseCallMessage("x".repeat(500))).toBeNull();
  });
});

describe("gallery columns", () => {
  it("grows towards a square and caps by width", () => {
    expect(galleryColumns(1, 1200)).toBe(1);
    expect(galleryColumns(2, 1200)).toBe(2);
    expect(galleryColumns(4, 1200)).toBe(2);
    expect(galleryColumns(5, 1200)).toBe(3);
    expect(galleryColumns(8, 400)).toBe(2);
  });
});
