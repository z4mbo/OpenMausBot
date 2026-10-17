"use client";
import { useEffect, useRef, useState } from "react";
import { Volume2 } from "lucide-react";

export function CallAudio({ stream, name }: { stream: MediaStream; name: string }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const element = audio.current;
    if (!element) return;
    let active = true;
    element.srcObject = stream;
    const play = () => { void element.play().then(() => { if (active) setBlocked(false); }).catch(error => { if (active && error.name === "NotAllowedError") setBlocked(true); }); };
    play(); element.addEventListener("loadedmetadata", play);
    return () => { active = false; element.removeEventListener("loadedmetadata", play); element.pause(); element.srcObject = null; };
  }, [stream]);
  return <><audio ref={audio} autoPlay onPlaying={() => setBlocked(false)} />{blocked && <button className="call-enable-audio ghost-button compact" onClick={() => { void audio.current?.play().then(() => setBlocked(false)).catch(() => setBlocked(true)); }} aria-label={`Enable audio from ${name}`}><Volume2 size={15} />Enable audio</button>}</>;
}
