"use client";

import clsx from "clsx";
import { CircleAlert, Loader2, Maximize2, Mic, MicOff, MonitorOff, MonitorUp, PhoneOff, Settings2, Video, VideoOff, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { errorText, mediaErrorText } from "@/lib/error-text";
import { localApi as requestLocalApi } from "@/lib/client-api";
import { createCallSignaling } from "@/lib/call-signaling";
import { isScreenTrack, selectCallFocus } from "@/lib/call-layout";
import { useMemberProfile, useWorkspace } from "./workspace-context";
import { CallDevices } from "./call-devices";
import { CallAudio } from "./call-audio";
import { UserAvatar, memberName } from "./user-avatar";
import { ContentSkeleton } from "./content-skeleton";
import { useLocalVoiceParticipants } from "./use-voice-participants";
import type { AuthUser } from "./origin-app";

type RemoteCallStream = { stream: MediaStream; screen?: MediaStream; addedAt: number };
type AvatarUser = { username?: string; name: string; email: string; avatarUrl?: string | null };
type LocalVoiceSignal = {
  id: string;
  fromUserId: Id<"users">;
  toUserId: Id<"users">;
  fromJoinedAt?: number;
  toJoinedAt?: number;
  kind: "offer" | "answer" | "candidate";
  payload: string;
  createdAt: number;
};

export function VoiceChatView({ sessionToken, user }: { sessionToken: string; user: AuthUser }) {
  const workspace = useWorkspace();
  const localApi = <T,>(path: string, token: string, init: RequestInit & { json?: unknown } = {}) => requestLocalApi<T>(`${path}?teamId=${workspace._id}`, token, init);
  const participants = useLocalVoiceParticipants(sessionToken);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, RemoteCallStream>>({});
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [notice, setNotice] = useState("");
  const [signals, setSignals] = useState<LocalVoiceSignal[]>([]);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [joining, setJoining] = useState(false);
  const [joinedAt, setJoinedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [audioDevice, setAudioDevice] = useState("");
  const [videoDevice, setVideoDevice] = useState("");
  const [focusedTile, setFocusedTile] = useState<string | null>(null);
  // True once the person picks a tile; until then the stage follows selectCallFocus's automatic choice.
  const [pinnedTile, setPinnedTile] = useState(false);
  const chooseTile = (id: string) => { setFocusedTile(id); setPinnedTile(true); };
  // Lobby camera preview: only while the Call view is on screen, the camera is on and access was granted or asked for.
  const lobbyRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const [lobbyVisible, setLobbyVisible] = useState(false);
  const [previewAllowed, setPreviewAllowed] = useState(false);
  const [preview, setPreview] = useState<MediaStream | null>(null);
  const [previewError, setPreviewError] = useState("");
  const previousScreensRef = useRef(new Set<string>());
  const screenRef = useRef<MediaStream | null>(null);
  const iceServersRef = useRef<RTCIceServer[]>([]);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef(new Map<string, RTCPeerConnection>());
  const signalingRef = useRef(new Map<string, ReturnType<typeof createCallSignaling>>());
  const peerSessionsRef = useRef(new Map<string, number>());
  const ownSessionRef = useRef(0);
  const restartTimersRef = useRef(new Map<string, number>());
  const processedSignalsRef = useRef(new Set<string>());
  const joinedRef = useRef(false);
  const sharingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    localStreamRef.current = localStream;
  }, [localStream]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const wasJoined = joinedRef.current;
      joinedRef.current = false;
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      screenRef.current?.getTracks().forEach((track) => track.stop());
      peerConnectionsRef.current.forEach((connection) => connection.close());
      peerConnectionsRef.current.clear();
      signalingRef.current.forEach(signaling => signaling.dispose());
      signalingRef.current.clear(); peerSessionsRef.current.clear();
      restartTimersRef.current.forEach(timer => window.clearTimeout(timer)); restartTimersRef.current.clear();
      processedSignalsRef.current.clear();
      if (wasJoined) {
        void localApi("/api/local-voice/participants", sessionToken, { method: "POST", json: { action: "leave" } }).catch(() => {});
      }
    };
  }, [sessionToken]);

  const cleanupPeer = (remoteUserId: string) => {
    const connection = peerConnectionsRef.current.get(remoteUserId);
    peerConnectionsRef.current.delete(remoteUserId);
    signalingRef.current.get(remoteUserId)?.dispose(); signalingRef.current.delete(remoteUserId);
    peerSessionsRef.current.delete(remoteUserId);
    window.clearTimeout(restartTimersRef.current.get(remoteUserId)); restartTimersRef.current.delete(remoteUserId);
    connection?.close();
    setRemoteStreams((current) => {
      if (!current[remoteUserId]) return current;
      const next = { ...current };
      delete next[remoteUserId];
      return next;
    });
  };

  const sendPeerSignal = async (toUserId: Id<"users">, kind: "offer" | "answer" | "candidate", payload: string, fromJoinedAt: number, toJoinedAt?: number) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!joinedRef.current || ownSessionRef.current !== fromJoinedAt || peerSessionsRef.current.get(toUserId) !== toJoinedAt) return;
      try { await localApi("/api/local-voice/signals", sessionToken, { method: "POST", json: { toUserId, kind, payload, fromJoinedAt, toJoinedAt } }); return; }
      catch (error) { if (attempt === 2) throw error; await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1))); }
    }
  };

  const ensurePeerConnection = (remoteUserId: Id<"users">) => {
    const key = remoteUserId.toString();
    const existing = peerConnectionsRef.current.get(key);
    if (existing) return existing;

    const connection = new RTCPeerConnection({ iceServers: iceServersRef.current });
    const fromSession = ownSessionRef.current, toSession = peerSessionsRef.current.get(key);
    const send = (kind: "offer" | "answer" | "candidate", payload: string) => sendPeerSignal(remoteUserId, kind, payload, fromSession, toSession);
    const signaling = createCallSignaling(connection, user._id.toString() < key, send);
    signalingRef.current.set(key, signaling);
    const signalError = (error: unknown) => { if (joinedRef.current && peerConnectionsRef.current.get(key) === connection) setNotice(errorText(error, "Could not connect call")); };
    connection.onnegotiationneeded = () => { void signaling.offer().catch(signalError); };
    const stream = localStreamRef.current;
    const audioTrack = stream?.getAudioTracks()[0];
    const videoTrack = stream?.getVideoTracks()[0];
    if (audioTrack && stream) connection.addTrack(audioTrack, stream);
    else connection.addTransceiver("audio", { direction: "sendrecv", streams: stream ? [stream] : [] });
    if (videoTrack && stream) connection.addTrack(videoTrack, stream);
    else connection.addTransceiver("video", { direction: "sendrecv", streams: stream ? [stream] : [] });
    // Reserve a separate video transceiver so screen sharing never replaces the camera.
    connection.addTransceiver(screenRef.current?.getVideoTracks()[0] || "video", { direction: "sendrecv", streams: [screenRef.current || new MediaStream()] });
    connection.onicecandidate = (event) => {
      if (event.candidate) void send("candidate", JSON.stringify(event.candidate.toJSON())).catch(signalError);
    };
    connection.ontrack = (event) => {
      if (peerConnectionsRef.current.get(key) !== connection) return;
      // Simultaneous offers can leave an extra reserved video slot before the incoming screen.
      const screenTrack = isScreenTrack(connection.getTransceivers(), event.track);
      setRemoteStreams(current => {
        const stream = new MediaStream(current[key]?.stream.getTracks().filter(track => track.readyState === "live") || []);
        const screen = new MediaStream(current[key]?.screen?.getTracks().filter(track => track.readyState === "live") || []);
        const target = screenTrack ? screen : stream;
        target.getTracks().filter(track => track.kind === event.track.kind && track !== event.track).forEach(track => target.removeTrack(track));
        if (!target.getTracks().includes(event.track)) target.addTrack(event.track);
        return { ...current, [key]: { stream, screen, addedAt: current[key]?.addedAt ?? Date.now() } };
      });
    };
    let restartAttempts = 0;
    const scheduleRestart = (delay: number) => {
      if (restartTimersRef.current.has(key)) return;
      const timer = window.setTimeout(() => {
        restartTimersRef.current.delete(key);
        if (!joinedRef.current || peerConnectionsRef.current.get(key) !== connection || connection.connectionState === "connected") return;
        if (++restartAttempts > 4) { setNotice("Connection interrupted. Leave and rejoin to reconnect."); return; }
        void localApi<{ iceServers: RTCIceServer[] }>("/api/local-voice/config", sessionToken).then(config => {
          if (peerConnectionsRef.current.get(key) !== connection || !joinedRef.current) return;
          iceServersRef.current = config.iceServers; connection.setConfiguration({ iceServers: config.iceServers });
          return signaling.offer(true);
        }).catch(signalError);
        // Keep checking: a restart whose offer or answer is lost would otherwise stay "connecting".
        scheduleRestart(10_000);
      }, delay);
      restartTimersRef.current.set(key, timer);
    };
    connection.onconnectionstatechange = () => {
      if (peerConnectionsRef.current.get(key) !== connection || !joinedRef.current) return;
      if (connection.connectionState === "connected") {
        restartAttempts = 0; window.clearTimeout(restartTimersRef.current.get(key)); restartTimersRef.current.delete(key); setNotice("");
      } else if (["disconnected", "failed"].includes(connection.connectionState)) {
        if (connection.connectionState === "failed") { window.clearTimeout(restartTimersRef.current.get(key)); restartTimersRef.current.delete(key); }
        scheduleRestart(connection.connectionState === "failed" ? 500 : 4000);
      } else if (connection.connectionState === "closed") cleanupPeer(key);
    };
    // A lost offer or answer leaves the peer "new" or "connecting" with no state change to react to.
    scheduleRestart(10_000);
    peerConnectionsRef.current.set(key, connection);
    return connection;
  };

  const startCall = async () => {
    if (joining || localStreamRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setNotice("Camera and microphone are not available in this browser.");
      return;
    }
    let stream: MediaStream | null = null;
    let mediaIssue = "";
    setJoining(true);
    setDevicesOpen(false);
    try {
      const configuration = await localApi<{ iceServers: RTCIceServer[] }>("/api/local-voice/config", sessionToken);
      iceServersRef.current = configuration.iceServers;
      try {
        stream = audioEnabled || videoEnabled ? await navigator.mediaDevices.getUserMedia({ audio: audioEnabled ? { ...(audioDevice ? { deviceId: { exact: audioDevice } } : {}), echoCancellation: true, noiseSuppression: true } : false, video: videoEnabled ? { ...(videoDevice ? { deviceId: { exact: videoDevice } } : {}), width: { ideal: 1280 }, height: { ideal: 720 } } : false }) : new MediaStream();
      } catch (error) {
        // Fall back to audio only, then to listening only, so a missing or blocked device never blocks joining.
        try { stream = audioEnabled ? await navigator.mediaDevices.getUserMedia({ audio: audioDevice ? { deviceId: { exact: audioDevice }, echoCancellation: true } : true, video: false }) : new MediaStream(); }
        catch (audioError) { stream = new MediaStream(); mediaIssue = mediaErrorText(audioError); }
        if (!mediaIssue && videoEnabled) mediaIssue = mediaErrorText(error, "camera");
      }
      const hasAudio = stream.getAudioTracks().length > 0;
      const hasVideo = stream.getVideoTracks().length > 0;
      if (!mountedRef.current) { stream.getTracks().forEach(track => track.stop()); return; }
      const presence = await localApi<{ joinedAt: number }>("/api/local-voice/participants", sessionToken, {
        method: "POST",
        json: { action: "join", audioEnabled: hasAudio, videoEnabled: hasVideo },
      });
      if (!mountedRef.current) {
        stream.getTracks().forEach(track => track.stop());
        await localApi("/api/local-voice/participants", sessionToken, { method: "POST", json: { action: "leave" } });
        return;
      }
      joinedRef.current = true;
      ownSessionRef.current = presence.joinedAt;
      localStreamRef.current = stream;
      setLocalStream(stream);
      setDevicesOpen(false);
      setJoinedAt(Date.now());
      setAudioEnabled(hasAudio);
      setVideoEnabled(hasVideo);
      setNotice(mediaIssue);
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      if (mountedRef.current) setNotice(errorText(error, "Could not start call"));
    } finally { if (mountedRef.current) setJoining(false); }
  };
  const leaveCall = async () => {
    joinedRef.current = false;
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenRef.current?.getTracks().forEach((track) => track.stop());
    screenRef.current = null; localStreamRef.current = null;
    setScreenStream(null); setJoinedAt(null); setFocusedTile(null); setPinnedTile(false);
    setLocalStream(null);
    setRemoteStreams({});
    peerConnectionsRef.current.forEach((connection) => connection.close());
    peerConnectionsRef.current.clear();
    signalingRef.current.forEach(signaling => signaling.dispose()); signalingRef.current.clear(); peerSessionsRef.current.clear();
    restartTimersRef.current.forEach(timer => window.clearTimeout(timer)); restartTimersRef.current.clear();
    processedSignalsRef.current.clear();
    await localApi("/api/local-voice/participants", sessionToken, { method: "POST", json: { action: "leave" } }).catch(() => {});
  };
  const stopSharing = async () => {
    screenRef.current?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    screenRef.current = null; setScreenStream(null); setFocusedTile(current => current === "self:screen" ? null : current);
    await Promise.allSettled([...peerConnectionsRef.current.values()].map(connection => connection.getTransceivers().filter(t => t.receiver.track.kind === "video")[1]?.sender.replaceTrack(null)));
  };
  const shareScreen = async () => {
    if (sharingRef.current || !joinedRef.current) return;
    if (screenRef.current) { await stopSharing(); return; }
    if (!navigator.mediaDevices?.getDisplayMedia) { setNotice("Screen sharing is not supported in this browser. You can still view a teammate's screen."); return; }
    let screen: MediaStream | null = null;
    sharingRef.current = true;
    try {
      screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: false });
      if (!joinedRef.current) { screen.getTracks().forEach(track => track.stop()); return; }
      const track = screen.getVideoTracks()[0];
      screenRef.current = screen;
      await Promise.all([...peerConnectionsRef.current.values()].map(connection => connection.getTransceivers().filter(t => t.receiver.track.kind === "video")[1]?.sender.replaceTrack(track)));
      track.onended = () => { void stopSharing(); };
      if (!joinedRef.current || track.readyState === "ended") { await stopSharing(); return; }
      setScreenStream(screen); setNotice("");
    } catch (error) {
      screen?.getTracks().forEach(track => track.stop());
      await stopSharing();
      if (!(error instanceof DOMException && error.name === "NotAllowedError")) setNotice(errorText(error, "Could not share screen"));
    } finally { sharingRef.current = false; }
  };
  useEffect(() => { if (!joinedAt) return; const tick = () => setElapsed(Math.floor((Date.now() - joinedAt) / 1000)); tick(); const timer = setInterval(tick, 1000); return () => clearInterval(timer); }, [joinedAt]);
  const toggleAudio = async () => {
    const next = !audioEnabled;
    if (next && localStream && !localStream.getAudioTracks().some(t => t.readyState === "live")) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: audioDevice ? { deviceId: { exact: audioDevice }, echoCancellation: true } : true });
        if (!joinedRef.current || localStreamRef.current !== localStream) { stream.getTracks().forEach(track => track.stop()); return; }
        const track = stream.getAudioTracks()[0];
        localStream.addTrack(track);
        await Promise.all([...peerConnectionsRef.current.values()].map(pc => pc.getTransceivers().find(t => t.receiver.track.kind === "audio")?.sender.replaceTrack(track)));
      } catch { setNotice("Microphone access was denied. Check your browser permissions."); return; }
    }
    localStream?.getAudioTracks().forEach((track) => { track.enabled = next; });
    setAudioEnabled(next);
    if (localStream) {
      void localApi("/api/local-voice/participants", sessionToken, {
        method: "POST",
        json: { action: "update", audioEnabled: next, videoEnabled, screenSharing: !!screenRef.current },
      }).catch(() => {});
    }
  };
  const toggleVideo = async () => {
    const next = !videoEnabled;
    if (next && localStream && !localStream.getVideoTracks().some(t => t.readyState === "live")) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: videoDevice ? { deviceId: { exact: videoDevice } } : true });
        if (!joinedRef.current || localStreamRef.current !== localStream) { stream.getTracks().forEach(track => track.stop()); return; }
        const track = stream.getVideoTracks()[0];
        localStream.addTrack(track);
        await Promise.all([...peerConnectionsRef.current.values()].map(pc => pc.getTransceivers().find(t => t.receiver.track.kind === "video")?.sender.replaceTrack(track)));
      } catch { setNotice("Camera access was denied. Check your browser permissions."); return; }
    }
    localStream?.getVideoTracks().forEach((track) => { track.enabled = next; });
    setVideoEnabled(next);
    if (localStream) {
      void localApi("/api/local-voice/participants", sessionToken, {
        method: "POST",
        json: { action: "update", audioEnabled, videoEnabled: next, screenSharing: !!screenRef.current },
      }).catch(() => {});
    }
  };

  useEffect(() => {
    if (!localStream) return;
    const heartbeat = () => {
      void localApi("/api/local-voice/participants", sessionToken, {
        method: "POST",
        json: { action: "update", audioEnabled, videoEnabled, screenSharing: !!screenStream },
      }).catch(() => {});
    };
    heartbeat();
    const interval = window.setInterval(heartbeat, 8_000);
    return () => window.clearInterval(interval);
  }, [audioEnabled, localStream, sessionToken, videoEnabled, screenStream]);

  useEffect(() => {
    if (!localStream) {
      setSignals([]);
      return;
    }
    let alive = true;
    const load = async () => {
      try {
        const result = await localApi<{ signals: LocalVoiceSignal[] }>("/api/local-voice/signals", sessionToken);
        if (alive) setSignals(result.signals);
      } catch (error) {
        if (alive) setNotice(errorText(error, "Could not load call signals"));
      }
    };
    void load();
    const interval = window.setInterval(load, 1_200);
    return () => {
      alive = false;
      window.clearInterval(interval);
    };
  }, [localStream, sessionToken]);

  useEffect(() => {
    if (!localStream || !participants) return;
    const remoteParticipants = participants.filter((participant) => participant.userId !== user._id);
    const activeRemoteIds = new Set(remoteParticipants.map((participant) => participant.userId.toString()));
    peerConnectionsRef.current.forEach((_, remoteUserId) => {
      if (!activeRemoteIds.has(remoteUserId)) cleanupPeer(remoteUserId);
    });
    for (const participant of remoteParticipants) {
      const previousSession = peerSessionsRef.current.get(participant.userId);
      if (previousSession !== undefined && previousSession > participant.joinedAt) continue;
      if (previousSession !== undefined && previousSession !== participant.joinedAt) cleanupPeer(participant.userId);
      peerSessionsRef.current.set(participant.userId, participant.joinedAt);
      ensurePeerConnection(participant.userId);
    }
  }, [localStream, participants, user._id]);

  useEffect(() => {
    if (!localStream || !signals?.length) return;
    const handleSignals = async () => {
      const ackIds: string[] = [];
      for (const signal of signals) {
        if (!joinedRef.current) break;
        const key = signal.id;
        if (processedSignalsRef.current.has(key)) continue;
        processedSignalsRef.current.add(key);
        ackIds.push(signal.id);
        if (signal.toJoinedAt !== undefined && signal.toJoinedAt !== ownSessionRef.current) continue;
        const previousSession = peerSessionsRef.current.get(signal.fromUserId);
        if (signal.fromJoinedAt !== undefined) {
          if (previousSession !== undefined && previousSession > signal.fromJoinedAt) continue;
          if (previousSession !== undefined && previousSession !== signal.fromJoinedAt) cleanupPeer(signal.fromUserId);
          peerSessionsRef.current.set(signal.fromUserId, signal.fromJoinedAt);
        }
        ensurePeerConnection(signal.fromUserId);
        try {
          await signalingRef.current.get(signal.fromUserId)?.receive(signal.kind, signal.payload);
        } catch (error) {
          setNotice(errorText(error, "Call connection failed"));
        }
      }
      if (ackIds.length) {
        await localApi("/api/local-voice/signals", sessionToken, { method: "DELETE", json: { signalIds: ackIds } }).catch(() => {});
      }
    };
    void handleSignals();
  }, [localStream, sessionToken, signals]);

  const activeParticipants = participants ?? [];
  const remoteParticipants = activeParticipants.filter((participant) => participant.userId !== user._id);
  const callTiles: { id: string; stream?: MediaStream; participant: AvatarUser; label: string; audioEnabled: boolean; videoEnabled: boolean; screenSharing?: boolean; mirror?: boolean }[] = localStream ? [
    ...(screenStream ? [{ id: "self:screen", stream: screenStream, participant: user, label: "Your screen", audioEnabled: false, videoEnabled: true, screenSharing: true }] : []),
    { id: "self:camera", stream: localStream, participant: user, label: "You", audioEnabled, videoEnabled, mirror: true },
    ...remoteParticipants.flatMap(participant => {
      const remote = remoteStreams[participant.userId];
      return [
        ...(participant.screenSharing && remote?.screen ? [{ id: `${participant.userId}:screen`, stream: remote.screen, participant, label: `${memberName(participant)}'s screen`, audioEnabled: false, videoEnabled: true, screenSharing: true }] : []),
        { id: `${participant.userId}:camera`, stream: remote?.stream, participant, label: memberName(participant), audioEnabled: participant.audioEnabled, videoEnabled: participant.videoEnabled },
      ];
    }),
  ] : [];
  const selectedTileId = selectCallFocus(callTiles, focusedTile, previousScreensRef.current, pinnedTile);
  const mainTile = callTiles.find(tile => tile.id === selectedTileId);
  const screenTileIds = callTiles.filter(tile => tile.screenSharing).map(tile => tile.id).join(",");
  useEffect(() => {
    previousScreensRef.current = new Set(screenTileIds ? screenTileIds.split(",") : []);
    if (focusedTile === selectedTileId) return;
    setFocusedTile(selectedTileId);
    setPinnedTile(false);
  }, [selectedTileId, screenTileIds, focusedTile]);
  useEffect(() => {
    const element = lobbyRef.current;
    if (!element || localStream) return;
    const observer = new IntersectionObserver(([entry]) => setLobbyVisible(entry.isIntersecting));
    observer.observe(element);
    return () => observer.disconnect();
  }, [localStream]);
  useEffect(() => {
    let alive = true;
    void navigator.permissions?.query({ name: "camera" as PermissionName }).then(status => { if (alive && status.state === "granted") setPreviewAllowed(true); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const previewWanted = lobbyVisible && videoEnabled && previewAllowed && !localStream && !joining;
  useEffect(() => {
    if (!previewWanted || !navigator.mediaDevices?.getUserMedia) return;
    let alive = true, stream: MediaStream | null = null;
    void navigator.mediaDevices.getUserMedia({ video: videoDevice ? { deviceId: { exact: videoDevice } } : true, audio: false }).then(captured => {
      stream = captured;
      if (!alive) { captured.getTracks().forEach(track => track.stop()); return; }
      setPreview(captured); setPreviewError("");
    }).catch(error => {
      if (!alive) return;
      setPreviewError(mediaErrorText(error, "camera"));
      setVideoEnabled(false);
    });
    return () => { alive = false; stream?.getTracks().forEach(track => track.stop()); setPreview(null); };
  }, [previewWanted, videoDevice]);
  useEffect(() => { if (previewRef.current) previewRef.current.srcObject = preview; }, [preview]);
  const toggleLobbyCamera = () => {
    const next = !videoEnabled;
    setVideoEnabled(next);
    if (next) { setPreviewAllowed(true); setPreviewError(""); }
  };
  const changeDevice = async (kind: "audio" | "video", deviceId: string) => {
    const stream = localStreamRef.current;
    if (stream && (kind === "audio" ? audioEnabled : videoEnabled)) {
      const capture = await navigator.mediaDevices.getUserMedia({ [kind]: deviceId ? { deviceId: { exact: deviceId } } : true });
      if (!joinedRef.current || localStreamRef.current !== stream) { capture.getTracks().forEach(track => track.stop()); return; }
      const track = capture.getTracks()[0];
      try {
        await Promise.all([...peerConnectionsRef.current.values()].map(pc => pc.getTransceivers().find(t => t.receiver.track.kind === kind)?.sender.replaceTrack(track)));
        stream.getTracks().filter(t => t.kind === kind).forEach(t => { stream.removeTrack(t); t.stop(); });
        stream.addTrack(track); const next = new MediaStream(stream.getTracks()); localStreamRef.current = next; setLocalStream(next);
      } catch (error) { capture.getTracks().forEach(t => t.stop()); throw error; }
    } else if (stream) {
      // A device selected while muted is acquired only after explicitly unmuting.
      stream.getTracks().filter(t => t.kind === kind).forEach(t => { stream.removeTrack(t); t.stop(); });
    }
    if (kind === "audio") setAudioDevice(deviceId); else setVideoDevice(deviceId);
  };
  return (
    <section className="voice-workspace">
      <div className={clsx("call-utility-bar", !localStream && !activeParticipants.length && "idle")}><h1 className="call-title">Call</h1><div className="call-participant-strip" aria-label="Call participants">{participants === undefined ? <ContentSkeleton label="Loading participants" rows={1} /> : activeParticipants.map(participant => <button key={participant.userId} className="call-participant-chip" onClick={() => chooseTile(participant.userId === user._id ? "self:camera" : `${participant.userId}:camera`)}><UserAvatar user={participant.userId === user._id ? user : participant} size="small" /><span>{participant.userId === user._id ? "You" : memberName(participant)}</span></button>)}</div><div className="call-header-actions">{localStream && <time className="call-elapsed" aria-label="Call duration">{Math.floor(elapsed / 60).toString().padStart(2, "0")}:{(elapsed % 60).toString().padStart(2, "0")}</time>}<button className="icon-button" title="Call devices" aria-label="Call devices" aria-expanded={devicesOpen} onClick={() => setDevicesOpen(!devicesOpen)}><Settings2 size={16} /></button></div></div>
      {devicesOpen && <><button type="button" className="call-device-scrim" tabIndex={-1} aria-label="Close devices" onClick={() => setDevicesOpen(false)} /><CallDevices audioId={audioDevice} videoId={videoDevice} inCall={!!localStream || Boolean(preview)} onChange={changeDevice} onClose={() => setDevicesOpen(false)} /></>}
      {notice ? <div className="notice danger call-notice" role="alert"><CircleAlert size={15} /><span>{notice}</span><button className="icon-button" aria-label="Dismiss" onClick={() => setNotice("")}><X size={14} /></button></div> : null}
      <div className="call-dock" hidden={!localStream}>
        <div className="call-filmstrip" aria-label="Other cameras and shared screens">
          {callTiles.filter(tile => tile.id !== selectedTileId).map(tile => <CallVideoTile key={tile.id} {...tile} thumbnail onFocus={() => chooseTile(tile.id)} />)}
        </div>
        {localStream && <div className="call-controls">
          <button type="button" className={audioEnabled ? "" : "is-off"} aria-label={audioEnabled ? "Mute microphone" : "Unmute microphone"} title={audioEnabled ? "Mute microphone" : "Unmute microphone"} onClick={toggleAudio}>{audioEnabled ? <Mic size={18} /> : <MicOff size={18} />}</button>
          <button type="button" className={videoEnabled ? "" : "is-off"} aria-label={videoEnabled ? "Turn camera off" : "Turn camera on"} title={videoEnabled ? "Turn camera off" : "Turn camera on"} onClick={toggleVideo}>{videoEnabled ? <Video size={18} /> : <VideoOff size={18} />}</button>
          <button type="button" className={screenStream ? "sharing" : ""} aria-label={screenStream ? "Stop sharing" : "Share screen"} title={screenStream ? "Stop sharing" : "Share screen"} onClick={shareScreen}>{screenStream ? <MonitorOff size={18} /> : <MonitorUp size={18} />}</button>
          <button type="button" className="leave-call" aria-label="Leave call" title="Leave call" onClick={leaveCall}><PhoneOff size={18} /></button>
        </div>}
      </div>
      <div className="voice-workspace-grid">
        <div className={clsx("voice-room stage", localStream && "in-call call-main-stage")}>
          {mainTile ? (
            <CallVideoTile key={mainTile.id} {...mainTile} />
          ) : (
            <div ref={lobbyRef} className="call-lobby">
              <div className={clsx("lobby-preview", preview && "has-video")}>
                <video ref={previewRef} autoPlay muted playsInline aria-hidden="true" />
                {!preview && <div className="video-avatar"><UserAvatar user={user} /></div>}
                <div className="lobby-devices">
                  <button title={audioEnabled ? "Microphone on" : "Microphone off"} aria-label="Microphone" aria-pressed={audioEnabled} onClick={() => setAudioEnabled(!audioEnabled)}>{audioEnabled ? <Mic size={18} /> : <MicOff size={18} />}</button>
                  <button title={videoEnabled ? "Camera on" : "Camera off"} aria-label="Camera" aria-pressed={videoEnabled} onClick={toggleLobbyCamera}>{videoEnabled ? <Video size={18} /> : <VideoOff size={18} />}</button>
                  <button className="lobby-settings" aria-label="Call devices" title="Call devices" aria-expanded={devicesOpen} onClick={() => setDevicesOpen(!devicesOpen)}><Settings2 size={18} /></button>
                </div>
              </div>
              {previewError && <p className="lobby-error" role="status"><CircleAlert size={14} />{previewError}</p>}
              <div className="lobby-join-row">
                {remoteParticipants.length > 0 && <span className="lobby-in-call"><span className="lobby-in-call-avatars" aria-hidden="true">{remoteParticipants.slice(0, 3).map(participant => <UserAvatar key={participant.userId} user={participant} size="small" />)}</span>{remoteParticipants.map(participant => memberName(participant).split(" ")[0]).slice(0, 3).join(", ")}{remoteParticipants.length > 3 ? ` +${remoteParticipants.length - 3}` : ""} in call</span>}
                <button className="primary-button lobby-join" onClick={startCall} disabled={joining || workspace.role === "viewer"}>{joining ? <Loader2 className="spin" size={16} /> : <Video size={16} />}Join call</button>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="call-audio-output">{localStream && remoteParticipants.map(participant => remoteStreams[participant.userId] && <CallAudio key={participant.userId} stream={remoteStreams[participant.userId].stream} name={participant.name} />)}</div>
    </section>
  );
}

function CallVideoTile({
  stream,
  participant,
  label,
  audioEnabled,
  videoEnabled,
  screenSharing = false,
  thumbnail = false,
  mirror = false,
  onFocus,
}: {
  stream?: MediaStream;
  participant: AvatarUser;
  label?: string;
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenSharing?: boolean;
  thumbnail?: boolean;
  /** Your own camera shows mirrored, as in a mirror; what others receive is not flipped. */
  mirror?: boolean;
  onFocus?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const tileRef = useRef<HTMLDivElement | null>(null);
  const [fullscreenError, setFullscreenError] = useState("");
  const openMember = useMemberProfile();
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream ?? null;
  }, [stream]);
  return (
    <div ref={tileRef} className={clsx("call-tile", (!videoEnabled || !stream) && "video-off", screenSharing && "screen-share-tile", thumbnail && "call-thumbnail", mirror && "is-mirrored")}>
      {thumbnail && <button type="button" className="call-tile-focus" title={`Enlarge ${label || participant.name}`} aria-label={`Enlarge ${label || participant.name}`} onClick={onFocus} />}
      <video ref={videoRef} autoPlay muted playsInline style={!videoEnabled || !stream ? { position: "absolute", width: 1, height: 1, opacity: 0 } : undefined} />{(!videoEnabled || !stream) && <div className="video-avatar"><UserAvatar user={participant} />{!stream && <small>Connecting</small>}</div>}
      <div className="call-tile-meta">
        {thumbnail ? <span className="call-thumbnail-name">{label ?? memberName(participant)}</span> : <button className="call-member-profile" onClick={() => openMember(participant.email)} aria-label={`View ${participant.name} profile`}>{label ?? memberName(participant)}</button>}
        {screenSharing ? <MonitorUp size={13} /> : audioEnabled ? <Mic size={13} /> : <MicOff size={13} />}
        {!thumbnail && videoEnabled && stream && <button className="icon-button call-fullscreen" title="Full screen" aria-label={`Full screen ${label || participant.name}`} onClick={() => { if (!tileRef.current?.requestFullscreen) { setFullscreenError("Full screen is unavailable in this browser"); return; } void tileRef.current.requestFullscreen().catch(() => setFullscreenError("Could not enter full screen")); }}><Maximize2 size={14} /></button>}
      </div>
      {fullscreenError && <small className="call-tile-error" role="status">{fullscreenError}</small>}
    </div>
  );
}
