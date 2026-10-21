import { useState } from "react";
import { AudioLines, Clapperboard, ImageIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import type { OriginCardMedia } from "../../../shared/origin-chat-cards";

const KIND_ICON = { image: ImageIcon, video: Clapperboard, audio: AudioLines, other: ImageIcon } as const;

export function MediaView({ media, className, controls }: { media: OriginCardMedia; className?: string; controls?: boolean }) {
  const [broken, setBroken] = useState(false);
  const Icon = KIND_ICON[media.kind];
  if (!media.url || broken || media.kind === "other" || (media.kind === "audio" && !controls)) {
    return <span className={cn("flex items-center justify-center bg-raised/50 text-ink-tertiary", className)}><Icon size={18} aria-hidden="true" /></span>;
  }
  if (media.kind === "audio") return <span className={cn("flex items-center bg-raised/50 px-3", className)}><audio src={media.url} controls preload="metadata" className="h-9 w-full [color-scheme:var(--code-color-scheme)]" aria-label={media.name || "Audio"} /></span>;
  if (media.kind === "video") return <video src={media.url} controls={controls} muted={!controls} playsInline preload="metadata" className={cn("bg-black object-cover", className)} onError={() => setBroken(true)} aria-label={media.name || "Video"} />;
  return <img src={media.url} alt={media.name} loading="lazy" className={cn("object-cover", className)} onError={() => setBroken(true)} />;
}
