type SignalKind = "offer" | "answer" | "candidate";

// Serialize SDP changes and use WebRTC's polite/impolite negotiation pattern.
// This also handles simultaneous reconnects and candidates arriving before SDP.
export function createCallSignaling(connection: RTCPeerConnection, polite: boolean, send: (kind: SignalKind, payload: string) => Promise<void>) {
  let queue: Promise<unknown> = Promise.resolve();
  let disposed = false, ignoreOffer = false;
  const candidates: RTCIceCandidateInit[] = [];
  const enqueue = (work: () => Promise<void>) => {
    const result = queue.catch(() => {}).then(async () => { if (!disposed && connection.signalingState !== "closed") await work(); });
    queue = result; return result;
  };
  return {
    offer: (restart = false) => enqueue(async () => {
      // A restart replaces an offer that never got an answer (for example, a lost signal).
      if (restart && connection.signalingState === "have-local-offer") await connection.setLocalDescription({ type: "rollback" });
      if (connection.signalingState !== "stable") return;
      await connection.setLocalDescription(await connection.createOffer(restart ? { iceRestart: true } : undefined));
      if (!disposed && connection.localDescription) await send("offer", JSON.stringify(connection.localDescription));
    }),
    receive: (kind: SignalKind, payload: string) => enqueue(async () => {
      if (kind === "candidate") {
        if (ignoreOffer) return;
        const candidate = JSON.parse(payload) as RTCIceCandidateInit;
        if (connection.remoteDescription) await connection.addIceCandidate(candidate);
        else if (candidates.length < 120) candidates.push(candidate);
        return;
      }
      const description = JSON.parse(payload) as RTCSessionDescriptionInit;
      if (description.type !== kind) throw new Error("Invalid call description");
      const collision = kind === "offer" && connection.signalingState !== "stable";
      ignoreOffer = !polite && collision;
      if (ignoreOffer || (kind === "answer" && connection.signalingState !== "have-local-offer")) return;
      await connection.setRemoteDescription(description);
      // A candidate from an abandoned ICE generation must not prevent the answer.
      for (const candidate of candidates.splice(0)) await connection.addIceCandidate(candidate).catch(() => {});
      if (kind === "offer") {
        await connection.setLocalDescription(await connection.createAnswer());
        if (!disposed && connection.localDescription) await send("answer", JSON.stringify(connection.localDescription));
      }
    }),
    dispose: () => { disposed = true; candidates.length = 0; },
  };
}
