import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  Camera, Hand, LayoutGrid, Loader2, Maximize2, Mic, MicOff, MonitorOff, MonitorUp, PhoneOff, Pin, PinOff,
  Settings2, SmilePlus, UserPlus, UserMinus, Users, Video, VideoOff, Volume2, X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useCloudSession } from "@/lib/origin-cloud";
import type { CloudUser } from "@/lib/origin-cloud";
import { SPEAKING_LEVEL, watchAudioLevel } from "@/lib/audio-level";
import {
  CALL_REACTIONS, createCallSignaling, formatElapsed, galleryColumns, isScreenTrack, parseCallMessage, SELF_CAMERA, SELF_SCREEN,
  type CallChannelMessage, type CallReaction, type CallSignaling,
} from "@/lib/member-call";
import { OriginRealtimeError, originRealtime, usePolled, type MemberCallParticipant, type MemberCallSignal, type MemberCallSignalKind, type RealtimeTarget } from "@/lib/origin-realtime";
import { useCallAgent, type CallAgentParticipant } from "@/lib/call-agent";
import {
  endMemberCall, memberCallKey, publishMemberCallState, showingCallPage, startMemberCall, useMemberCallConfig, useMemberCallFailure, useMemberCallState,
  type MemberCallConfig, type MemberCallMedia,
} from "@/lib/member-call-session";
import { CallAgentBadge, CallAgentCaptions } from "./CallAgentOverlay";
import { useStore, type Bot } from "@/state/store";
import { Select } from "../Select";
import { BotAvatar } from "../Avatar";
import { CloudGate, EmptyState, Notice, ghostButton, iconButton, primaryButton, type OriginPageProps } from "./ui";
import { PersonAvatar } from "./PersonAvatar";

type Person = { userId: string; name: string; username?: string; email: string; avatarUrl?: string | null };
type RemoteMedia = { stream: MediaStream; screen: MediaStream };
type Tile = {
  id: string; userId: string; stream?: MediaStream; person: Person; label: string; audioEnabled: boolean; videoEnabled: boolean; screenSharing?: boolean; self?: boolean;
  agent?: { bot: Bot; state: CallAgentParticipant["state"] };
};
type Burst = { id: number; emoji: CallReaction; name: string; drift: number };
type Arrival = { id: number; name: string; person: Person; joined: boolean };

const PARTICIPANT_POLL_MS = 2_000;
const SIGNAL_POLL_MS = 1_200;
const HEARTBEAT_MS = 8_000;
const RESTART_CHECK_MS = 10_000;
const MAX_RESTARTS = 4;
const BURST_MS = 2_400;
const BADGE_MS = 3_000;
const ARRIVAL_MS = 3_200;

const PARTICIPANTS = "/api/local-voice/participants";
const SIGNALS = "/api/local-voice/signals";
const CONFIG = "/api/local-voice/config";

/** `agent` is the one agent this call can bring in: the project's chief. */
export function CallPage({ agent, open, ...props }: OriginPageProps & { agent?: Bot; open(): void }) {
  const session = useCloudSession();
  return (
    <CloudGate {...props} label="Calls">
      {({ project, projectId, canEdit }) => session.user && project.teamId
        ? <MemberCall key={projectId} target={{ teamId: project.teamId, room: projectId }} me={session.user} canJoin={canEdit} name={project.name} agent={agent} open={open} />
        : <EmptyState icon={<PhoneOff size={22} />} title="Share this project to call your team" />}
    </CloudGate>
  );
}

const personOf = (user: CloudUser): Person => ({ userId: user._id, name: user.name || user.email, ...(user.username ? { username: user.username } : {}), email: user.email });
const displayName = (person: Person) => person.username || person.name || person.email;

function videoSender(connection: RTCPeerConnection, index: number) {
  return connection.getTransceivers().filter((transceiver) => transceiver.receiver.track.kind === "video")[index]?.sender;
}

function useAudioLevel(stream: MediaStream | null | undefined, active: boolean): number {
  const [level, setLevel] = useState(0);
  const trackId = stream?.getAudioTracks()[0]?.id;
  useEffect(() => {
    if (!stream || !active || !trackId) {
      setLevel(0);
      return;
    }
    return watchAudioLevel(stream, (next) => setLevel((previous) => (Math.abs(previous - next) < 0.02 ? previous : next)));
  }, [stream, trackId, active]);
  return level;
}

function useMediaDevices() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    let live = true;
    const refresh = () => navigator.mediaDevices?.enumerateDevices().then((found) => { if (live) setDevices(found); }).catch(() => {});
    void refresh();
    navigator.mediaDevices?.addEventListener("devicechange", refresh);
    return () => { live = false; navigator.mediaDevices?.removeEventListener("devicechange", refresh); };
  }, []);
  const refresh = () => navigator.mediaDevices?.enumerateDevices().then(setDevices).catch(() => {});
  return {
    microphones: devices.filter((device) => device.kind === "audioinput" && device.deviceId && device.deviceId !== "default"),
    cameras: devices.filter((device) => device.kind === "videoinput" && device.deviceId),
    refresh,
  };
}

async function captureMedia(audio: boolean, video: boolean, audioDevice: string, videoDevice: string): Promise<MediaStream> {
  if (!audio && !video) return new MediaStream();
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: audio ? { ...(audioDevice ? { deviceId: { exact: audioDevice } } : {}), echoCancellation: true, noiseSuppression: true } : false,
      video: video ? { ...(videoDevice ? { deviceId: { exact: videoDevice } } : {}), width: { ideal: 1280 }, height: { ideal: 720 } } : false,
    });
  } catch {
    return audio ? await navigator.mediaDevices.getUserMedia({ audio: audioDevice ? { deviceId: { exact: audioDevice }, echoCancellation: true } : true, video: false }) : new MediaStream();
  }
}

