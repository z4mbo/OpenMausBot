import assert from "node:assert/strict";
import { createCallSignaling } from "../lib/call-signaling";

class Peer {
  signalingState = "stable";
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  candidates: unknown[] = [];
  restarts = 0;
  async createOffer(options?: RTCOfferOptions) { if (options?.iceRestart) this.restarts++; return { type: "offer", sdp: "offer" }; }
  async createAnswer() { return { type: "answer", sdp: "answer" }; }
  async setLocalDescription(description: RTCSessionDescriptionInit) { this.localDescription = description; this.signalingState = description.type === "offer" ? "have-local-offer" : "stable"; }
  async setRemoteDescription(description: RTCSessionDescriptionInit) { this.remoteDescription = description; this.signalingState = description.type === "offer" ? "have-remote-offer" : "stable"; }
  async addIceCandidate(candidate: RTCIceCandidateInit) { assert.ok(this.remoteDescription, "Candidates wait for remote SDP"); this.candidates.push(candidate); }
}

async function main() {
  const a = new Peer(), b = new Peer();
  const sentA: { kind: "offer" | "answer" | "candidate"; body: string }[] = [], sentB: typeof sentA = [];
  const left = createCallSignaling(a as unknown as RTCPeerConnection, false, async (kind, body) => { sentA.push({ kind, body }); });
  const right = createCallSignaling(b as unknown as RTCPeerConnection, true, async (kind, body) => { sentB.push({ kind, body }); });
  await right.receive("candidate", JSON.stringify({ candidate: "early" }));
  await Promise.all([left.offer(), right.offer()]);
  await left.receive("offer", sentB.shift()!.body);
  assert.equal(a.signalingState, "have-local-offer", "Impolite peer keeps its offer during collision");
  await right.receive("offer", sentA.shift()!.body);
  assert.equal(b.signalingState, "stable", "Polite peer rolls back and answers");
  assert.equal(b.candidates.length, 1);
  await left.receive("answer", sentB.shift()!.body);
  assert.equal(a.signalingState, "stable");
  await left.offer(true);
  assert.equal(a.restarts, 1);
  await right.receive("offer", sentA.shift()!.body);
  await left.receive("answer", sentB.shift()!.body);
  assert.equal(a.signalingState, "stable");
  await Promise.all([right.receive("candidate", '{"candidate":"one"}'), right.receive("candidate", '{"candidate":"two"}')]);
  assert.equal(b.candidates.length, 3);
  right.dispose(); await right.offer(); assert.equal(sentB.length, 0);
  console.log("PASS simultaneous offers, polite rollback, early candidates, serialized signals, ICE restart and disposal");
}
void main();
