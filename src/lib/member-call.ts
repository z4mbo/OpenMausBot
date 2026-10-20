import type { MemberCallSignalKind } from "./origin-realtime";

export const SELF_CAMERA = "self:camera";
export const SELF_SCREEN = "self:screen";

export function isScreenTrack(transceivers: readonly { receiver: { track: { kind: string } } }[], track: { kind: string }): boolean {
  return track.kind === "video" && transceivers.find((item) => item.receiver.track.kind === "video")?.receiver.track !== track;
}

export const CALL_REACTIONS = ["👍", "❤️", "🎉", "😂", "👏", "🤔"] as const;
export type CallReaction = (typeof CALL_REACTIONS)[number];

/** What call members send each other over the call's data channel. */
export type CallChannelMessage = { kind: "reaction"; emoji: CallReaction } | { kind: "hand"; up: boolean };

/** Another member's data is untrusted: anything but a known reaction or a hand flag is dropped. */
export function parseCallMessage(data: unknown): CallChannelMessage | null {
  if (typeof data !== "string" || data.length > 200) return null;
  let value: unknown;
  try { value = JSON.parse(data); } catch { return null; }
  if (!value || typeof value !== "object") return null;
  const message = value as Record<string, unknown>;
  if (message.kind === "reaction" && (CALL_REACTIONS as readonly unknown[]).includes(message.emoji)) return { kind: "reaction", emoji: message.emoji as CallReaction };
  if (message.kind === "hand" && typeof message.up === "boolean") return { kind: "hand", up: message.up };
  return null;
}

/** How many columns a gallery of `count` tiles uses in a stage `width` pixels wide. */
export function galleryColumns(count: number, width: number): number {
  if (count <= 1) return 1;
  const most = width < 560 ? 2 : width < 1000 ? 3 : 4;
  return Math.min(most, Math.ceil(Math.sqrt(count)), count);
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