/** Everything a live call holds: its peers, media and reactions. One instance runs in `MemberCallHost` for the whole app. */
function useMemberCallEngine(config: MemberCallConfig, agent: Bot | undefined) {
  const { target, me, name } = config;
  const self = useMemo(() => personOf(me), [me]);
  const targetKey = config.key;
  const { value: participants } = usePolled(
    () => originRealtime<{ participants: MemberCallParticipant[] }>(PARTICIPANTS, target).then((result) => result.participants),
    PARTICIPANT_POLL_MS, targetKey,
  );
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [remote, setRemote] = useState<Record<string, RemoteMedia>>({});
  const [signals, setSignals] = useState<MemberCallSignal[]>([]);
  const [audioEnabled, setAudioEnabled] = useState(config.media.audioEnabled);
  const [videoEnabled, setVideoEnabled] = useState(config.media.videoEnabled);
  const [joining, setJoining] = useState(false);
  const [joinedAt, setJoinedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [audioDevice, setAudioDevice] = useState(config.media.audioDevice);
  const [videoDevice, setVideoDevice] = useState(config.media.videoDevice);
  const [pinned, setPinned] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [bursts, setBursts] = useState<Burst[]>([]);
  const [badges, setBadges] = useState<Record<string, CallReaction>>({});
  const [hands, setHands] = useState<ReadonlySet<string>>(new Set());
  const [handUp, setHandUp] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [arrivals, setArrivals] = useState<Arrival[]>([]);

  const previousScreens = useRef(new Set<string>());
  const screenRef = useRef<MediaStream | null>(null);
  const iceServers = useRef<RTCIceServer[]>([]);
  const localRef = useRef<MediaStream | null>(null);
  const peers = useRef(new Map<string, RTCPeerConnection>());
  const channels = useRef(new Map<string, RTCDataChannel>());
  const signalings = useRef(new Map<string, CallSignaling>());
  const peerSessions = useRef(new Map<string, number>());
  const peerSessionIds = useRef(new Map<string, string>());
  const ownSession = useRef(0);
  const ownSessionId = useRef("");
  const restartTimers = useRef(new Map<string, number>());
  const processed = useRef(new Set<string>());
  const joined = useRef(false);
  const sharing = useRef(false);
  const mounted = useRef(true);
  const handRef = useRef(false);
  const burstId = useRef(0);
  const seen = useRef<Map<string, Person> | null>(null);
  const targetRef = useRef(target);
  targetRef.current = target;
  const participantsRef = useRef(participants);
  participantsRef.current = participants;
  const callAgent = useCallAgent(target, agent?.id, localStream, agent?.voice);

  const api = <T,>(path: string, init?: Parameters<typeof originRealtime>[2]) => originRealtime<T>(path, targetRef.current, init);
  const leaveServer = (sessionId = ownSessionId.current) => api(PARTICIPANTS, { json: { action: "leave", sessionId } }).catch(() => {});
  const sessionError = (error: unknown) => {
    if (error instanceof OriginRealtimeError && error.status === 409) {
      endMemberCall(config.nonce, { key: config.key, message: "This call ended or was joined on another device. Join again to continue." });
    }
  };

  const resetPeers = () => {
    peers.current.forEach((connection) => connection.close());
    peers.current.clear();
    channels.current.clear();
    signalings.current.forEach((signaling) => signaling.dispose());
    signalings.current.clear();
    peerSessions.current.clear();
    peerSessionIds.current.clear();
    restartTimers.current.forEach((timer) => window.clearTimeout(timer));
    restartTimers.current.clear();
    processed.current.clear();
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const wasJoined = joined.current;
      joined.current = false;
      localRef.current?.getTracks().forEach((track) => track.stop());
      screenRef.current?.getTracks().forEach((track) => track.stop());
      resetPeers();
      if (wasJoined) void leaveServer();
    };
  }, []);

  const showReaction = (userId: string, emoji: CallReaction, who: string) => {
    const id = ++burstId.current;
    setBursts((current) => [...current.slice(-14), { id, emoji, name: who, drift: Math.round((Math.random() - 0.5) * 80) }]);
    window.setTimeout(() => setBursts((current) => current.filter((burst) => burst.id !== id)), BURST_MS);
    setBadges((current) => ({ ...current, [userId]: emoji }));
    window.setTimeout(() => setBadges((current) => {
      if (current[userId] !== emoji) return current;
      const next = { ...current };
      delete next[userId];
      return next;
    }), BADGE_MS);
  };

  const setHand = (userId: string, up: boolean) => setHands((current) => {
    if (current.has(userId) === up) return current;
    const next = new Set(current);
    if (up) next.add(userId);
    else next.delete(userId);
    return next;
  });

  const receive = (userId: string, message: CallChannelMessage) => {
    const who = participantsRef.current?.find((participant) => participant.userId === userId);
    if (message.kind === "reaction") showReaction(userId, message.emoji, who ? displayName(who) : "Someone");
    else setHand(userId, message.up);
  };

  const broadcast = (message: CallChannelMessage) => {
    const data = JSON.stringify(message);
    channels.current.forEach((channel) => { if (channel.readyState === "open") channel.send(data); });
  };

  const cleanupPeer = (userId: string) => {
    const connection = peers.current.get(userId);
    peers.current.delete(userId);
    channels.current.delete(userId);
    signalings.current.get(userId)?.dispose();
    signalings.current.delete(userId);
    peerSessions.current.delete(userId);
    peerSessionIds.current.delete(userId);
    window.clearTimeout(restartTimers.current.get(userId));
    restartTimers.current.delete(userId);
    connection?.close();
    setHand(userId, false);
    setRemote((current) => {
      if (!current[userId]) return current;
      const next = { ...current };
      delete next[userId];
      return next;
    });
  };

  const sendSignal = async (toUserId: string, kind: MemberCallSignalKind, payload: string, fromJoinedAt: number, sessionId: string, toJoinedAt?: number, toSessionId?: string) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!joined.current || ownSessionId.current !== sessionId || peerSessionIds.current.get(toUserId) !== toSessionId) return;
      try {
        await api(SIGNALS, { json: { toUserId, kind, payload, fromJoinedAt, toJoinedAt, sessionId, toSessionId } });
        return;
      } catch (error) {
        sessionError(error);
        if (error instanceof OriginRealtimeError && error.status === 409) return;
        if (attempt === 2) throw error;
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
  };

  const ensurePeer = (userId: string): RTCPeerConnection => {
    const existing = peers.current.get(userId);
    if (existing) return existing;
    const connection = new RTCPeerConnection({ iceServers: iceServers.current });
    const fromSession = ownSession.current;
    const toSession = peerSessions.current.get(userId);
    const fromSessionId = ownSessionId.current;
    const toSessionId = peerSessionIds.current.get(userId);
    const send = (kind: MemberCallSignalKind, payload: string) => sendSignal(userId, kind, payload, fromSession, fromSessionId, toSession, toSessionId);
    const signaling = createCallSignaling(connection, self.userId < userId, send);
    signalings.current.set(userId, signaling);
    const signalError = (error: unknown) => {
      if (joined.current && peers.current.get(userId) === connection) setNotice(error instanceof Error ? error.message : "Could not connect the call");
    };
    connection.onnegotiationneeded = () => { void signaling.offer().catch(signalError); };
    const stream = localRef.current;
    const audioTrack = stream?.getAudioTracks()[0];
    const videoTrack = stream?.getVideoTracks()[0];
    if (audioTrack && stream) connection.addTrack(audioTrack, stream);
    else connection.addTransceiver("audio", { direction: "sendrecv", streams: stream ? [stream] : [] });
    if (videoTrack && stream) connection.addTrack(videoTrack, stream);
    else connection.addTransceiver("video", { direction: "sendrecv", streams: stream ? [stream] : [] });
    connection.addTransceiver(screenRef.current?.getVideoTracks()[0] ?? "video", { direction: "sendrecv", streams: [screenRef.current ?? new MediaStream()] });
    const channel = connection.createDataChannel("reactions", { negotiated: true, id: 0 });
    channel.onopen = () => { if (handRef.current) channel.send(JSON.stringify({ kind: "hand", up: true } satisfies CallChannelMessage)); };
    channel.onmessage = (event) => {
      const message = parseCallMessage(event.data);
      if (message && peers.current.get(userId) === connection) receive(userId, message);
    };
    channels.current.set(userId, channel);
    connection.onicecandidate = (event) => {
      if (event.candidate) void send("candidate", JSON.stringify(event.candidate.toJSON())).catch(signalError);
    };
    connection.ontrack = (event) => {
      if (peers.current.get(userId) !== connection) return;
      const toScreen = isScreenTrack(connection.getTransceivers(), event.track);
      setRemote((current) => {
        const live = (media?: MediaStream) => media?.getTracks().filter((track) => track.readyState === "live") ?? [];
        const camera = new MediaStream(live(current[userId]?.stream));
        const screen = new MediaStream(live(current[userId]?.screen));
        const into = toScreen ? screen : camera;
        into.getTracks().filter((track) => track.kind === event.track.kind && track !== event.track).forEach((track) => into.removeTrack(track));
        if (!into.getTracks().includes(event.track)) into.addTrack(event.track);
        return { ...current, [userId]: { stream: camera, screen } };
      });
    };
    let restarts = 0;
    const scheduleRestart = (delay: number) => {
      if (restartTimers.current.has(userId)) return;
      const timer = window.setTimeout(() => {
        restartTimers.current.delete(userId);
        if (!joined.current || peers.current.get(userId) !== connection || connection.connectionState === "connected") return;
        if (++restarts > MAX_RESTARTS) {
          setNotice("Connection interrupted. Leave and rejoin to reconnect.");
          return;
        }
        void api<{ iceServers: RTCIceServer[] }>(CONFIG).then((config) => {
          if (peers.current.get(userId) !== connection || !joined.current) return;
          iceServers.current = config.iceServers;
          connection.setConfiguration({ iceServers: config.iceServers });
          return signaling.offer(true);
        }).catch(signalError);
        scheduleRestart(RESTART_CHECK_MS);
      }, delay);
      restartTimers.current.set(userId, timer);
    };
    connection.onconnectionstatechange = () => {
      if (peers.current.get(userId) !== connection || !joined.current) return;
      if (connection.connectionState === "connected") {
        restarts = 0;
        window.clearTimeout(restartTimers.current.get(userId));
        restartTimers.current.delete(userId);
        setNotice("");
      } else if (connection.connectionState === "disconnected" || connection.connectionState === "failed") {
        if (connection.connectionState === "failed") {
          window.clearTimeout(restartTimers.current.get(userId));
          restartTimers.current.delete(userId);
        }
        scheduleRestart(connection.connectionState === "failed" ? 500 : 4_000);
      } else if (connection.connectionState === "closed") {
        cleanupPeer(userId);
      }
    };
    scheduleRestart(RESTART_CHECK_MS);
    peers.current.set(userId, connection);
    return connection;
  };

  const startCall = async () => {
    if (joining || localRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      endMemberCall(config.nonce, { key: config.key, message: "Camera and microphone are not available here." });
      return;
    }
    let stream: MediaStream | null = null;
    setJoining(true);
    setDevicesOpen(false);
    try {
      iceServers.current = (await api<{ iceServers: RTCIceServer[] }>(CONFIG)).iceServers;
      stream = await captureMedia(audioEnabled, videoEnabled, audioDevice, videoDevice);
      const hasAudio = stream.getAudioTracks().length > 0;
      const hasVideo = stream.getVideoTracks().length > 0;
      if (!mounted.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const presence = await api<{ joinedAt: number; sessionId: string }>(PARTICIPANTS, { json: { action: "join", audioEnabled: hasAudio, videoEnabled: hasVideo } });
      if (!mounted.current) {
        stream.getTracks().forEach((track) => track.stop());
        await leaveServer(presence.sessionId);
        return;
      }
      joined.current = true;
      ownSession.current = presence.joinedAt;
      ownSessionId.current = presence.sessionId;
      localRef.current = stream;
      setLocalStream(stream);
      setJoinedAt(Date.now());
      setAudioEnabled(hasAudio);
      setVideoEnabled(hasVideo);
      setNotice("");
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      if (mounted.current) endMemberCall(config.nonce, { key: config.key, message: error instanceof Error ? error.message : "Could not start the call" });
    } finally {
      if (mounted.current) setJoining(false);
    }
  };

  const leaveCall = async () => {
    joined.current = false;
    handRef.current = false;
    localRef.current?.getTracks().forEach((track) => track.stop());
    screenRef.current?.getTracks().forEach((track) => track.stop());
    screenRef.current = null;
    localRef.current = null;
    setScreenStream(null);
    setJoinedAt(null);
    setPinned(null);
    setLocalStream(null);
    setRemote({});
    setHands(new Set());
    setHandUp(false);
    setBadges({});
    setPanelOpen(false);
    resetPeers();
    await leaveServer();
    endMemberCall(config.nonce);
  };

  const stopSharing = async () => {
    screenRef.current?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
    screenRef.current = null;
    setScreenStream(null);
    setPinned((current) => (current === SELF_SCREEN ? null : current));
    await Promise.allSettled([...peers.current.values()].map((connection) => videoSender(connection, 1)?.replaceTrack(null)));
  };

  const shareScreen = async () => {
    if (sharing.current || !joined.current) return;
    if (screenRef.current) {
      await stopSharing();
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setNotice("Screen sharing is not available here. You can still see a teammate's screen.");
      return;
    }
    let screen: MediaStream | null = null;
    sharing.current = true;
    try {
      screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: false });
      if (!joined.current) {
        screen.getTracks().forEach((track) => track.stop());
        return;
      }
      const track = screen.getVideoTracks()[0]!;
      screenRef.current = screen;
      await Promise.all([...peers.current.values()].map((connection) => videoSender(connection, 1)?.replaceTrack(track)));
      track.onended = () => { void stopSharing(); };
      if (!joined.current || track.readyState === "ended") {
        await stopSharing();
        return;
      }
      setScreenStream(screen);
      setNotice("");
    } catch (error) {
      screen?.getTracks().forEach((track) => track.stop());
      await stopSharing();
      if (!(error instanceof DOMException && error.name === "NotAllowedError")) setNotice(error instanceof Error ? error.message : "Could not share your screen");
    } finally {
      sharing.current = false;
    }
  };

  useEffect(() => {
    if (!joinedAt) return;
    const tick = () => setElapsed(Math.floor((Date.now() - joinedAt) / 1000));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [joinedAt]);

  const reacquire = async (kind: "audio" | "video", deviceId: string) => {
    const stream = localRef.current;
    if (!stream || stream.getTracks().some((track) => track.kind === kind && track.readyState === "live")) return true;
    try {
      const capture = await navigator.mediaDevices.getUserMedia(kind === "audio"
        ? { audio: deviceId ? { deviceId: { exact: deviceId }, echoCancellation: true } : true }
        : { video: deviceId ? { deviceId: { exact: deviceId } } : true });
      if (!joined.current || localRef.current !== stream) {
        capture.getTracks().forEach((track) => track.stop());
        return false;
      }
      const track = capture.getTracks()[0]!;
      stream.addTrack(track);
      await Promise.all([...peers.current.values()].map((connection) => connection.getTransceivers().find((transceiver) => transceiver.receiver.track.kind === kind)?.sender.replaceTrack(track)));
      return true;
    } catch {
      setNotice(kind === "audio" ? "Microphone access was denied. Check the app's permissions." : "Camera access was denied. Check the app's permissions.");
      return false;
    }
  };

  const toggle = async (kind: "audio" | "video") => {
    const next = !(kind === "audio" ? audioEnabled : videoEnabled);
    if (next && !(await reacquire(kind, kind === "audio" ? audioDevice : videoDevice))) return;
    const stream = localRef.current;
    (kind === "audio" ? stream?.getAudioTracks() : stream?.getVideoTracks())?.forEach((track) => { track.enabled = next; });
    if (kind === "audio") setAudioEnabled(next);
    else setVideoEnabled(next);
    if (stream) {
      void api(PARTICIPANTS, { json: { action: "update", sessionId: ownSessionId.current, audioEnabled: kind === "audio" ? next : audioEnabled, videoEnabled: kind === "video" ? next : videoEnabled, screenSharing: Boolean(screenRef.current) } }).catch(sessionError);
    }
  };

  const react = (emoji: CallReaction) => {
    broadcast({ kind: "reaction", emoji });
    showReaction(self.userId, emoji, "You");
  };

  const raiseHand = () => {
    const up = !handRef.current;
    handRef.current = up;
    setHandUp(up);
    setHand(self.userId, up);
    broadcast({ kind: "hand", up });
  };

  useEffect(() => {
    if (!localStream) return;
    const heartbeat = () => { void api(PARTICIPANTS, { json: { action: "update", sessionId: ownSessionId.current, audioEnabled, videoEnabled, screenSharing: Boolean(screenStream) } }).catch(sessionError); };
    heartbeat();
    const timer = window.setInterval(heartbeat, HEARTBEAT_MS);
    return () => window.clearInterval(timer);
  }, [audioEnabled, videoEnabled, localStream, screenStream]);

  useEffect(() => {
    if (!localStream) {
      setSignals([]);
      return;
    }
    let alive = true;
    const load = async () => {
      try {
        const result = await api<{ signals: MemberCallSignal[] }>(SIGNALS, { query: { sessionId: ownSessionId.current } });
        if (alive) setSignals(result.signals);
      } catch (error) {
        if (alive) {
          sessionError(error);
          setNotice(error instanceof Error ? error.message : "Could not load call signals");
        }
      }
    };
    void load();
    const timer = window.setInterval(load, SIGNAL_POLL_MS);
    return () => { alive = false; window.clearInterval(timer); };
  }, [localStream]);

  useEffect(() => {
    if (!localStream || !participants) return;
    const others = participants.filter((participant) => participant.userId !== self.userId);
    const active = new Set(others.map((participant) => participant.userId));
    peers.current.forEach((_, userId) => { if (!active.has(userId)) cleanupPeer(userId); });
    for (const participant of others) {
      const previous = peerSessions.current.get(participant.userId);
      if (previous !== undefined && previous > participant.joinedAt) continue;
      if (previous !== undefined && peerSessionIds.current.get(participant.userId) !== participant.sessionId) cleanupPeer(participant.userId);
      peerSessions.current.set(participant.userId, participant.joinedAt);
      peerSessionIds.current.set(participant.userId, participant.sessionId);
      ensurePeer(participant.userId);
    }
  }, [localStream, participants, self.userId]);

  useEffect(() => {
    if (!localStream || !signals.length) return;
    const handle = async () => {
      const acknowledged: string[] = [];
      for (const signal of signals) {
        if (!joined.current) break;
        if (processed.current.has(signal.id)) continue;
        processed.current.add(signal.id);
        acknowledged.push(signal.id);
        if (signal.toSessionId !== ownSessionId.current || (signal.toJoinedAt !== undefined && signal.toJoinedAt !== ownSession.current)) continue;
        const previous = peerSessions.current.get(signal.fromUserId);
        if (signal.fromJoinedAt !== undefined) {
          if (previous !== undefined && previous > signal.fromJoinedAt) continue;
          if (previous !== undefined && peerSessionIds.current.get(signal.fromUserId) !== signal.fromSessionId) cleanupPeer(signal.fromUserId);
          peerSessions.current.set(signal.fromUserId, signal.fromJoinedAt);
        }
        peerSessionIds.current.set(signal.fromUserId, signal.fromSessionId);
        ensurePeer(signal.fromUserId);
        try {
          await signalings.current.get(signal.fromUserId)?.receive(signal.kind, signal.payload);
        } catch (error) {
          setNotice(error instanceof Error ? error.message : "Call connection failed");
        }
      }
      if (acknowledged.length) await api(SIGNALS, { method: "DELETE", json: { signalIds: acknowledged, sessionId: ownSessionId.current } }).catch(sessionError);
    };
    void handle();
  }, [localStream, signals]);

  useEffect(() => {
    if (!participants) return;
    const now = new Map(participants.filter((participant) => participant.userId !== self.userId).map((participant) => [participant.userId, participant as Person]));
    const before = seen.current;
    seen.current = now;
    if (!before) return;
    const changes: Arrival[] = [
      ...[...now].filter(([userId]) => !before.has(userId)).map(([, person]) => ({ id: ++burstId.current, name: displayName(person), person, joined: true })),
      ...[...before].filter(([userId]) => !now.has(userId)).map(([, person]) => ({ id: ++burstId.current, name: displayName(person), person, joined: false })),
    ];
    if (!changes.length) return;
    setArrivals((current) => [...current, ...changes].slice(-4));
    for (const change of changes) window.setTimeout(() => setArrivals((current) => current.filter((item) => item.id !== change.id)), ARRIVAL_MS);
  }, [participants, self.userId]);

  const others = (participants ?? []).filter((participant) => participant.userId !== self.userId);
  const tiles: Tile[] = localStream ? [
    ...(screenStream ? [{ id: SELF_SCREEN, userId: self.userId, stream: screenStream, person: self, label: "Your screen", audioEnabled: false, videoEnabled: true, screenSharing: true, self: true }] : []),
    { id: SELF_CAMERA, userId: self.userId, stream: localStream, person: self, label: "You", audioEnabled, videoEnabled, self: true },
    ...others.flatMap((participant): Tile[] => {
      const media = remote[participant.userId];
      return [
        ...(participant.screenSharing && media?.screen ? [{ id: `${participant.userId}:screen`, userId: participant.userId, stream: media.screen, person: participant, label: `${displayName(participant)}'s screen`, audioEnabled: false, videoEnabled: true, screenSharing: true }] : []),
        { id: `${participant.userId}:camera`, userId: participant.userId, ...(media ? { stream: media.stream } : {}), person: participant, label: displayName(participant), audioEnabled: participant.audioEnabled, videoEnabled: participant.videoEnabled },
      ];
    }),
    ...(agent && callAgent.participant ? [{
      id: `agent:${agent.id}`, userId: `agent:${agent.id}`, ...(callAgent.participant.stream ? { stream: callAgent.participant.stream } : {}),
      person: { userId: `agent:${agent.id}`, name: agent.name, email: "" }, label: agent.name, audioEnabled: true, videoEnabled: false,
      agent: { bot: agent, state: callAgent.participant.state },
    }] : []),
  ] : [];
  const screenIds = tiles.filter((tile) => tile.screenSharing).map((tile) => tile.id).join(",");
  useEffect(() => {
    const screens = screenIds ? screenIds.split(",") : [];
    const fresh = screens.find((id) => !previousScreens.current.has(id));
    if (fresh) setPinned(fresh);
    previousScreens.current = new Set(screens);
  }, [screenIds]);
  const stageId = tiles.some((tile) => tile.id === pinned) ? pinned : tiles.find((tile) => tile.screenSharing)?.id ?? null;

  const changeDevice = async (kind: "audio" | "video", deviceId: string) => {
    const stream = localRef.current;
    if (stream && (kind === "audio" ? audioEnabled : videoEnabled)) {
      const capture = await navigator.mediaDevices.getUserMedia({ [kind]: deviceId ? { deviceId: { exact: deviceId } } : true });
      if (!joined.current || localRef.current !== stream) {
        capture.getTracks().forEach((track) => track.stop());
        return;
      }
      const track = capture.getTracks()[0]!;
      try {
        await Promise.all([...peers.current.values()].map((connection) => connection.getTransceivers().find((transceiver) => transceiver.receiver.track.kind === kind)?.sender.replaceTrack(track)));
        stream.getTracks().filter((old) => old.kind === kind).forEach((old) => { stream.removeTrack(old); old.stop(); });
        stream.addTrack(track);
        const next = new MediaStream(stream.getTracks());
        localRef.current = next;
        setLocalStream(next);
      } catch (error) {
        capture.getTracks().forEach((old) => old.stop());
        throw error;
      }
    } else if (stream) {
      stream.getTracks().filter((old) => old.kind === kind).forEach((old) => { stream.removeTrack(old); old.stop(); });
    }
    if (kind === "audio") setAudioDevice(deviceId);
    else setVideoDevice(deviceId);
  };

  const present = participants ?? [];
  const inCall = Boolean(localStream);
  const tileProps = (tile: Tile) => ({ ...tile, hand: hands.has(tile.userId) && !tile.screenSharing, reaction: tile.screenSharing ? undefined : badges[tile.userId] });

  const speaking = useSpeakingUsers(localStream, audioEnabled, self.userId, remote);
  useEffect(() => { void startCall(); }, []);

  return {
    key: config.key, name, self, agent, present, inCall, joining, elapsed, notice, tiles, stageId, tileProps, bursts, arrivals, screenStream, handUp, hands,
    panelOpen, devicesOpen, audioEnabled, videoEnabled, audioDevice, videoDevice, callAgent, others, remote, localStream, speaking,
    setPinned, setPanelOpen, setDevicesOpen, toggle, shareScreen, react, raiseHand, leaveCall, changeDevice, open: config.open,
  };
}

