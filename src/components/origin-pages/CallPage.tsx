import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Loader2, Maximize2, Mic, MicOff, MonitorOff, MonitorUp, PhoneOff, Settings2, Video, VideoOff, Volume2, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useCloudSession } from "@/lib/origin-cloud";
import type { CloudUser } from "@/lib/origin-cloud";
import { createCallSignaling, formatElapsed, isScreenTrack, selectCallFocus, SELF_CAMERA, SELF_SCREEN, type CallSignaling } from "@/lib/member-call";
import { originRealtime, usePolled, type MemberCallParticipant, type MemberCallSignal, type MemberCallSignalKind, type RealtimeTarget } from "@/lib/origin-realtime";
import { Select } from "../Select";
import { CloudGate, EmptyState, Notice, ghostButton, iconButton, primaryButton, type OriginPageProps } from "./ui";
import { PersonAvatar } from "./PersonAvatar";

type Person = { userId: string; name: string; username?: string; email: string; avatarUrl?: string | null };
type RemoteMedia = { stream: MediaStream; screen: MediaStream };
type Tile = { id: string; stream?: MediaStream; person: Person; label: string; audioEnabled: boolean; videoEnabled: boolean; screenSharing?: boolean };

const PARTICIPANT_POLL_MS = 2_000;
const SIGNAL_POLL_MS = 1_200;
const HEARTBEAT_MS = 8_000;
const RESTART_CHECK_MS = 10_000;
const MAX_RESTARTS = 4;

const PARTICIPANTS = "/api/local-voice/participants";
const SIGNALS = "/api/local-voice/signals";
const CONFIG = "/api/local-voice/config";

export function CallPage(props: OriginPageProps) {
  const session = useCloudSession();
  return (
    <CloudGate {...props} label="Calls">
      {({ project, projectId, canEdit }) => session.user && project.teamId
        ? <MemberCall key={projectId} target={{ teamId: project.teamId, room: projectId }} me={session.user} canJoin={canEdit} name={project.name} emptyNote="Nobody is in this project's call yet" />
        : <EmptyState icon={<PhoneOff size={22} />} title="Calls are unavailable" body="This project is not in a shared workspace yet, so there is nobody to call." />}
    </CloudGate>
  );
}

const personOf = (user: CloudUser): Person => ({ userId: user._id, name: user.name || user.email, ...(user.username ? { username: user.username } : {}), email: user.email });
const displayName = (person: Person) => person.username || person.name || person.email;

function videoSender(connection: RTCPeerConnection, index: number) {
  return connection.getTransceivers().filter((transceiver) => transceiver.receiver.track.kind === "video")[index]?.sender;
}

