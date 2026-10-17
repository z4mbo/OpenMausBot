import type { MemberCallSignalKind } from "./origin-realtime";

export type CallTileRef = { id: string; screenSharing?: boolean };

export const SELF_CAMERA = "self:camera";
export const SELF_SCREEN = "self:screen";

export function isScreenTrack(transceivers: readonly { receiver: { track: { kind: string } } }[], track: { kind: string }): boolean {
  return track.kind === "video" && transceivers.find((item) => item.receiver.track.kind === "video")?.receiver.track !== track;
}

export function selectCallFocus(tiles: readonly CallTileRef[], current: string | null, previousScreens: ReadonlySet<string>): string | null {
  const screens = tiles.filter((tile) => tile.screenSharing);
  const newScreen = screens.find((tile) => !previousScreens.has(tile.id));
  if (newScreen) return newScreen.id;
  if (tiles.some((tile) => tile.id === current)) return current;
  return screens[0]?.id ?? tiles.find((tile) => tile.id !== SELF_CAMERA)?.id ?? tiles[0]?.id ?? null;
}

export function formatElapsed(seconds: number): string {
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

type Negotiable = Pick<RTCPeerConnection, "signalingState" | "localDescription" | "remoteDescription" | "setLocalDescription" | "setRemoteDescription" | "createOffer" | "createAnswer" | "addIceCandidate">;

/** WebRTC "perfect negotiation": SDP work is serialized, the polite side yields on glare, early candidates wait for the remote description. */
export function createCallSignaling(connection: Negotiable, polite: boolean, send: (kind: MemberCallSignalKind, payload: string) => Promise<void>) {
  let queue: Promise<unknown> = Promise.resolve();
  let disposed = false;
  let ignoreOffer = false;
  const candidates: RTCIceCandidateInit[] = [];
  const enqueue = (work: () => Promise<void>) => {
    const result = queue.catch(() => {}).then(async () => { if (!disposed && connection.signalingState !== "closed") await work(); });
    queue = result;
    return result;
  };
  return {
    offer: (restart = false) => enqueue(async () => {
      if (restart && connection.signalingState === "have-local-offer") await connection.setLocalDescription({ type: "rollback" });
      if (connection.signalingState !== "stable") return;
      await connection.setLocalDescription(await connection.createOffer(restart ? { iceRestart: true } : undefined));
      if (!disposed && connection.localDescription) await send("offer", JSON.stringify(connection.localDescription));
    }),
    receive: (kind: MemberCallSignalKind, payload: string) => enqueue(async () => {
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
      for (const candidate of candidates.splice(0)) await connection.addIceCandidate(candidate).catch(() => {});
      if (kind === "offer") {
        await connection.setLocalDescription(await connection.createAnswer());
        if (!disposed && connection.localDescription) await send("answer", JSON.stringify(connection.localDescription));
      }
    }),
    dispose: () => {
      disposed = true;
      candidates.length = 0;
    },
  };
}

export type CallSignaling = ReturnType<typeof createCallSignaling>;