export type MemberCallState = ReturnType<typeof useMemberCallEngine>;

/** Which people (by user id) are speaking right now, for the sidebar banner. */
function useSpeakingUsers(local: MediaStream | null, localOn: boolean, selfId: string, remote: Record<string, RemoteMedia>): ReadonlySet<string> {
  const [speaking, setSpeaking] = useState<ReadonlySet<string>>(new Set());
  const streams = [...(local && localOn ? [[selfId, local] as const] : []), ...Object.entries(remote).map(([userId, media]) => [userId, media.stream] as const)];
  const streamKey = streams.map(([userId, stream]) => `${userId}:${stream.getAudioTracks()[0]?.id ?? ""}`).join(",");
  useEffect(() => {
    const now = new Set<string>();
    const stops = streams.map(([userId, stream]) => watchAudioLevel(stream, (level) => {
      const on = level > SPEAKING_LEVEL;
      if (on === now.has(userId)) return;
      if (on) now.add(userId);
      else now.delete(userId);
      setSpeaking(new Set(now));
    }, 150));
    return () => { stops.forEach((stop) => stop()); setSpeaking(new Set()); };
  }, [streamKey]);
  return speaking;
}

function MemberCallEngine({ config }: { config: MemberCallConfig }) {
  const { state } = useStore();
  const agent = config.agentId ? state.bots.find((bot) => bot.id === config.agentId) : undefined;
  const call = useMemberCallEngine(config, agent);
  useLayoutEffect(() => { publishMemberCallState(call, config.nonce); });
  useEffect(() => () => publishMemberCallState(null, config.nonce), [config.nonce]);
  const { localStream, others, remote, callAgent } = call;
  return (
    <div className="hidden">
      {localStream && others.map((participant) => remote[participant.userId] && <CallAudio key={participant.userId} stream={remote[participant.userId]!.stream} name={participant.name} />)}
      {agent && callAgent.participant?.stream && <CallAudio key={`agent:${agent.id}`} stream={callAgent.participant.stream} name={agent.name} />}
    </div>
  );
}

