import { useEffect, useRef, useState, type ReactNode } from "react";
import { AudioLines, Clapperboard, Image as ImageIcon } from "lucide-react";
import { api } from "@/state/store";
import { cn } from "@/lib/cn";
import type { CloudDesignAsset } from "../origin-pages/cloud-types";
import type { StudioGeneration, StudioMediaKind, StudioMode, StudioSource } from "../../../shared/studio";

/** A starting file the composer shows: what it is, how it looks, and how the server finds it. */
export interface SourceRef {
  kind: StudioMediaKind;
  label: string;
  url: string;
  source: StudioSource;
}

/** Everything the prompt bar holds; the canvas's actions replace it to set up the next generation. */
export interface StudioDraft {
  mode: StudioMode;
  model: string;
  prompt: string;
  sources: SourceRef[];
  references: SourceRef[];
  aspectRatio?: string;
  duration?: string;
  resolution?: string;
  voice?: string;
  seed?: number;
  negativePrompt?: string;
  motion?: string;
  angle?: string;
  sound?: boolean;
  /** The STUDIO_PRESETS entry the draft was set up from. */
  preset?: string;
  count: number;
  parent?: { generationId: string; action: string };
  /** A studioLibrary entry the generation follows. */
  characterId?: string;
}

export const KIND_ICON: Record<StudioMediaKind, typeof ImageIcon> = { image: ImageIcon, video: Clapperboard, audio: AudioLines };

export const isKindAsset = (asset: CloudDesignAsset, kind: StudioMediaKind) =>
  kind === "image" ? asset.type === "image" || asset.type === "icon" || Boolean(asset.contentType?.startsWith("image/")) : asset.type === kind || Boolean(asset.contentType?.startsWith(`${kind}/`));
export const assetLink = (asset: CloudDesignAsset) => asset.fileUrl || asset.url || "";

export function assetRef(asset: CloudDesignAsset, kind: StudioMediaKind): SourceRef {
  return { kind, label: asset.name, url: assetLink(asset), source: { assetId: asset._id } };
}

export function outputRef(row: StudioGeneration, index = 0): SourceRef | null {
  const output = row.outputs[index];
  return output ? { kind: output.kind, label: row.prompt || row.modelLabel, url: output.url, source: { generationId: row._id, index } } : null;
}

export function studioPost<T = unknown>(path: string, body: Record<string, unknown>): Promise<T> {
  return api<T>(`/api/studio/${path}`, { method: "POST", body: JSON.stringify(body) });
}

export function ratioOf(aspect: string | undefined, kind: StudioMediaKind): string {
  const match = /^(\d+):(\d+)$/.exec(aspect ?? "");
  if (match) return `${match[1]} / ${match[2]}`;
  return kind === "video" ? "16 / 9" : kind === "audio" ? "3 / 1" : "1 / 1";
}

/** A still, video frame or audio glyph at any size. */
export function MediaThumb({ kind, url, className, alt = "", iconSize = 14 }: { kind: StudioMediaKind; url?: string; className?: string; alt?: string; iconSize?: number }) {
  const [broken, setBroken] = useState(false);
  const Icon = KIND_ICON[kind];
  if (!url || broken || kind === "audio") {
    return <span className={cn("flex items-center justify-center bg-inset text-ink-tertiary", className)} aria-hidden={alt ? undefined : true}><Icon size={iconSize} /></span>;
  }
  return kind === "video"
    ? <video src={url} muted playsInline preload="metadata" className={cn("object-cover", className)} onError={() => setBroken(true)} aria-label={alt || undefined} />
    : <img src={url} alt={alt} loading="lazy" className={cn("object-cover", className)} onError={() => setBroken(true)} />;
}

/** A small panel anchored to its trigger, opening upward from the prompt bar; Escape and outside clicks close it. */
export function Popover({ open, onClose, children, className, align = "start", label }: { open: boolean; onClose(): void; children: ReactNode; className?: string; align?: "start" | "end"; label: string }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const host = panel.current?.parentElement;
      if (host && !host.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
      (panel.current?.parentElement?.querySelector("button") as HTMLButtonElement | null)?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div ref={panel} role="dialog" aria-label={label}
      className={cn("ui-panel absolute bottom-[calc(100%+6px)] z-30 max-h-[min(60vh,420px)] w-72 max-w-[calc(100vw-32px)] overflow-y-auto p-1.5 motion-safe:animate-pop-in", align === "end" ? "right-0" : "left-0", className)}>
      {children}
    </div>
  );
}

/** Whether a key event came from a field the person is typing in. */
export function typing(event: { target: EventTarget | null }): boolean {
  const target = event.target as HTMLElement | null;
  return Boolean(target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)));
}

export function formatSeconds(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return whole < 60 ? `${whole}s` : `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, "0")}s`;
}