export function MemberCall({ target, me, canJoin, name, emptyNote }: { target: RealtimeTarget; me: CloudUser; canJoin: boolean; name: string; emptyNote: string }) {
  const self = useMemo(() => personOf(me), [me]);
  const targetKey = `${target.teamId}:${target.room ?? ""}`;
  const { value: polledParticipants } = usePolled(
    () => originRealtime<{ participants: MemberCallParticipant[] }>(PARTICIPANTS, target).then((result) => result.participants),
    PARTICIPANT_POLL_MS, targetKey,
  );
  const participants = polledParticipants;
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [remote, setRemote] = useState<Record<string, RemoteMedia>>({});
  const [signals, setSignals] = useState<MemberCallSignal[]>([]);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [joining, setJoining] = useState(false);
  const [joinedAt, setJoinedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [audioDevice, setAudioDevice] = useState("");
  const [videoDevice, setVideoDevice] = useState("");
  const [focused, setFocused] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const previousScreens = useRef(new Set<string>());
  const screenRef = useRef<MediaStream | null>(null);
  const iceServers = useRef<RTCIceServer[]>([]);
  const localRef = useRef<MediaStream | null>(null);
  const peers = useRef(new Map<string, RTCPeerConnection>());
  const signalings = useRef(new Map<string, CallSignaling>());
  const peerSessions = useRef(new Map<string, number>());
  const ownSession = useRef(0);
  const restartTimers = useRef(new Map<string, number>());
  const processed = useRef(new Set<string>());
  const joined = useRef(false);
  const sharing = useRef(false);
  const mounted = useRef(true);
  const targetRef = useRef(target);
  targetRef.current = target;

  const api = <T,>(path: string, init?: Parameters<typeof originRealtime>[2]) => originRealtime<T>(path, targetRef.current, init);
  const leaveServer = () => api(PARTICIPANTS, { json: { action: "leave" } }).catch(() => {});

  const resetPeers = () => {
    peers.current.forEach((connection) => connection.close());
    peers.current.clear();
    signalings.current.forEach((signaling) => signaling.dispose());
    signalings.current.clear();
    peerSessions.current.clear();
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

  const cleanupPeer = (userId: string) => {
    const connection = peers.current.get(userId);
    peers.current.delete(userId);
    signalings.current.get(userId)?.dispose();
    signalings.current.delete(userId);
    peerSessions.current.delete(userId);
    window.clearTimeout(restartTimers.current.get(userId));
    restartTimers.current.delete(userId);
    connection?.close();
    setRemote((current) => {
      if (!current[userId]) return current;
      const next = { ...current };
      delete next[userId];
      return next;
    });
  };

  const sendSignal = async (toUserId: string, kind: MemberCallSignalKind, payload: string, fromJoinedAt: number, toJoinedAt?: number) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!joined.current || ownSession.current !== fromJoinedAt || peerSessions.current.get(toUserId) !== toJoinedAt) return;
      try {
        await api(SIGNALS, { json: { toUserId, kind, payload, fromJoinedAt, toJoinedAt } });
        return;
      } catch (error) {
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
    const send = (kind: MemberCallSignalKind, payload: string) => sendSignal(userId, kind, payload, fromSession, toSession);
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
      setNotice("Camera and microphone are not available here.");
      return;
    }
    let stream: MediaStream | null = null;
    setJoining(true);
    setDevicesOpen(false);
    try {
      iceServers.current = (await api<{ iceServers: RTCIceServer[] }>(CONFIG)).iceServers;
      try {
        stream = audioEnabled || videoEnabled
          ? await navigator.mediaDevices.getUserMedia({
            audio: audioEnabled ? { ...(audioDevice ? { deviceId: { exact: audioDevice } } : {}), echoCancellation: true, noiseSuppression: true } : false,
            video: videoEnabled ? { ...(videoDevice ? { deviceId: { exact: videoDevice } } : {}), width: { ideal: 1280 }, height: { ideal: 720 } } : false,
          })
          : new MediaStream();
      } catch {
        stream = audioEnabled ? await navigator.mediaDevices.getUserMedia({ audio: audioDevice ? { deviceId: { exact: audioDevice }, echoCancellation: true } : true, video: false }) : new MediaStream();
      }
      const hasAudio = stream.getAudioTracks().length > 0;
      const hasVideo = stream.getVideoTracks().length > 0;
      if (!mounted.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const presence = await api<{ joinedAt: number }>(PARTICIPANTS, { json: { action: "join", audioEnabled: hasAudio, videoEnabled: hasVideo } });
      if (!mounted.current) {
        stream.getTracks().forEach((track) => track.stop());
        await leaveServer();
        return;
      }
      joined.current = true;
      ownSession.current = presence.joinedAt;
      localRef.current = stream;
      setLocalStream(stream);
      setJoinedAt(Date.now());
      setAudioEnabled(hasAudio);
      setVideoEnabled(hasVideo);
      setNotice("");
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      if (mounted.current) setNotice(error instanceof Error ? error.message : "Could not start the call");
    } finally {
      if (mounted.current) setJoining(false);
    }
  };

  const leaveCall = async () => {
    joined.current = false;
    localRef.current?.getTracks().forEach((track) => track.stop());
    screenRef.current?.getTracks().forEach((track) => track.stop());
    screenRef.current = null;
    localRef.current = null;
    setScreenStream(null);
    setJoinedAt(null);
    setFocused(null);
    setLocalStream(null);
    setRemote({});
    resetPeers();
    await leaveServer();
  };

  const stopSharing = async () => {
    screenRef.current?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
    screenRef.current = null;
    setScreenStream(null);
    setFocused((current) => (current === SELF_SCREEN ? null : current));
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
      void api(PARTICIPANTS, { json: { action: "update", audioEnabled: kind === "audio" ? next : audioEnabled, videoEnabled: kind === "video" ? next : videoEnabled, screenSharing: Boolean(screenRef.current) } }).catch(() => {});
    }
  };

  useEffect(() => {
    if (!localStream) return;
    const heartbeat = () => { void api(PARTICIPANTS, { json: { action: "update", audioEnabled, videoEnabled, screenSharing: Boolean(screenStream) } }).catch(() => {}); };
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
        const result = await api<{ signals: MemberCallSignal[] }>(SIGNALS);
        if (alive) setSignals(result.signals);
      } catch (error) {
        if (alive) setNotice(error instanceof Error ? error.message : "Could not load call signals");
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
      if (previous !== undefined && previous !== participant.joinedAt) cleanupPeer(participant.userId);
      peerSessions.current.set(participant.userId, participant.joinedAt);
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
        if (signal.toJoinedAt !== undefined && signal.toJoinedAt !== ownSession.current) continue;
        const previous = peerSessions.current.get(signal.fromUserId);
        if (signal.fromJoinedAt !== undefined) {
          if (previous !== undefined && previous > signal.fromJoinedAt) continue;
          if (previous !== undefined && previous !== signal.fromJoinedAt) cleanupPeer(signal.fromUserId);
          peerSessions.current.set(signal.fromUserId, signal.fromJoinedAt);
        }
        ensurePeer(signal.fromUserId);
        try {
          await signalings.current.get(signal.fromUserId)?.receive(signal.kind, signal.payload);
        } catch (error) {
          setNotice(error instanceof Error ? error.message : "Call connection failed");
        }
      }
      if (acknowledged.length) await api(SIGNALS, { method: "DELETE", json: { signalIds: acknowledged } }).catch(() => {});
    };
    void handle();
  }, [localStream, signals]);

  const others = (participants ?? []).filter((participant) => participant.userId !== self.userId);
  const tiles: Tile[] = localStream ? [
    ...(screenStream ? [{ id: SELF_SCREEN, stream: screenStream, person: self, label: "Your screen", audioEnabled: false, videoEnabled: true, screenSharing: true }] : []),
    { id: SELF_CAMERA, stream: localStream, person: self, label: "You", audioEnabled, videoEnabled },
    ...others.flatMap((participant): Tile[] => {
      const media = remote[participant.userId];
      return [
        ...(participant.screenSharing && media?.screen ? [{ id: `${participant.userId}:screen`, stream: media.screen, person: participant, label: `${displayName(participant)}'s screen`, audioEnabled: false, videoEnabled: true, screenSharing: true }] : []),
        { id: `${participant.userId}:camera`, ...(media ? { stream: media.stream } : {}), person: participant, label: displayName(participant), audioEnabled: participant.audioEnabled, videoEnabled: participant.videoEnabled },
      ];
    }),
  ] : [];
  const selected = selectCallFocus(tiles, focused, previousScreens.current);
  const main = tiles.find((tile) => tile.id === selected);
  const screenIds = tiles.filter((tile) => tile.screenSharing).map((tile) => tile.id).join(",");
  useEffect(() => {
    setFocused(selected);
    previousScreens.current = new Set(screenIds ? screenIds.split(",") : []);
  }, [selected, screenIds]);

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

  const controlButton = "flex size-10 items-center justify-center rounded-full bg-raised text-ink hover:bg-raised-hover disabled:opacity-50";
  const present = participants ?? [];

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3 p-4" aria-label={`${name} call`}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5" aria-label="People in the call">
          {participants === undefined
            ? <span className="text-[12.5px] text-ink-tertiary">Checking who is here…</span>
            : present.length === 0
              ? <span className="text-[12.5px] text-ink-secondary">{emptyNote}</span>
              : present.map((participant) => (
                <button key={participant.userId} type="button" title={participant.name}
                  onClick={() => setFocused(participant.userId === self.userId ? SELF_CAMERA : `${participant.userId}:camera`)}
                  className="flex items-center gap-1.5 rounded-full bg-raised/60 py-0.5 pl-0.5 pr-2.5 text-[12.5px] text-ink hover:bg-raised">
                  <PersonAvatar person={participant} size={22} />{participant.userId === self.userId ? "You" : displayName(participant)}
                </button>
              ))}
        </div>
        {localStream
          ? <time className="tabular-nums text-[12.5px] text-ink-secondary" aria-label="Time in call">{formatElapsed(elapsed)}</time>
          : <button type="button" className={primaryButton} onClick={startCall} disabled={joining || !canJoin}>
            {joining ? <Loader2 size={14} className="animate-spin" /> : <Video size={14} />}Join call
          </button>}
        <button type="button" className={iconButton} title="Call devices" aria-label="Call devices" aria-expanded={devicesOpen} onClick={() => setDevicesOpen(!devicesOpen)}><Settings2 size={15} /></button>
      </div>
      {!canJoin && <Notice>You can see who is here, but view-only members cannot join this call.</Notice>}
      {devicesOpen && <CallDevices audioId={audioDevice} videoId={videoDevice} inCall={Boolean(localStream)} onChange={changeDevice} onClose={() => setDevicesOpen(false)} />}
      <div className="relative flex min-h-[240px] flex-1 items-center justify-center overflow-hidden rounded-xl border border-hairline/40 bg-inset">
        {main ? <CallTile key={main.id} {...main} /> : (
          <div className="flex flex-col items-center gap-3 p-6 text-center">
            <PersonAvatar person={self} size={64} />
            <h2 className="text-[16px] font-semibold text-ink">{present.length ? "Your team is here" : "Ready when you are"}</h2>
            <div className="flex gap-2">
              <button type="button" className={controlButton} aria-pressed={audioEnabled} aria-label={audioEnabled ? "Join with the microphone off" : "Join with the microphone on"} title={audioEnabled ? "Microphone on" : "Microphone off"} onClick={() => setAudioEnabled(!audioEnabled)}>
                {audioEnabled ? <Mic size={18} /> : <MicOff size={18} />}
              </button>
              <button type="button" className={controlButton} aria-pressed={videoEnabled} aria-label={videoEnabled ? "Join with the camera off" : "Join with the camera on"} title={videoEnabled ? "Camera on" : "Camera off"} onClick={() => setVideoEnabled(!videoEnabled)}>
                {videoEnabled ? <Video size={18} /> : <VideoOff size={18} />}
              </button>
            </div>
            <button type="button" className={ghostButton} onClick={() => setDevicesOpen(true)}><Settings2 size={14} />Check devices</button>
          </div>
        )}
      </div>
      {localStream && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto" aria-label="Other cameras and shared screens">
            {tiles.filter((tile) => tile.id !== selected).map((tile) => <CallTile key={tile.id} {...tile} thumbnail onFocus={() => setFocused(tile.id)} />)}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className={controlButton} aria-label={audioEnabled ? "Mute microphone" : "Unmute microphone"} title={audioEnabled ? "Mute microphone" : "Unmute microphone"} onClick={() => void toggle("audio")}>
              {audioEnabled ? <Mic size={18} /> : <MicOff size={18} />}
            </button>
            <button type="button" className={controlButton} aria-label={videoEnabled ? "Turn camera off" : "Turn camera on"} title={videoEnabled ? "Turn camera off" : "Turn camera on"} onClick={() => void toggle("video")}>
              {videoEnabled ? <Video size={18} /> : <VideoOff size={18} />}
            </button>
            <button type="button" className={cn(controlButton, screenStream && "bg-accent text-accent-ink hover:bg-accent")} aria-label={screenStream ? "Stop sharing" : "Share screen"} title={screenStream ? "Stop sharing" : "Share screen"} onClick={() => void shareScreen()}>
              {screenStream ? <MonitorOff size={18} /> : <MonitorUp size={18} />}
            </button>
            <button type="button" className={cn(controlButton, "bg-danger text-danger-ink hover:bg-danger")} aria-label="Leave call" title="Leave call" onClick={() => void leaveCall()}>
              <PhoneOff size={18} />
            </button>
          </div>
        </div>
      )}
      <div className="hidden">
        {localStream && others.map((participant) => remote[participant.userId] && <CallAudio key={participant.userId} stream={remote[participant.userId]!.stream} name={participant.name} />)}
      </div>
      {notice && <Notice tone="danger">{notice}</Notice>}
    </section>
  );
}