/** Keeps the person's call alive across pages: mount once, beside the other app-wide hosts. */
export function MemberCallHost() {
  const config = useMemberCallConfig();
  return config ? <MemberCallEngine key={config.nonce} config={config} /> : null;
}

/** A call room's page: the lobby, or the live call when the person is in this room's call. */
export function MemberCall({ target, me, canJoin, name, agent, open }: { target: RealtimeTarget; me: CloudUser; canJoin: boolean; name: string; agent?: Bot; open(): void }) {
  const key = memberCallKey(target);
  const config = useMemberCallConfig();
  const live = useMemberCallState<MemberCallState>();
  const failure = useMemberCallFailure(key);
  const here = config?.key === key;
  const call = here && live?.key === key ? live : null;
  const self = useMemo(() => personOf(me), [me]);
  const { value: participants } = usePolled(
    call?.inCall ? null : () => originRealtime<{ participants: MemberCallParticipant[] }>(PARTICIPANTS, target).then((result) => result.participants),
    PARTICIPANT_POLL_MS, `${key}:${call?.inCall ? "live" : "lobby"}`,
  );
  const [media, setMedia] = useState<MemberCallMedia>({ audioEnabled: true, videoEnabled: true, audioDevice: "", videoDevice: "" });
  const patch = (next: Partial<MemberCallMedia>) => setMedia((current) => ({ ...current, ...next }));
  if (call?.inCall) return <MemberCallView call={call} />;
  return (
    <section className="relative flex min-h-0 flex-1 flex-col pt-[var(--glass-top,0px)]" aria-label={`${name} call`}>
      <CallLobby self={self} present={participants ?? []} name={name} canJoin={canJoin} joining={here}
        audioEnabled={media.audioEnabled} videoEnabled={media.videoEnabled} audioDevice={media.audioDevice} videoDevice={media.videoDevice}
        onAudio={(on) => patch({ audioEnabled: on })} onVideo={(on) => patch({ videoEnabled: on })} onAudioDevice={(id) => patch({ audioDevice: id })} onVideoDevice={(id) => patch({ videoDevice: id })}
        onJoin={() => startMemberCall({ key, target, me, name, agentId: agent?.id, media, open })} notice={failure}
        elsewhere={config && !here ? config.name : undefined} />
    </section>
  );
}

