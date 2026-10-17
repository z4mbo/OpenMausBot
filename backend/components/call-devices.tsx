"use client";
import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, Mic, X } from "lucide-react";

export function CallDevices({ audioId, videoId, inCall, onChange, onClose }: { audioId: string; videoId: string; inCall: boolean; onChange: (kind: "audio" | "video", id: string) => Promise<void>; onClose: () => void }) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [preview, setPreview] = useState<MediaStream | null>(null);
  const previewRef = useRef<MediaStream | null>(null), video = useRef<HTMLVideoElement>(null), mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const refresh = () => navigator.mediaDevices?.enumerateDevices().then(d => { if (mounted.current) setDevices(d); }).catch(() => {});
    void refresh(); navigator.mediaDevices?.addEventListener("devicechange", refresh);
    return () => { mounted.current = false; previewRef.current?.getTracks().forEach(t => t.stop()); navigator.mediaDevices?.removeEventListener("devicechange", refresh); };
  }, []);
  useEffect(() => { if (video.current) video.current.srcObject = preview; }, [preview]);
  const stopPreview = () => { previewRef.current?.getTracks().forEach(t => t.stop()); previewRef.current = null; setPreview(null); };
  const test = async () => {
    if (preview) { stopPreview(); return; }
    setBusy(true); setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioId ? { deviceId: { exact: audioId }, echoCancellation: true } : true, video: videoId ? { deviceId: { exact: videoId } } : true });
      if (!mounted.current) { stream.getTracks().forEach(t => t.stop()); return; }
      previewRef.current = stream; setPreview(stream); setDevices(await navigator.mediaDevices.enumerateDevices());
    } catch { setError("Check camera and microphone permissions in your browser."); } finally { if (mounted.current) setBusy(false); }
  };
  const change = async (kind: "audio" | "video", id: string) => { stopPreview(); setBusy(true); setError(""); try { await onChange(kind, id); } catch { setError("Could not switch device. Check your browser permissions."); } finally { setBusy(false); } };
  return <section className="call-device-panel" aria-label="Call devices"><div className="call-device-heading"><strong>Devices</strong><button className="icon-button" title="Close devices" aria-label="Close devices" onClick={onClose}><X size={15} /></button></div><label><Mic size={14} />Microphone<select value={audioId} disabled={busy} onChange={e => change("audio", e.target.value)}><option value="">System default</option>{devices.filter(d => d.kind === "audioinput" && d.deviceId && d.deviceId !== "default").map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>)}</select></label><label><Camera size={14} />Camera<select value={videoId} disabled={busy} onChange={e => change("video", e.target.value)}><option value="">System default</option>{devices.filter(d => d.kind === "videoinput" && d.deviceId).map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}</select></label>{!inCall && <button className="ghost-button compact" disabled={busy} onClick={test}>{busy ? <Loader2 size={14} className="spin" /> : <Camera size={14} />}{preview ? "Stop preview" : "Test camera & microphone"}</button>}{preview && <video ref={video} autoPlay playsInline muted />}{error && <p className="notice danger" role="alert">{error}</p>}</section>;
}