function CallTile({ stream, person, label, audioEnabled, videoEnabled, screenSharing = false, thumbnail = false, onFocus }: Tile & { thumbnail?: boolean; onFocus?: () => void }) {
  const video = useRef<HTMLVideoElement | null>(null);
  const tile = useRef<HTMLDivElement | null>(null);
  const [fullscreenError, setFullscreenError] = useState("");
  useEffect(() => {
    if (video.current) video.current.srcObject = stream ?? null;
  }, [stream]);
  const showVideo = videoEnabled && Boolean(stream);
  return (
    <div ref={tile} className={cn("relative flex items-center justify-center overflow-hidden rounded-xl bg-black/80",
      thumbnail ? "h-[96px] w-[150px] shrink-0" : "h-full w-full")}>
      {thumbnail && <button type="button" className="absolute inset-0 z-10 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-accent/60" aria-label={`Enlarge ${label}`} title={`Enlarge ${label}`} onClick={onFocus} />}
      <video ref={video} autoPlay muted playsInline className={cn("h-full w-full", screenSharing ? "object-contain" : "object-cover", !showVideo && "absolute size-px opacity-0")} />
      {!showVideo && (
        <div className="flex flex-col items-center gap-1.5">
          <PersonAvatar person={person} size={thumbnail ? 36 : 72} />
          {!stream && <small className="text-[11.5px] text-white/70">Connecting</small>}
        </div>
      )}
      <div className="absolute bottom-1.5 left-1.5 flex max-w-[calc(100%-12px)] items-center gap-1.5 rounded-md bg-black/55 px-1.5 py-0.5 text-[11.5px] text-white">
        <span className="truncate">{label}</span>
        {screenSharing ? <MonitorUp size={12} aria-label="Sharing a screen" /> : audioEnabled ? <Mic size={12} aria-label="Microphone on" /> : <MicOff size={12} aria-label="Microphone off" />}
      </div>
      {!thumbnail && showVideo && (
        <button type="button" className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-lg bg-black/55 text-white hover:bg-black/75" title="Full screen" aria-label={`Full screen ${label}`}
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
      {fullscreenError && <small role="status" className="absolute left-2 top-2 rounded-md bg-black/55 px-1.5 py-0.5 text-[11.5px] text-white">{fullscreenError}</small>}
    </div>
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

function CallDevices({ audioId, videoId, inCall, onChange, onClose }: { audioId: string; videoId: string; inCall: boolean; onChange(kind: "audio" | "video", id: string): Promise<void>; onClose(): void }) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<MediaStream | null>(null);
  const previewRef = useRef<MediaStream | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const refresh = () => navigator.mediaDevices?.enumerateDevices().then((found) => { if (mounted.current) setDevices(found); }).catch(() => {});
    void refresh();
    navigator.mediaDevices?.addEventListener("devicechange", refresh);
    return () => {
      mounted.current = false;
      previewRef.current?.getTracks().forEach((track) => track.stop());
      navigator.mediaDevices?.removeEventListener("devicechange", refresh);
    };
  }, []);
  useEffect(() => {
    if (video.current) video.current.srcObject = preview;
  }, [preview]);
  const stopPreview = () => {
    previewRef.current?.getTracks().forEach((track) => track.stop());
    previewRef.current = null;
    setPreview(null);
  };
  const test = async () => {
    if (preview) {
      stopPreview();
      return;
    }
    setBusy(true);
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioId ? { deviceId: { exact: audioId }, echoCancellation: true } : true,
        video: videoId ? { deviceId: { exact: videoId } } : true,
      });
      if (!mounted.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      previewRef.current = stream;
      setPreview(stream);
      setDevices(await navigator.mediaDevices.enumerateDevices());
    } catch {
      setError("Check the app's camera and microphone permissions.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const change = async (kind: "audio" | "video", id: string) => {
    stopPreview();
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
  const microphones = devices.filter((device) => device.kind === "audioinput" && device.deviceId && device.deviceId !== "default");
  const cameras = devices.filter((device) => device.kind === "videoinput" && device.deviceId);
  return (
    <section aria-label="Call devices" className="flex flex-col gap-2.5 rounded-xl border border-hairline/40 bg-panel p-3">
      <div className="flex items-center justify-between">
        <strong className="text-[13px] text-ink">Devices</strong>
        <button type="button" className={iconButton} title="Close devices" aria-label="Close devices" onClick={onClose}><X size={14} /></button>
      </div>
      <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-secondary">
        <span className="flex items-center gap-1.5"><Mic size={13} />Microphone</span>
        <Select value={audioId} disabled={busy} onChange={(event) => void change("audio", event.target.value)}>
          <option value="">System default</option>
          {microphones.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>)}
        </Select>
      </label>
      <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-secondary">
        <span className="flex items-center gap-1.5"><Camera size={13} />Camera</span>
        <Select value={videoId} disabled={busy} onChange={(event) => void change("video", event.target.value)}>
          <option value="">System default</option>
          {cameras.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>)}
        </Select>
      </label>
      {!inCall && (
        <button type="button" className={cn(ghostButton, "self-start")} disabled={busy} onClick={() => void test()}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}{preview ? "Stop preview" : "Test camera and microphone"}
        </button>
      )}
      {preview && <video ref={video} autoPlay playsInline muted className="max-h-[180px] w-full rounded-lg bg-black object-cover" />}
      {error && <Notice tone="danger">{error}</Notice>}
    </section>
  );
}