function MemberCallView({ call }: { call: MemberCallState }) {
  const {
    key, name, self, agent, present, elapsed, notice, tiles, stageId, tileProps, bursts, arrivals, screenStream, handUp, hands, panelOpen, devicesOpen,
    audioEnabled, videoEnabled, audioDevice, videoDevice, callAgent, setPinned, setPanelOpen, setDevicesOpen, toggle, shareScreen, react, raiseHand, leaveCall, changeDevice,
  } = call;
  useEffect(() => {
    showingCallPage(key);
    return () => showingCallPage(null);
  }, [key]);
  return (
    <section className="relative flex min-h-0 flex-1 flex-col pt-[var(--glass-top,0px)]" aria-label={`${name} call`}>
      <div className="flex min-h-0 flex-1 origin-overlay-in">
        <div className="relative flex min-w-0 flex-1 flex-col gap-3 p-3 md:p-4">
          <div className="flex items-center gap-2.5">
            <span className="relative flex size-2.5"><span className="absolute inset-0 rounded-full bg-success motion-safe:animate-ping" /><span className="relative size-2.5 rounded-full bg-success" /></span>
            <h2 className="min-w-0 truncate text-[14px] font-semibold text-ink">{name}</h2>
            <time className="rounded-full bg-raised/70 px-2 py-0.5 font-mono text-[12px] tabular-nums text-ink-secondary" aria-label="Time in call">{formatElapsed(elapsed)}</time>
            <span className="text-[12.5px] text-ink-tertiary">{present.length || 1} in call</span>
            {agent && <CallAgentBadge name={agent.name} call={callAgent} />}
            {stageId && (
              <button type="button" className={cn(ghostButton, "ml-auto h-8 rounded-full")} onClick={() => setPinned(null)} title="Show everyone">
                <LayoutGrid size={14} />Gallery
              </button>
            )}
          </div>
          <CallStage tiles={tiles} stageId={stageId} tileProps={tileProps} onPin={(id) => setPinned(id === stageId ? null : id)} />
          <ReactionBursts bursts={bursts} />
          {agent && <CallAgentCaptions name={agent.name} call={callAgent} />}
          <div className="pointer-events-none absolute inset-x-0 top-14 z-20 flex flex-col items-center gap-1.5" aria-live="polite">
            {arrivals.map((arrival) => (
              <div key={arrival.id} className="flex items-center gap-2 rounded-full border border-hairline/50 bg-menu py-1 pl-1 pr-3 text-[12.5px] text-ink origin-sheet-in">
                <PersonAvatar person={arrival.person} size={22} />{arrival.name} {arrival.joined ? "joined" : "left"}
              </div>
            ))}
          </div>
          <CallDock audioEnabled={audioEnabled} videoEnabled={videoEnabled} sharing={Boolean(screenStream)} handUp={handUp} panelOpen={panelOpen} devicesOpen={devicesOpen}
            onAudio={() => void toggle("audio")} onVideo={() => void toggle("video")} onShare={() => void shareScreen()} onReact={react} onHand={raiseHand}
            onPanel={() => setPanelOpen(!panelOpen)} onDevices={() => setDevicesOpen(!devicesOpen)} onLeave={() => void leaveCall()} peopleCount={(present.length || 1) + (callAgent.participant ? 1 : 0)}
            agent={agent && { name: agent.name, available: callAgent.available, present: Boolean(callAgent.session), add: callAgent.add, remove: callAgent.remove }} />
          {devicesOpen && (
            <div className="absolute bottom-24 left-1/2 z-30 w-[min(360px,calc(100%-24px))] -translate-x-1/2">
              <CallDevices audioId={audioDevice} videoId={videoDevice} onChange={changeDevice} onClose={() => setDevicesOpen(false)} />
            </div>
          )}
          {notice && <div className="absolute inset-x-4 bottom-24 z-20 flex justify-center"><Notice tone="danger">{notice}</Notice></div>}
        </div>
        {panelOpen && (
          <CallRoster self={self} present={present} hands={hands} agent={agent && callAgent.participant ? { bot: agent, participant: callAgent.participant } : undefined} onClose={() => setPanelOpen(false)}
            className="max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-40" />
        )}
      </div>
    </section>
  );
}

