import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Clapperboard, Film, Hash, ImagePlus, Music2, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  BROADCAST_RULES, bestTimes, hashtagLimit, hashtagsOf, nextSlot, type BroadcastChannel, type BroadcastMediaKind,
} from "../../../shared/broadcast";
import { ghostButton } from "../origin-pages/ui";
import { Select } from "../Select";
import { ChannelMark } from "./ChannelMark";
import { CoverVideo, type PreviewMedia } from "./ChannelPreview";
import type { ChannelAccounts } from "./use-broadcast-accounts";

export type PickableAsset = { id: string; name: string; url: string; kind: BroadcastMediaKind };

const sectionLabel = "text-[11.5px] font-medium text-ink-tertiary";

export function AccountRow({ channels, accounts, chosen, locked, onChoose, onConnect }: {
  channels: readonly BroadcastChannel[];
  accounts: ChannelAccounts | null;
  chosen: Partial<Record<BroadcastChannel, string>>;
  locked: boolean;
  onChoose(channel: BroadcastChannel, accountId: string): void;
  onConnect(): void;
}) {
  if (!channels.length || !accounts) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Post as" role="group">
      <span className={cn(sectionLabel, "mr-0.5")}>Post as</span>
      {channels.map((channel) => {
        const options = accounts[channel];
        const label = BROADCAST_RULES[channel].label;
        if (!options.length) {
          return (
            <button key={channel} type="button" onClick={onConnect} disabled={locked}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-dashed border-hairline px-2 text-[12px] text-ink-tertiary transition-colors duration-(--motion-fast) hover:border-accent/60 hover:text-ink">
              <ChannelMark channel={channel} size={12} />Connect {label}
            </button>
          );
        }
        const value = chosen[channel] ?? options[0].id;
        if (options.length > 1) {
          return (
            <Select key={channel} size="sm" icon={<ChannelMark channel={channel} size={12} />} aria-label={`${label} account`} value={value} disabled={locked}
              onChange={(event) => onChoose(channel, event.target.value)} className="max-w-[200px]">
              {options.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}
            </Select>
          );
        }
        return (
          <span key={channel} className="inline-flex h-7 items-center gap-1.5 rounded-md bg-inset px-2 text-[12px] text-ink">
            <ChannelMark channel={channel} size={12} />
            <span className="max-w-[160px] truncate">{options[0].label}</span>
          </span>
        );
      })}
    </div>
  );
}

export function HashtagRow({ channel, text, locked, onAdd, onRemove }: {
  channel: BroadcastChannel | "all";
  text: string;
  locked: boolean;
  onAdd(tag: string): void;
  onRemove(tag: string): void;
}) {
  const [draft, setDraft] = useState("");
  const tags = hashtagsOf(text);
  const limit = channel === "all" ? undefined : hashtagLimit(channel);
  const add = () => {
    const clean = draft.trim().replace(/^#+/, "");
    if (clean) onAdd(clean);
    setDraft("");
  };
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === "," || event.key === " ") { event.preventDefault(); add(); }
    if (event.key === "Backspace" && !draft && tags.length) onRemove(tags[tags.length - 1]);
  };
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1 border-t border-hairline/30 px-2.5 py-1.5" aria-label="Hashtags" role="group">
      <Hash size={12} className="mr-0.5 text-ink-tertiary" aria-hidden="true" />
      {tags.map((tag) => (
        <span key={tag} className="inline-flex h-6 items-center gap-0.5 rounded-md bg-accent/12 pl-1.5 pr-0.5 text-[12px] text-accent-text">
          {tag}
          {!locked && <button type="button" aria-label={`Remove ${tag}`} onClick={() => onRemove(tag)} className="flex size-4 items-center justify-center rounded hover:bg-accent/20"><X size={10} /></button>}
        </span>
      ))}
      {!locked && (
        <input aria-label="Add hashtag" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKey} onBlur={add}
          placeholder={tags.length ? "" : "Add hashtags"} className="h-6 min-w-[90px] flex-1 bg-transparent text-[12px] text-ink outline-none placeholder:text-ink-tertiary max-md:text-[16px]" />
      )}
      {limit !== undefined && <span className={cn("ml-auto text-[11px] tabular-nums", tags.length > limit ? "text-danger" : "text-ink-tertiary")}>{tags.length}/{limit}</span>}
    </div>
  );
}

