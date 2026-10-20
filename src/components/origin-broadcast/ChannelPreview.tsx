import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import {
  Bookmark, Ellipsis, Globe, Heart, MessageCircle, Music2, Play, Repeat2, Send, Share2, ThumbsUp, BarChart2, Plus,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { BROADCAST_RULES, type BroadcastChannel, type BroadcastFormat, type BroadcastMediaKind } from "../../../shared/broadcast";
import { ChannelMark } from "./ChannelMark";

export type PreviewMedia = { id: string; name: string; url: string | null; kind: BroadcastMediaKind };

export type PreviewProps = {
  channel: BroadcastChannel;
  text: string;
  media: readonly PreviewMedia[];
  format: BroadcastFormat;
  coverMs?: number;
  music?: string;
  name: string;
  handle: string;
  safeZones: boolean;
};

/** Each platform's own link colour and the characters it shows before folding a caption behind "more". */
const PLATFORM: Record<BroadcastChannel, { link: string; fold?: number; reelFold?: number }> = {
  x: { link: "#1d9bf0" },
  bluesky: { link: "#1083fe" },
  linkedin: { link: "#378fe9", fold: 140 },
  facebook: { link: "#2d88ff", fold: 250 },
  instagram: { link: "#6fa8ff", fold: 125, reelFold: 60 },
  tiktok: { link: "#ffffff", reelFold: 80 },
};

/**
 * Areas the platform's own buttons and caption cover on a 9:16 reel, as fractions of the frame: Meta's Reels guidance
 * (14% top, 35% bottom, 6% sides) and TikTok's (about 160 px top, 480 px bottom, 140 px right of 1080×1920).
 */
const SAFE: Record<"instagram" | "tiktok", { top: number; bottom: number; left: number; right: number }> = {
  instagram: { top: 0.14, bottom: 0.35, left: 0.06, right: 0.06 },
  tiktok: { top: 0.083, bottom: 0.25, left: 0.06, right: 0.13 },
};

const TOKEN = /(https?:\/\/\S+|[#@][\p{L}\p{N}_.]+)/gu;

function RichText({ text, link, fold, className }: { text: string; link: string; fold?: number; className?: string }) {
  const folded = fold !== undefined && Array.from(text).length > fold;
  const shown = folded ? `${Array.from(text).slice(0, fold).join("").replace(/\s+\S*$/, "")}…` : text;
  return (
    <p className={cn("whitespace-pre-wrap break-words", className)}>
      {shown.split(TOKEN).map((part, index) => index % 2
        ? <span key={index} style={{ color: link }}>{part.startsWith("http") ? part.replace(/^https?:\/\/(www\.)?/, "").slice(0, 26) + (part.length > 34 ? "…" : "") : part}</span>
        : part)}
      {folded && <span className="text-ink-tertiary"> more</span>}
    </p>
  );
}

function Avatar({ name, size = 36, square }: { name: string; size?: number; square?: boolean }) {
  return (
    <span aria-hidden="true" style={{ width: size, height: size, fontSize: size * 0.42 }}
      className={cn("flex shrink-0 items-center justify-center bg-accent font-semibold text-accent-ink", square ? "rounded-md" : "rounded-full")}>
      {name.trim().charAt(0).toUpperCase() || "O"}
    </span>
  );
}

/** A video held on one frame: the chosen cover, or the first frame. */
export function CoverVideo({ url, coverMs, className }: { url: string | null; coverMs?: number; className?: string }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const seek = () => { element.currentTime = Math.min((coverMs ?? 0) / 1000, Math.max(0, (element.duration || 0) - 0.05)); };
    if (element.readyState >= 1) seek();
    element.addEventListener("loadedmetadata", seek);
    return () => element.removeEventListener("loadedmetadata", seek);
  }, [coverMs, url]);
  if (!url) return <span className={cn("block bg-gradient-to-br from-raised to-inset", className)} />;
  return <video ref={video} src={url} muted playsInline preload="auto" className={cn("object-cover", className)} />;
}

function MediaItem({ item, coverMs, className }: { item: PreviewMedia; coverMs?: number; className?: string }) {
  if (item.kind === "video") {
    return (
      <span className={cn("relative block overflow-hidden bg-black", className)}>
        <CoverVideo url={item.url} coverMs={coverMs} className="size-full" />
        <span className="absolute inset-0 flex items-center justify-center"><span className="flex size-10 items-center justify-center rounded-full bg-black/55 text-white"><Play size={18} fill="currentColor" /></span></span>
      </span>
    );
  }
  return item.url ? <img src={item.url} alt={item.name} className={cn("block object-cover", className)} /> : <span className={cn("block bg-raised", className)} />;
}

function MediaGrid({ media, coverMs, rounded, vertical }: { media: readonly PreviewMedia[]; coverMs?: number; rounded: string; vertical?: boolean }) {
  if (!media.length) return null;
  if (media.length === 1) {
    const aspect = media[0].kind === "video" && vertical ? "aspect-[9/16] max-h-[420px] mx-auto" : media[0].kind === "video" ? "aspect-video" : "aspect-[4/3]";
    return <div className={cn("overflow-hidden border border-hairline/40", rounded)}><MediaItem item={media[0]} coverMs={coverMs} className={cn("w-full", aspect)} /></div>;
  }
  const shown = media.slice(0, 4);
  return (
    <div className={cn("grid aspect-video grid-cols-2 gap-0.5 overflow-hidden border border-hairline/40", rounded, shown.length > 2 && "grid-rows-2")}>
      {shown.map((item, index) => (
        <div key={item.id} className={cn("relative min-h-0", shown.length === 3 && index === 0 && "row-span-2")}>
          <MediaItem item={item} className="size-full" />
          {index === 3 && media.length > 4 && <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-[18px] font-semibold text-white">+{media.length - 4}</span>}
        </div>
      ))}
    </div>
  );
}

function Actions({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex items-center text-ink-tertiary", className)}>{children}</div>;
}

function Act({ icon, label }: { icon: ReactNode; label?: string }) {
  return <span className="inline-flex items-center gap-1.5 text-[12px]">{icon}{label}</span>;
}

function XLike({ props, bluesky }: { props: PreviewProps; bluesky?: boolean }) {
  const { link } = PLATFORM[props.channel];
  return (
    <article className="flex gap-2.5 px-3.5 py-3">
      <Avatar name={props.name} size={38} />
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-1 text-[13.5px] leading-tight">
          <span className="truncate font-semibold text-ink">{props.name}</span>
          <span className="truncate text-ink-tertiary">{props.handle} · now</span>
          <Ellipsis size={15} className="ml-auto shrink-0 text-ink-tertiary" />
        </p>
        {props.text && <RichText text={props.text} link={link} className="mt-0.5 text-[13.5px] leading-[1.4] text-ink" />}
        <div className="mt-2.5"><MediaGrid media={props.media} coverMs={props.coverMs} rounded="rounded-2xl" vertical={props.format === "reel"} /></div>
        <Actions className="mt-2.5 justify-between pr-6">
          <Act icon={<MessageCircle size={15} />} />
          <Act icon={<Repeat2 size={16} />} />
          <Act icon={<Heart size={15} />} />
          {bluesky ? <Act icon={<Ellipsis size={15} />} /> : <Act icon={<BarChart2 size={15} />} />}
          {!bluesky && <Act icon={<Bookmark size={15} />} />}
        </Actions>
      </div>
    </article>
  );
}

function LinkedInPost({ props }: { props: PreviewProps }) {
  const { link, fold } = PLATFORM.linkedin;
  return (
    <article className="flex flex-col">
      <header className="flex items-start gap-2 px-3.5 pt-3">
        <Avatar name={props.name} size={40} square />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[13.5px] font-semibold text-ink">{props.name}</p>
          <p className="truncate text-[11.5px] text-ink-tertiary">{props.handle}</p>
          <p className="flex items-center gap-1 text-[11.5px] text-ink-tertiary">now · <Globe size={11} /></p>
        </div>
        <span className="text-[13px] font-semibold" style={{ color: link }}><Plus size={13} className="mr-0.5 inline" />Follow</span>
      </header>
      {props.text && <RichText text={props.text} link={link} fold={fold} className="px-3.5 pt-2.5 text-[13px] leading-[1.45] text-ink" />}
      {props.media.length > 0 && <div className="mt-2.5"><MediaGrid media={props.media} coverMs={props.coverMs} rounded="rounded-none border-x-0" /></div>}
      <Actions className="mt-1 justify-around border-t border-hairline/40 px-2 py-2">
        <Act icon={<ThumbsUp size={15} />} label="Like" /><Act icon={<MessageCircle size={15} />} label="Comment" />
        <Act icon={<Repeat2 size={15} />} label="Repost" /><Act icon={<Send size={15} />} label="Send" />
      </Actions>
    </article>
  );
}

function FacebookPost({ props }: { props: PreviewProps }) {
  const { link, fold } = PLATFORM.facebook;
  return (
    <article className="flex flex-col">
      <header className="flex items-center gap-2 px-3.5 pt-3">
        <Avatar name={props.name} size={38} />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[13.5px] font-semibold text-ink">{props.name}</p>
          <p className="flex items-center gap-1 text-[11.5px] text-ink-tertiary">Just now · <Globe size={11} /></p>
        </div>
        <Ellipsis size={16} className="text-ink-tertiary" />
      </header>
      {props.text && <RichText text={props.text} link={link} fold={fold} className="px-3.5 pt-2.5 text-[13.5px] leading-[1.4] text-ink" />}
      {props.media.length > 0 && <div className="mt-2.5"><MediaGrid media={props.media} coverMs={props.coverMs} rounded="rounded-none border-x-0" vertical={props.format === "reel"} /></div>}
      <Actions className="mx-3.5 mt-1 justify-around border-t border-hairline/40 py-2">
        <Act icon={<ThumbsUp size={15} />} label="Like" /><Act icon={<MessageCircle size={15} />} label="Comment" /><Act icon={<Share2 size={15} />} label="Share" />
      </Actions>
    </article>
  );
}

function InstagramFeed({ props }: { props: PreviewProps }) {
  const { link, fold } = PLATFORM.instagram;
  const first = props.media[0];
  return (
    <article className="flex flex-col">
      <header className="flex items-center gap-2 px-3 py-2.5">
        <span className="rounded-full bg-gradient-to-tr from-[#f9ce34] via-[#ee2a7b] to-[#6228d7] p-[2px]"><span className="block rounded-full bg-panel p-[2px]"><Avatar name={props.name} size={28} /></span></span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{props.handle.replace(/^@/, "")}</span>
        <Ellipsis size={16} className="text-ink-tertiary" />
      </header>
      <div className="relative">
        {first ? <MediaItem item={first} coverMs={props.coverMs} className="aspect-[4/5] w-full" /> : <span className="flex aspect-[4/5] w-full items-center justify-center bg-inset text-[12px] text-ink-tertiary">Instagram needs an image or a video</span>}
        {props.media.length > 1 && <span className="absolute right-2.5 top-2.5 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white">1/{props.media.length}</span>}
      </div>
      <Actions className="gap-3.5 px-3 pt-2.5 text-ink">
        <Heart size={20} /><MessageCircle size={20} /><Send size={19} />
        {props.media.length > 1 && <span className="mx-auto flex gap-1">{props.media.slice(0, 5).map((item, index) => <span key={item.id} className={cn("size-1.5 rounded-full", index ? "bg-ink-tertiary/50" : "bg-accent")} />)}</span>}
        <Bookmark size={19} className="ml-auto" />
      </Actions>
      {props.text && (
        <div className="px-3 pb-3 pt-1.5 text-[13px] leading-[1.4] text-ink">
          <RichText text={`${props.handle.replace(/^@/, "")} ${props.text}`} link={link} fold={fold} className="[&>span:first-child]:font-semibold" />
        </div>
      )}
    </article>
  );
}

function ReelFrame({ props }: { props: PreviewProps }) {
  const platform = props.channel === "tiktok" ? "tiktok" : "instagram";
  const safe = SAFE[platform];
  const video = props.media.find((item) => item.kind === "video");
  const percent = (value: number) => `${value * 100}%`;
  const caption = props.text.trim();
  return (
    <div className="relative mx-auto aspect-[9/16] w-full max-w-[272px] overflow-hidden rounded-[22px] bg-black text-white" data-reel-preview={platform}>
      {video ? <CoverVideo url={video.url} coverMs={props.coverMs} className="absolute inset-0 size-full" />
        : <span className="absolute inset-0 flex items-center justify-center px-6 text-center text-[12px] text-white/60">Pick a video for the reel</span>}
      <div className="absolute inset-x-0 top-0 flex items-center justify-center gap-4 pt-3 text-[12.5px] font-semibold text-white/90">
        {platform === "tiktok" ? <><span className="text-white/60">Following</span><span className="border-b-2 border-white pb-0.5">For You</span></> : <span className="mr-auto pl-3.5 text-[15px]">Reels</span>}
      </div>
      <div className="absolute bottom-16 right-2 flex flex-col items-center gap-3.5 text-[10.5px]" aria-hidden="true">
        {platform === "tiktok" && <span className="relative mb-1"><Avatar name={props.name} size={34} /><Plus size={12} className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 rounded-full bg-[#fe2c55] p-px" /></span>}
        <span className="flex flex-col items-center gap-0.5"><Heart size={22} fill={platform === "tiktok" ? "currentColor" : "none"} />0</span>
        <span className="flex flex-col items-center gap-0.5"><MessageCircle size={22} />0</span>
        {platform === "tiktok" ? <span className="flex flex-col items-center gap-0.5"><Bookmark size={21} fill="currentColor" />0</span> : <Send size={20} />}
        <span className="flex flex-col items-center gap-0.5"><Share2 size={20} />{platform === "tiktok" ? "0" : ""}</span>
      </div>
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent px-3 pb-3.5 pt-10">
        <p className="flex items-center gap-1.5 text-[13px] font-semibold">
          {platform === "instagram" && <Avatar name={props.name} size={24} />}
          {platform === "tiktok" ? props.handle : props.handle.replace(/^@/, "")}
          {platform === "instagram" && <span className="rounded-md border border-white/70 px-1.5 text-[11px] font-medium">Follow</span>}
        </p>
        {caption && <RichText text={caption} link={PLATFORM[props.channel].link} fold={PLATFORM[props.channel].reelFold} className="mt-1 pr-12 text-[12px] leading-snug text-white/95 [&_span]:font-semibold" />}
        <p className="mt-1.5 flex items-center gap-1.5 truncate pr-12 text-[11.5px] text-white/85"><Music2 size={12} className="shrink-0" /><span className="truncate">{props.music?.trim() || `Original audio · ${props.handle}`}</span></p>
      </div>
      {props.safeZones && (
        <div aria-label={`${platform === "tiktok" ? "TikTok" : "Instagram"} safe zone`} role="img" className="pointer-events-none absolute inset-0">
          <span className="absolute inset-x-0 top-0 bg-black/45" style={{ height: percent(safe.top) }} />
          <span className="absolute inset-x-0 bottom-0 bg-black/45" style={{ height: percent(safe.bottom) }} />
          <span className="absolute left-0 bg-black/45" style={{ top: percent(safe.top), bottom: percent(safe.bottom), width: percent(safe.left) }} />
          <span className="absolute right-0 bg-black/45" style={{ top: percent(safe.top), bottom: percent(safe.bottom), width: percent(safe.right) }} />
          <span className="absolute border border-dashed border-white/70" style={{ top: percent(safe.top), bottom: percent(safe.bottom), left: percent(safe.left), right: percent(safe.right) } as CSSProperties}>
            <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] font-medium">Safe zone</span>
          </span>
        </div>
      )}
    </div>
  );
}

/** How the post reads on `channel`, laid out the way that platform shows it. */
export function ChannelPreview(props: PreviewProps) {
  const reelFrame = props.format === "reel" && (props.channel === "instagram" || props.channel === "tiktok");
  if (reelFrame || props.channel === "tiktok") return <ReelFrame props={props} />;
  return (
    <div className="mx-auto w-full max-w-[380px] overflow-hidden rounded-xl border border-hairline/50 bg-panel" data-post-preview={props.channel}>
      {props.channel === "x" ? <XLike props={props} />
        : props.channel === "bluesky" ? <XLike props={props} bluesky />
          : props.channel === "linkedin" ? <LinkedInPost props={props} />
            : props.channel === "facebook" ? <FacebookPost props={props} />
              : <InstagramFeed props={props} />}
    </div>
  );
}

export function PreviewTabs({ channels, value, onChange }: { channels: readonly BroadcastChannel[]; value: BroadcastChannel; onChange(channel: BroadcastChannel): void }) {
  return (
    <div role="tablist" aria-label="Preview channel" className="flex gap-0.5 rounded-lg bg-inset p-0.5">
      {channels.map((channel) => (
        <button key={channel} type="button" role="tab" aria-selected={channel === value} aria-label={`Preview on ${BROADCAST_RULES[channel].label}`} onClick={() => onChange(channel)}
          className={cn("flex size-7 items-center justify-center rounded-md text-ink-tertiary transition-colors duration-(--motion-fast) hover:text-ink", channel === value && "bg-raised text-ink")}>
          <ChannelMark channel={channel} size={13} />
        </button>
      ))}
    </div>
  );
}