function CallStage({ tiles, stageId, tileProps, onPin }: {
  tiles: readonly Tile[]; stageId: string | null; tileProps(tile: Tile): TileProps; onPin(id: string): void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth);
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(element);
    return () => resize.disconnect();
  }, []);
  const main = stageId ? tiles.find((tile) => tile.id === stageId) : undefined;
  if (main) {
    const rest = tiles.filter((tile) => tile.id !== main.id);
    return (
      <div ref={box} className="flex min-h-0 flex-1 gap-3 max-lg:flex-col">
        <div className="relative min-h-[200px] min-w-0 flex-1">
          <CallTile key={main.id} {...tileProps(main)} pinned onPin={() => onPin(main.id)} />
        </div>
        {rest.length > 0 && (
          <div className="flex shrink-0 gap-2 overflow-auto max-lg:h-[104px] lg:w-[220px] lg:flex-col" aria-label="Other cameras and shared screens">
            {rest.map((tile) => (
              <div key={tile.id} className="shrink-0 max-lg:h-full max-lg:w-[160px] lg:h-[132px]">
                <CallTile {...tileProps(tile)} thumbnail onPin={() => onPin(tile.id)} />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }
  const columns = galleryColumns(tiles.length, width);
  const rows = Math.ceil(tiles.length / columns);
  return (
    <div ref={box} className="grid min-h-0 flex-1 content-center gap-3"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}>
      {tiles.map((tile, index) => (
        <div key={tile.id} className="relative min-h-[140px]" style={{ animationDelay: `${Math.min(index, 6) * 20}ms` }}>
          <CallTile {...tileProps(tile)} onPin={() => onPin(tile.id)} />
        </div>
      ))}
    </div>
  );
}

type TileProps = Tile & { hand?: boolean; reaction?: CallReaction };

const AGENT_STATE: Record<CallAgentParticipant["state"], string> = { joining: "Joining", listening: "Listening", thinking: "Thinking", speaking: "Speaking", failed: "Could not join" };

function CallTile({ stream, person, label, audioEnabled, videoEnabled, screenSharing = false, self = false, agent, hand = false, reaction, thumbnail = false, pinned = false, onPin }: TileProps & { thumbnail?: boolean; pinned?: boolean; onPin?: () => void }) {
  const video = useRef<HTMLVideoElement | null>(null);
  const tile = useRef<HTMLDivElement | null>(null);
  const [fullscreenError, setFullscreenError] = useState("");
  const level = useAudioLevel(stream, audioEnabled && !screenSharing);
  const speaking = level > SPEAKING_LEVEL || agent?.state === "speaking";
  useEffect(() => {
    if (video.current) video.current.srcObject = stream ?? null;
  }, [stream]);
  const showVideo = videoEnabled && Boolean(stream);
  return (
    <div ref={tile} data-call-tile={label} data-speaking={speaking || undefined}
      style={{ "--level": Math.min(1, level * 1.6) } as CSSProperties}
      className={cn("group relative flex h-full w-full items-center justify-center overflow-hidden rounded-2xl bg-[#0d0f12] ring-1 ring-white/5 origin-tile-in transition-[box-shadow] duration-150",
        speaking && "origin-speaking-ring")}>
      <button type="button" className="absolute inset-0 z-10 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        aria-label={pinned ? `Unpin ${label}` : `Pin ${label}`} title={pinned ? "Back to gallery" : "Pin to the stage"} onClick={onPin} />
      <video ref={video} autoPlay muted playsInline className={cn("h-full w-full", screenSharing ? "object-contain" : "object-cover", self && !screenSharing && "-scale-x-100", !showVideo && "absolute size-px opacity-0")} />
      {!showVideo && (
        <div className="flex flex-col items-center gap-2">
          {agent ? <BotAvatar bot={agent.bot} size={thumbnail ? 40 : 76} animated={speaking} /> : <PersonAvatar person={person} size={thumbnail ? 40 : 76} />}
          {agent ? <small className="flex items-center gap-1 text-[11.5px] text-white/60">{agent.state === "joining" && <Loader2 size={11} className="animate-spin" />}{AGENT_STATE[agent.state]}</small>
            : !stream && <small className="flex items-center gap-1 text-[11.5px] text-white/60"><Loader2 size={11} className="animate-spin" />Connecting</small>}
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/60 to-transparent" />
      <div className="pointer-events-none absolute bottom-2 left-2 flex max-w-[calc(100%-16px)] items-center gap-1.5 rounded-full bg-black/45 py-0.5 pl-2 pr-1.5 text-[11.5px] text-white backdrop-blur-sm">
        <span className="truncate">{label}</span>
        {screenSharing ? <MonitorUp size={12} aria-label="Sharing a screen" />
          : audioEnabled ? <SpeakingBars level={level} /> : <MicOff size={12} className="text-danger" aria-label="Microphone off" />}
      </div>
      {hand && (
        <span className="pointer-events-none absolute left-2 top-2 flex items-center gap-1 rounded-full bg-warning px-2 py-0.5 text-[11.5px] font-medium text-[#1a1300] origin-pop-badge">
          <Hand size={12} aria-hidden="true" />Hand raised
        </span>
      )}
      {reaction && <span key={reaction} aria-hidden="true" className="pointer-events-none absolute right-2 top-2 text-[28px] origin-pop-badge">{reaction}</span>}
      {!thumbnail && (
        <div className="absolute right-2 top-2 z-20 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 touch:opacity-100 max-md:opacity-100">
          {pinned && <span className="flex size-7 items-center justify-center rounded-lg bg-black/55 text-white"><PinOff size={13} aria-hidden="true" /></span>}
          {!pinned && <span className="flex size-7 items-center justify-center rounded-lg bg-black/55 text-white"><Pin size={13} aria-hidden="true" /></span>}
          {showVideo && (
            <button type="button" className="flex size-7 items-center justify-center rounded-lg bg-black/55 text-white hover:bg-black/75" title="Full screen" aria-label={`Full screen ${label}`}
              onClick={() => {
                if (!tile.current?.requestFullscreen) {
                  setFullscreenError("Full screen is not available here");
                  return;
                }
                void tile.current.requestFullscreen().catch(() => setFullscreenError("Could not enter full screen"));
              }}>
              <Maximize2 size={14} />
            </button>
          )}
        </div>
      )}
      {fullscreenError && <small role="status" className="absolute left-2 top-10 rounded-md bg-black/55 px-1.5 py-0.5 text-[11.5px] text-white">{fullscreenError}</small>}
    </div>
  );
}

function SpeakingBars({ level }: { level: number }) {
  return (
    <span className="flex h-3 items-end gap-[2px]" role="img" aria-label={level > SPEAKING_LEVEL ? "Speaking" : "Microphone on"}>
      {[0.55, 1, 0.75].map((weight, index) => (
        <span key={index} className="w-[3px] rounded-full bg-white transition-[height] duration-100" style={{ height: `${Math.max(3, Math.min(12, 3 + level * weight * 14))}px` }} />
      ))}
    </span>
  );
}

function ReactionBursts({ bursts }: { bursts: readonly Burst[] }) {
  return (
    <div aria-live="polite" className="pointer-events-none absolute inset-x-0 bottom-20 z-30 h-0">
      {bursts.map((burst, index) => (
        <span key={burst.id} className="absolute flex flex-col items-center origin-float-up" style={{ left: `${30 + ((burst.id * 17 + index * 7) % 40)}%`, "--drift": `${burst.drift}px` } as CSSProperties}>
          <span className="text-[34px]" aria-hidden="true">{burst.emoji}</span>
          <span className="rounded-full bg-black/50 px-1.5 text-[10.5px] text-white">{burst.name}</span>
          <span className="sr-only">{burst.name} reacted {burst.emoji}</span>
        </span>
      ))}
    </div>
  );
}

function DockButton({ label, active = false, off = false, onClick, children, pressed, expanded }: {
  label: string; active?: boolean; off?: boolean; onClick(): void; children: ReactNode; pressed?: boolean; expanded?: boolean;
}) {
  return (
    <button type="button" aria-label={label} title={label} aria-pressed={pressed} aria-expanded={expanded} onClick={onClick}
      className={cn("flex size-11 shrink-0 items-center justify-center rounded-full outline-none transition-[background-color,color,transform] duration-150 hover:scale-105 active:scale-95 focus-visible:ring-2 focus-visible:ring-accent/60 motion-reduce:hover:scale-100",
        off ? "bg-danger/90 text-white hover:bg-danger" : active ? "bg-ink text-app" : "bg-white/[0.07] text-ink hover:bg-white/[0.14]")}>
      {children}
    </button>
  );
}

type DockAgent = { name: string; available: boolean; present: boolean; add(): void; remove(): void };

function CallDock({ audioEnabled, videoEnabled, sharing, handUp, panelOpen, devicesOpen, peopleCount, agent, onAudio, onVideo, onShare, onReact, onHand, onPanel, onDevices, onLeave }: {
  audioEnabled: boolean; videoEnabled: boolean; sharing: boolean; handUp: boolean; panelOpen: boolean; devicesOpen: boolean; peopleCount: number; agent?: DockAgent;
  onAudio(): void; onVideo(): void; onShare(): void; onReact(emoji: CallReaction): void; onHand(): void; onPanel(): void; onDevices(): void; onLeave(): void;
}) {
  const [reacting, setReacting] = useState(false);
  return (
    <div className="relative flex justify-center">
      {reacting && (
        <div role="menu" aria-label="Reactions" className="absolute bottom-full mb-2 flex gap-1 rounded-full border border-hairline/50 bg-menu p-1.5 animate-pop-in">
          {CALL_REACTIONS.map((emoji, index) => (
            <button key={emoji} type="button" role="menuitem" aria-label={`React ${emoji}`} onClick={() => { onReact(emoji); setReacting(false); }}
              style={{ animationDelay: `${Math.min(index, 6) * 20}ms` }}
              className="flex size-10 items-center justify-center rounded-full text-[22px] outline-none transition-transform hover:scale-125 hover:bg-raised focus-visible:ring-2 focus-visible:ring-accent/60 origin-pop-badge motion-reduce:hover:scale-100">
              {emoji}
            </button>
          ))}
        </div>
      )}
      <div role="toolbar" aria-label="Call controls" className="flex max-w-full items-center gap-1.5 overflow-x-auto rounded-full border border-hairline/40 bg-panel p-1.5 origin-sheet-in [scrollbar-width:none]">
        <DockButton label={audioEnabled ? "Mute microphone" : "Unmute microphone"} off={!audioEnabled} onClick={onAudio}>{audioEnabled ? <Mic size={18} /> : <MicOff size={18} />}</DockButton>
        <DockButton label={videoEnabled ? "Turn camera off" : "Turn camera on"} off={!videoEnabled} onClick={onVideo}>{videoEnabled ? <Video size={18} /> : <VideoOff size={18} />}</DockButton>
        <DockButton label={sharing ? "Stop sharing" : "Share screen"} active={sharing} onClick={onShare}>{sharing ? <MonitorOff size={18} /> : <MonitorUp size={18} />}</DockButton>
        <DockButton label="Reactions" active={reacting} expanded={reacting} onClick={() => setReacting(!reacting)}><SmilePlus size={18} /></DockButton>
        <DockButton label={handUp ? "Lower hand" : "Raise hand"} active={handUp} pressed={handUp} onClick={onHand}><Hand size={18} /></DockButton>
        <span className="mx-0.5 h-6 w-px shrink-0 bg-hairline/60" aria-hidden="true" />
        {agent && (
          <button type="button" disabled={!agent.available && !agent.present} onClick={agent.present ? agent.remove : agent.add}
            title={agent.present ? `Remove ${agent.name}` : agent.available ? `Add ${agent.name}` : `${agent.name} can't join calls yet`}
            className={cn("flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium outline-none transition-[background-color,transform] active:scale-95 focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-40 disabled:active:scale-100",
              agent.present ? "bg-accent text-accent-ink" : "bg-white/[0.07] text-ink hover:bg-white/[0.14]")}>
            {agent.present ? <UserMinus size={16} /> : <UserPlus size={16} />}<span className="max-sm:hidden">{agent.present ? agent.name : `Add ${agent.name}`}</span>
          </button>
        )}
        <DockButton label="People" active={panelOpen} expanded={panelOpen} onClick={onPanel}>
          <span className="relative"><Users size={18} /><span className="absolute -right-2.5 -top-2 min-w-4 rounded-full bg-accent px-1 text-center text-[9.5px] font-semibold leading-4 text-accent-ink">{peopleCount}</span></span>
        </DockButton>
        <DockButton label="Call devices" active={devicesOpen} expanded={devicesOpen} onClick={onDevices}><Settings2 size={18} /></DockButton>
        <span className="mx-0.5 h-6 w-px shrink-0 bg-hairline/60" aria-hidden="true" />
        <button type="button" onClick={onLeave} aria-label="Leave call" title="Leave call"
          className="flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-danger px-4 text-[13px] font-semibold text-white outline-none transition-[filter,transform] hover:brightness-110 active:scale-95 focus-visible:ring-2 focus-visible:ring-danger/60">
          <PhoneOff size={17} /><span className="max-sm:hidden">Leave</span>
        </button>
      </div>
    </div>
  );
}

function CallLobby({ self, present, name, canJoin, joining, audioEnabled, videoEnabled, audioDevice, videoDevice, onAudio, onVideo, onAudioDevice, onVideoDevice, onJoin, notice, elsewhere }: {
  self: Person; present: readonly MemberCallParticipant[]; name: string; canJoin: boolean; joining: boolean;
  audioEnabled: boolean; videoEnabled: boolean; audioDevice: string; videoDevice: string;
  onAudio(on: boolean): void; onVideo(on: boolean): void; onAudioDevice(id: string): void; onVideoDevice(id: string): void; onJoin(): void;
  notice: string; elsewhere?: string;
}) {
  const [preview, setPreview] = useState<MediaStream | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const previewRef = useRef<MediaStream | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const devices = useMediaDevices();
  const level = useAudioLevel(preview, audioEnabled);

  const stopPreview = () => {
    previewRef.current?.getTracks().forEach((track) => track.stop());
    previewRef.current = null;
    setPreview(null);
  };
  useEffect(() => () => previewRef.current?.getTracks().forEach((track) => track.stop()), []);
  useEffect(() => {
    let cancelled = false;
    const permissions = navigator.permissions;
    if (!permissions?.query) return;
    void Promise.all([permissions.query({ name: "camera" as PermissionName }), permissions.query({ name: "microphone" as PermissionName })])
      .then(([camera, microphone]) => { if (!cancelled && camera.state === "granted" && microphone.state === "granted") setPreviewing(true); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!previewing || !navigator.mediaDevices?.getUserMedia) return;
    let cancelled = false;
    setPreviewError("");
    void captureMedia(audioEnabled, videoEnabled, audioDevice, videoDevice).then((stream) => {
      if (cancelled) { stream.getTracks().forEach((track) => track.stop()); return; }
      previewRef.current?.getTracks().forEach((track) => track.stop());
      previewRef.current = stream;
      setPreview(stream);
      void devices.refresh();
    }).catch(() => { if (!cancelled) { setPreviewError("Check the app's camera and microphone permissions."); setPreviewing(false); } });
    return () => { cancelled = true; };
  }, [previewing, audioEnabled, videoEnabled, audioDevice, videoDevice]);
  useEffect(() => {
    if (video.current) video.current.srcObject = preview;
  }, [preview]);

  const join = () => {
    stopPreview();
    setPreviewing(false);
    onJoin();
  };
  const showVideo = Boolean(preview?.getVideoTracks().length) && videoEnabled;
  const toggleClass = (on: boolean) => cn("flex size-11 items-center justify-center rounded-full outline-none transition-[background-color,transform] duration-150 hover:scale-105 active:scale-95 focus-visible:ring-2 focus-visible:ring-accent/60 motion-reduce:hover:scale-100",
    on ? "bg-white/15 text-white backdrop-blur-md hover:bg-white/25" : "bg-danger text-white");

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-3 p-4 md:p-6 origin-rise">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="text-[17px] font-semibold text-ink">{name}</h2>
          <span className="text-[13px] text-ink-tertiary">{present.length ? `${present.length} in call` : "Nobody in call"}</span>
        </div>
        {present.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="People in the call">
            {present.map((participant, index) => (
              <li key={participant.userId} style={{ animationDelay: `${Math.min(index, 6) * 20}ms` }} className="flex items-center gap-1.5 rounded-full bg-raised/70 py-0.5 pl-0.5 pr-2.5 text-[12.5px] text-ink origin-pop-badge">
                <PersonAvatar person={participant} size={22} />{participant.userId === self.userId ? "You" : displayName(participant)}
                {!participant.audioEnabled && <MicOff size={11} className="text-ink-tertiary" aria-label="Muted" />}
              </li>
            ))}
          </ul>
        )}
        <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-hairline/40 bg-[#0d0f12]">
          <video ref={video} autoPlay muted playsInline className={cn("absolute inset-0 h-full w-full -scale-x-100 object-cover transition-opacity duration-150", showVideo ? "opacity-100" : "opacity-0")} />
          {!showVideo && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
              <PersonAvatar person={self} size={84} />
              {!videoEnabled && <span className="text-[12.5px] text-white/60">Camera off</span>}
            </div>
          )}
          <div className="absolute left-3 top-3 rounded-full bg-black/45 px-2.5 py-1 text-[11.5px] text-white/85 backdrop-blur-sm">{displayName(self)}</div>
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2.5 bg-gradient-to-t from-black/70 to-transparent px-4 pb-4 pt-10">
            <button type="button" className={toggleClass(audioEnabled)} aria-pressed={audioEnabled} aria-label={audioEnabled ? "Join with the microphone off" : "Join with the microphone on"} title={audioEnabled ? "Microphone on" : "Microphone off"} onClick={() => onAudio(!audioEnabled)}>
              {audioEnabled ? <Mic size={19} /> : <MicOff size={19} />}
            </button>
            <button type="button" className={toggleClass(videoEnabled)} aria-pressed={videoEnabled} aria-label={videoEnabled ? "Join with the camera off" : "Join with the camera on"} title={videoEnabled ? "Camera on" : "Camera off"} onClick={() => onVideo(!videoEnabled)}>
              {videoEnabled ? <Video size={19} /> : <VideoOff size={19} />}
            </button>
            {!previewing && (
              <button type="button" onClick={() => setPreviewing(true)}
                className="flex h-11 items-center gap-1.5 rounded-full bg-white/15 px-4 text-[12.5px] font-medium text-white backdrop-blur-md outline-none transition-colors hover:bg-white/25 focus-visible:ring-2 focus-visible:ring-accent/60">
                <Camera size={15} />Preview
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-hairline/40 bg-panel/60 px-3 py-2.5">
          <MicMeter level={previewing && audioEnabled ? level : 0} live={previewing && audioEnabled} />
          <div className="flex min-w-0 flex-1 flex-wrap gap-2">
            <Select size="sm" className="min-w-0 flex-1" aria-label="Microphone" value={audioDevice} onChange={(event) => onAudioDevice(event.target.value)}>
              <option value="">Default microphone</option>
              {devices.microphones.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>)}
            </Select>
            <Select size="sm" className="min-w-0 flex-1" aria-label="Camera" value={videoDevice} onChange={(event) => onVideoDevice(event.target.value)}>
              <option value="">Default camera</option>
              {devices.cameras.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>)}
            </Select>
          </div>
        </div>
        {previewError && <Notice tone="danger">{previewError}</Notice>}
        <button type="button" className={cn(primaryButton, "h-11 w-full rounded-xl text-[14px] font-semibold")} onClick={join} disabled={joining || !canJoin}>
          {joining ? <Loader2 size={17} className="animate-spin" /> : <Video size={17} />}{joining ? "Joining…" : present.length ? "Join call" : "Start call"}
        </button>
        {elsewhere && <Notice>Starting this call leaves {elsewhere}.</Notice>}
        {!canJoin && <Notice>View-only members can't join.</Notice>}
        {notice && <Notice tone="danger">{notice}</Notice>}
      </div>
    </div>
  );
}

function MicMeter({ level, live }: { level: number; live: boolean }) {
  const segments = 12;
  const lit = Math.round(Math.min(1, level * 1.4) * segments);
  return (
    <div className="flex items-center gap-2" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
      <Mic size={14} className={live ? "text-ink-secondary" : "text-ink-tertiary"} aria-hidden="true" />
      <span className="flex h-4 items-center gap-[3px]">
        {Array.from({ length: segments }, (_, index) => (
          <span key={index} className={cn("w-[4px] rounded-full transition-[background-color,height] duration-75",
            index < lit ? index > segments * 0.8 ? "h-4 bg-warning" : "h-4 bg-success" : "h-2 bg-ink-tertiary/30")} />
        ))}
      </span>
    </div>
  );
}

function CallRoster({ self, present, hands, agent, onClose, className }: {
  self: Person; present: readonly MemberCallParticipant[]; hands: ReadonlySet<string>; agent?: { bot: Bot; participant: CallAgentParticipant }; onClose(): void; className?: string;
}) {
  const ordered = [...present].sort((a, b) => Number(hands.has(b.userId)) - Number(hands.has(a.userId)));
  return (
    <aside aria-label="People" className={cn("flex w-[280px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-hairline/40 bg-app p-3 animate-panel-in", className)}>
      <div className="flex items-center justify-between">
        <strong className="text-[13.5px] text-ink">In this call</strong>
        <button type="button" className={iconButton} aria-label="Close people" onClick={onClose}><X size={15} /></button>
      </div>
      <ul className="flex flex-col gap-0.5">
        {ordered.map((participant, index) => (
          <li key={participant.userId} style={{ animationDelay: `${Math.min(index, 6) * 20}ms` }} className="flex items-center gap-2.5 rounded-xl px-1.5 py-1.5 origin-rise">
            <PersonAvatar person={participant} size={30} />
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{participant.userId === self.userId ? "You" : displayName(participant)}</span>
            {hands.has(participant.userId) && <Hand size={14} className="text-warning origin-pop-badge" aria-label="Hand raised" />}
            {participant.screenSharing && <MonitorUp size={14} className="text-accent-text" aria-label="Sharing a screen" />}
            {participant.audioEnabled ? <Mic size={14} className="text-ink-tertiary" aria-label="Microphone on" /> : <MicOff size={14} className="text-danger" aria-label="Microphone off" />}
          </li>
        ))}
      </ul>
      {agent && (
        <div className="flex items-center gap-2.5 rounded-xl px-1.5 py-1.5 origin-rise">
          <BotAvatar bot={agent.bot} size={30} />
          <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{agent.bot.name}</span>
          <span className="text-[11.5px] text-ink-tertiary">{AGENT_STATE[agent.participant.state]}</span>
        </div>
      )}
    </aside>
  );
}

function CallAudio({ stream, name }: { stream: MediaStream; name: string }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const element = audio.current;
    if (!element) return;
    let active = true;
    element.srcObject = stream;
    const play = () => {
      void element.play().then(() => { if (active) setBlocked(false); }).catch((error: unknown) => {
        if (active && error instanceof DOMException && error.name === "NotAllowedError") setBlocked(true);
      });
    };
    play();
    element.addEventListener("loadedmetadata", play);
    return () => {
      active = false;
      element.removeEventListener("loadedmetadata", play);
      element.pause();
      element.srcObject = null;
    };
  }, [stream]);
  return (
    <>
      <audio ref={audio} autoPlay onPlaying={() => setBlocked(false)} />
      {blocked && (
        <button type="button" className={cn(ghostButton, "fixed bottom-4 right-4 z-40")} aria-label={`Play audio from ${name}`}
          onClick={() => { void audio.current?.play().then(() => setBlocked(false)).catch(() => setBlocked(true)); }}>
          <Volume2 size={14} />Play audio
        </button>
      )}
    </>
  );
}

function CallDevices({ audioId, videoId, onChange, onClose }: { audioId: string; videoId: string; onChange(kind: "audio" | "video", id: string): Promise<void>; onClose(): void }) {
  const devices = useMediaDevices();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const change = async (kind: "audio" | "video", id: string) => {
    setBusy(true);
    setError("");
    try {
      await onChange(kind, id);
    } catch {
      setError("Could not switch the device. Check the app's permissions.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label="Call devices" className="flex flex-col gap-2.5 rounded-2xl border border-hairline/50 bg-menu p-3 animate-pop-in">
      <div className="flex items-center justify-between">
        <strong className="text-[13px] text-ink">Devices</strong>
        <button type="button" className={iconButton} title="Close devices" aria-label="Close devices" onClick={onClose}><X size={14} /></button>
      </div>
      <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-secondary">
        <span className="flex items-center gap-1.5"><Mic size={13} />Microphone</span>
        <Select value={audioId} disabled={busy} onChange={(event) => void change("audio", event.target.value)}>
          <option value="">System default</option>
          {devices.microphones.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>)}
        </Select>
      </label>
      <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-secondary">
        <span className="flex items-center gap-1.5"><Camera size={13} />Camera</span>
        <Select value={videoId} disabled={busy} onChange={(event) => void change("video", event.target.value)}>
          <option value="">System default</option>
          {devices.cameras.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>)}
        </Select>
      </label>
      {error && <Notice tone="danger">{error}</Notice>}
    </section>
  );
}