function AssetPicker({ assets, onPick, empty }: { assets: readonly PickableAsset[]; onPick(id: string): void; empty: string }) {
  if (!assets.length) return <p className="rounded-lg bg-inset p-3 text-[12px] text-ink-tertiary">{empty}</p>;
  return (
    <div className="grid max-h-52 grid-cols-[repeat(auto-fill,minmax(76px,1fr))] gap-1.5 overflow-y-auto rounded-lg bg-inset p-1.5 motion-safe:animate-[rise_var(--motion-fast)_var(--ease-out)_backwards]">
      {assets.map((asset) => (
        <button key={asset.id} type="button" title={asset.name} aria-label={asset.name} onClick={() => onPick(asset.id)}
          className="relative aspect-square overflow-hidden rounded-md bg-panel outline-none ring-accent/60 transition-transform duration-(--motion-fast) hover:ring-2 focus-visible:ring-2 active:scale-[0.97]">
          {asset.kind === "video" ? <CoverVideo url={asset.url} className="size-full" /> : <img src={asset.url} alt="" loading="lazy" className="size-full object-cover" />}
          {asset.kind === "video" && <Film size={11} className="absolute bottom-1 left-1 text-white" aria-hidden="true" />}
        </button>
      ))}
    </div>
  );
}

export function MediaStrip({ media, pickable, locked, onAdd, onRemove }: {
  media: readonly PreviewMedia[];
  pickable: readonly PickableAsset[];
  locked: boolean;
  onAdd(id: string): void;
  onRemove(id: string): void;
}) {
  const [picking, setPicking] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {media.map((item) => (
          <div key={item.id} className="group relative size-16 overflow-hidden rounded-lg bg-inset" title={item.name}>
            {item.url && item.kind === "image" ? <img src={item.url} alt={item.name} className="size-full object-cover" loading="lazy" />
              : item.kind === "video" ? <CoverVideo url={item.url} className="size-full" />
                : <span className="flex size-full items-center justify-center px-1 text-center text-[10.5px] text-ink-tertiary">{item.name}</span>}
            {item.kind === "video" && <Film size={11} className="absolute bottom-1 left-1 text-white" aria-hidden="true" />}
            {!locked && (
              <button type="button" aria-label={`Remove ${item.name}`} onClick={() => onRemove(item.id)}
                className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity duration-(--motion-fast) focus-visible:opacity-100 group-hover:opacity-100 touch:opacity-100">
                <X size={11} />
              </button>
            )}
          </div>
        ))}
        {!locked && (
          <button type="button" aria-expanded={picking} onClick={() => setPicking((open) => !open)}
            className={cn("flex size-16 flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-[11px] transition-colors duration-(--motion-fast)",
              picking ? "border-accent/60 text-ink" : "border-hairline text-ink-tertiary hover:border-accent/60 hover:text-ink")}>
            <ImagePlus size={15} />Media
          </button>
        )}
      </div>
      {picking && !locked && <AssetPicker assets={pickable} onPick={(id) => onAdd(id)} empty="No images or videos in Assets or Studio yet." />}
    </div>
  );
}

const FRAMES = 6;

/**
 * A video's length in seconds. Chromium reports Infinity for a WebM a MediaRecorder wrote, which has no duration in its
 * header, until playback is moved past the end; seeking there once makes it read the real length.
 */
function measure(video: HTMLVideoElement, done: (seconds: number) => void) {
  if (Number.isFinite(video.duration)) return done(video.duration);
  const settle = () => {
    if (!Number.isFinite(video.duration)) return;
    video.removeEventListener("durationchange", settle);
    done(video.duration);
    video.currentTime = 0;
  };
  video.addEventListener("durationchange", settle);
  video.currentTime = Number.MAX_SAFE_INTEGER;
}

