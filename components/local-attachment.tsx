"use client";
import { formatBytes } from "@/lib/format-bytes";
import { useEffect, useState } from "react";
import { Download, File, Loader2, RotateCw } from "lucide-react";
import { localFetch } from "@/lib/client-api";

export function LocalAttachment({ file, sessionToken, scope }: { file: { id: string; name: string; contentType: string; size: number }; sessionToken: string; scope: string }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const image = /^image\/(png|jpeg|gif|webp)$/.test(file.contentType);
  const audio = /^audio\/(mpeg|mp3|wav|x-wav|ogg|webm|mp4)$/.test(file.contentType);
  const video = /^video\/(mp4|webm|ogg|quicktime)$/.test(file.contentType);
  useEffect(() => {
    const controller = new AbortController(); let objectUrl = "";
    setUrl(""); setError(false);
    void localFetch(`/api/local-chat/files?${scope}&id=${encodeURIComponent(file.id)}`, sessionToken, { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error("Download failed"); return response.blob(); })
      .then(blob => new Blob([blob], { type: image || audio || video ? file.contentType : "application/octet-stream" }))
      .then(blob => { if (!controller.signal.aborted) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); } })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [file.id, file.contentType, scope, sessionToken, retry, image, audio, video]);
  return <div className="local-attachment">
    {url && audio && <audio controls preload="metadata" src={url} aria-label={`Play ${file.name}`} />}
    {url && video && <video controls preload="metadata" src={url} aria-label={`Play ${file.name}`} />}
    <a className={`message-file ${image ? "image-attachment" : ""}`} href={url || undefined} download={file.name} aria-disabled={!url}>
      {image && url ? <img src={url} alt={file.name} loading="lazy" /> : <File size={24} />}
      <span><strong>{file.name}</strong><small>{error ? "Download unavailable" : formatBytes(file.size)}</small></span>
      {url ? <Download size={15} /> : !error && <Loader2 className="spin" size={15} />}
    </a>
    {error && <button className="icon-button" aria-label={`Retry ${file.name}`} title="Retry download" onClick={() => setRetry(value => value + 1)}><RotateCw size={14} /></button>}
  </div>;
}