/** A reel's video, its cover frame and the sound to add when it goes out. */
export function ReelPanel({ video, videos, coverMs, music, locked, onVideo, onCover, onMusic }: {
  video: PreviewMedia | null;
  videos: readonly PickableAsset[];
  coverMs: number;
  music: string;
  locked: boolean;
  onVideo(id: string | null): void;
  onCover(ms: number): void;
  onMusic(value: string): void;
}) {
  const [duration, setDuration] = useState(0);
  const probe = useRef<HTMLVideoElement>(null);
  useEffect(() => { setDuration(0); }, [video?.url]);
  if (!video) {
    return (
      <div className="flex flex-col gap-2">
        <span className={sectionLabel}>Video</span>
        <AssetPicker assets={videos} onPick={(id) => onVideo(id)} empty="No videos in Studio or Assets yet. Generate one in Studio, then pick it here." />
      </div>
    );
  }
  const total = Math.max(duration * 1000, 1);
  const frames = Array.from({ length: FRAMES }, (_, index) => Math.round((total * (index + 0.5)) / FRAMES));
  const chosenFrame = Math.min(FRAMES - 1, Math.floor((coverMs / total) * FRAMES));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Clapperboard size={13} className="text-ink-tertiary" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{video.name}</span>
        {!locked && <button type="button" className={cn(ghostButton, "min-h-7 px-2 py-0.5 text-[12px]")} onClick={() => onVideo(null)}>Change video</button>}
      </div>
      {video.url && <video ref={probe} src={video.url} muted preload="metadata" className="hidden" onLoadedMetadata={(event) => measure(event.currentTarget, setDuration)} />}
      <div className="flex flex-col gap-1.5">
        <span className="flex items-center justify-between"><span className={sectionLabel}>Cover frame</span><span className="text-[11px] tabular-nums text-ink-tertiary">{(coverMs / 1000).toFixed(1)}s</span></span>
        <div className="grid grid-cols-6 gap-0.5 overflow-hidden rounded-lg">
          {frames.map((at, index) => (
            <button key={index} type="button" disabled={locked || !duration} aria-label={`Cover at ${(at / 1000).toFixed(1)} seconds`} aria-pressed={index === chosenFrame} onClick={() => onCover(at)}
              className={cn("relative h-24 overflow-hidden bg-inset outline-none transition-opacity duration-(--motion-fast) focus-visible:ring-2 focus-visible:ring-accent/60",
                duration > 0 && index !== chosenFrame && "opacity-55 hover:opacity-100")}>
              <CoverVideo url={video.url} coverMs={at} className="size-full" />
              {index === chosenFrame && duration > 0 && <span aria-hidden="true" className="absolute inset-0 rounded-[3px] border-2 border-accent" />}
            </button>
          ))}
        </div>
        <input type="range" aria-label="Cover frame" min={0} max={Math.round(total)} step={100} value={Math.min(coverMs, total)} disabled={locked || !duration}
          onChange={(event) => onCover(Number(event.target.value))}
          className="h-4 w-full cursor-pointer appearance-none bg-transparent disabled:cursor-default [&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-raised [&::-webkit-slider-thumb]:-mt-[5px] [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent [&::-moz-range-track]:h-1 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-raised [&::-moz-range-thumb]:size-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-accent" />
      </div>
      <label className="flex h-9 items-center gap-2 rounded-lg bg-inset px-2.5">
        <Music2 size={13} className="shrink-0 text-ink-tertiary" aria-hidden="true" />
        <input aria-label="Music" value={music} readOnly={locked} maxLength={200} onChange={(event) => onMusic(event.target.value)} placeholder="Sound to add in the app, e.g. a trending track"
          className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink-tertiary max-md:text-[16px]" />
      </label>
    </div>
  );
}

const weekday = (day: number) => new Date(2024, 0, 7 + day).toLocaleDateString([], { weekday: "short" });
const hourLabel = (hour: number) => new Date(2024, 0, 1, hour).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** Slots to publish in: the project's own best from measured posts, or each channel's typical ones until there are enough. */
export function BestTimes({ samples, channels, onPick }: {
  samples: Parameters<typeof bestTimes>[0];
  channels: readonly BroadcastChannel[];
  onPick(at: number): void;
}) {
  const { measured, slots } = bestTimes(samples, channels);
  if (!slots.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label={measured ? "Your best times" : "Typical times"}>
      <span className="mr-0.5 inline-flex items-center gap-1 text-[11.5px] text-ink-tertiary"><Sparkles size={11} aria-hidden="true" />{measured ? "Your best times" : "Typical times"}</span>
      {slots.map((slot) => (
        <button key={`${slot.weekday}-${slot.hour}`} type="button" onClick={() => onPick(nextSlot(slot))}
          title={slot.score !== undefined ? `${slot.posts} measured ${slot.posts === 1 ? "post" : "posts"}, ${Math.round(slot.score)} average engagement` : undefined}
          className="inline-flex h-6 items-center gap-1 rounded-md bg-inset px-2 text-[11.5px] tabular-nums text-ink-secondary transition-colors duration-(--motion-fast) hover:bg-raised hover:text-ink">
          {weekday(slot.weekday)} {hourLabel(slot.hour)}
          
        </button>
      ))}
    </div>
  );
}
