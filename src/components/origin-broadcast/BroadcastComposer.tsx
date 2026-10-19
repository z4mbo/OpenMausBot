import { useMemo, useState } from "react";
import { Check, ExternalLink, Film, ImagePlus, Loader2, RotateCcw, Send, ShieldCheck, Trash2, X } from "lucide-react";
import { cloudMutation, useCloudQuery } from "@/lib/origin-cloud";
import { api } from "@/state/store";
import { cn } from "@/lib/cn";
import { BROADCAST_CHANNELS, BROADCAST_RULES, channelProblems, countText, mediaKindOf, type BroadcastChannel } from "../../../shared/broadcast";
import type { CloudDesign } from "../origin-pages/cloud-types";
import { Modal, Notice, ghostButton, iconButton, inputClass, primaryButton, useAction } from "../origin-pages/ui";
import { ChannelMark } from "./ChannelMark";
import { fromLocalInput, toLocalInput, type BroadcastPost } from "./broadcast-model";

/** Seconds of slack under which a chosen time counts as "now". */
const NOW_SLACK_MS = 60_000;

type Draft = { channels: BroadcastChannel[]; base: string; custom: Partial<Record<BroadcastChannel, string>>; assetIds: string[]; at: string };

function draftOf(post: BroadcastPost | null, slot: number | undefined): Draft {
  if (!post) return { channels: [], base: "", custom: {}, assetIds: [], at: slot ? toLocalInput(slot) : "" };
  const base = post.variants[0]?.text ?? "";
  const custom = Object.fromEntries(post.variants.filter((variant) => variant.text !== base).map((variant) => [variant.channel, variant.text]));
  return { channels: post.variants.map((variant) => variant.channel), base, custom, assetIds: post.media.map((item) => item.assetId), at: post.scheduledAt ? toLocalInput(post.scheduledAt) : "" };
}

export function BroadcastComposer({ projectId, post, slot, canEdit, connected, onConnect, onClose }: {
  projectId: string;
  post: BroadcastPost | null;
  slot?: number;
  canEdit: boolean;
  connected: Partial<Record<BroadcastChannel, boolean>> | null;
  onConnect(): void;
  onClose(): void;
}) {
  const [draft, setDraft] = useState(() => draftOf(post, slot));
  const [tab, setTab] = useState<BroadcastChannel | "all">("all");
  const [picking, setPicking] = useState(false);
  const design = useCloudQuery<CloudDesign>("design:list", { projectId });
  const action = useAction();
  const published = new Map((post?.variants ?? []).filter((variant) => variant.result === "published").map((variant) => [variant.channel, variant]));
  const locked = !canEdit || post?.status === "published" || post?.status === "publishing";
  const media = useMemo(() => {
    const known = new Map([...(post?.media ?? []).map((item) => [item.assetId, { name: item.name, url: item.url, kind: item.kind }] as const),
      ...(design?.assets ?? []).map((asset) => [asset._id, { name: asset.name, url: asset.fileUrl ?? asset.url ?? null, kind: mediaKindOf(asset.contentType, asset.name) }] as const)]);
    return draft.assetIds.map((id) => ({ id, ...(known.get(id) ?? { name: "Missing file", url: null, kind: "other" as const }) }));
  }, [draft.assetIds, design, post]);
  const kinds = media.map((item) => item.kind);
  const textOf = (channel: BroadcastChannel) => published.get(channel)?.text ?? draft.custom[channel] ?? draft.base;
  const problems = draft.channels.filter((channel) => !published.has(channel)).flatMap((channel) => channelProblems(channel, textOf(channel), kinds));
  const unconnected = connected ? draft.channels.filter((channel) => !published.has(channel) && connected[channel] === false) : [];
  const at = fromLocalInput(draft.at);
  const now = at === undefined || at <= Date.now() + NOW_SLACK_MS;
  const needsApproval = Boolean(post?.needsApproval);
  const ready = draft.channels.length > 0 && !problems.length && !needsApproval;
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

  const toggleChannel = (channel: BroadcastChannel) => {
    if (published.has(channel)) return;
    const channels = draft.channels.includes(channel) ? draft.channels.filter((item) => item !== channel) : BROADCAST_CHANNELS.filter((item) => item === channel || draft.channels.includes(item));
    set({ channels });
    if (tab === channel && !channels.includes(channel)) setTab("all");
  };
  const editText = (value: string) => {
    if (tab === "all") set({ base: value });
    else set({ custom: { ...draft.custom, [tab]: value } });
  };
  const resetChannel = (channel: BroadcastChannel) => {
    const { [channel]: _dropped, ...custom } = draft.custom;
    set({ custom });
  };

  const save = async () => cloudMutation<string>("broadcast:save", {
    projectId, ...(post ? { postId: post._id } : {}), assetIds: draft.assetIds,
    variants: draft.channels.map((channel) => ({ channel, text: textOf(channel) })),
  });
  const run = (work: () => Promise<unknown>, fallback: string, close = true) => void action.run(work, fallback).then((ok) => { if (ok && close) onClose(); });
  const saveDraft = () => run(save, "Could not save the post");
  const approve = () => run(async () => {
    const postId = await save();
    await cloudMutation("broadcast:approve", { postId });
  }, "Could not approve the post");
  const schedule = () => run(async () => {
    const postId = await save();
    await cloudMutation("broadcast:schedule", { postId, ...(now ? {} : { at }) });
    if (now) void api("/api/origin/broadcast/run", { method: "POST" }).catch(() => undefined);
  }, "Could not schedule the post");
  const unschedule = () => run(() => cloudMutation("broadcast:unschedule", { postId: post!._id }), "Could not unschedule the post");
  const remove = () => {
    if (!post || !window.confirm("Delete this post?")) return;
    run(() => cloudMutation("broadcast:remove", { postId: post._id }), "Could not delete the post");
  };

  const current = tab === "all" ? draft.base : textOf(tab);
  const title = !post ? "New post" : post.status === "published" ? "Published post" : post.needsApproval ? `Draft by ${post.agentName ?? "an agent"}` : "Edit post";
  const pickable = (design?.assets ?? []).filter((asset) => {
    const kind = mediaKindOf(asset.contentType, asset.name);
    return (kind === "image" || kind === "video") && (asset.fileUrl || asset.url) && !draft.assetIds.includes(asset._id);
  });

  return (
    <Modal title={title} onClose={onClose} canClose={() => !action.busy} wide className="sm:max-w-3xl">
      <div className="flex flex-col gap-3">
        {needsApproval && <Notice>{post?.agentName ?? "An agent"} drafted this post. Review it and approve it before it can be scheduled.</Notice>}

        <div role="group" aria-label="Channels" className="flex flex-wrap gap-1.5">
          {BROADCAST_CHANNELS.map((channel) => {
            const on = draft.channels.includes(channel);
            const done = published.get(channel);
            return (
              <button key={channel} type="button" aria-pressed={on} disabled={locked || Boolean(done)} onClick={() => toggleChannel(channel)}
                className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] transition-colors duration-150 disabled:cursor-default",
                  on ? "border-accent/60 bg-accent/15 text-ink" : "border-hairline/60 text-ink-secondary hover:border-hairline hover:text-ink")}>
                <ChannelMark channel={channel} size={13} />{BROADCAST_RULES[channel].label}
                {done && <Check size={12} className="text-success" aria-label="Published" />}
              </button>
            );
          })}
        </div>

        {unconnected.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-raised/60 px-3 py-2 text-[12.5px] text-ink-secondary">
            <span className="min-w-0 flex-1">{unconnected.map((channel) => BROADCAST_RULES[channel].label).join(", ")} {unconnected.length === 1 ? "is" : "are"} not connected on this computer.</span>
            <button type="button" className={cn(ghostButton, "min-h-7 px-2.5 py-1 text-[12px]")} onClick={onConnect}>Connect</button>
          </div>
        )}

        {draft.channels.length > 0 && (
          <div className="flex flex-col overflow-hidden rounded-xl border border-hairline/50 bg-inset focus-within:border-accent/60">
            <div role="tablist" aria-label="Text per channel" className="flex gap-0.5 overflow-x-auto border-b border-hairline/40 px-1.5 pt-1.5 [scrollbar-width:none]">
              {(["all", ...draft.channels] as const).map((item) => {
                const length = item === "all" ? null : countText(item, textOf(item));
                const over = item !== "all" && length! > BROADCAST_RULES[item].limit;
                return (
                  <button key={item} type="button" role="tab" aria-selected={tab === item} onClick={() => setTab(item)}
                    className={cn("flex h-8 shrink-0 items-center gap-1.5 rounded-t-lg px-2.5 text-[12px] transition-colors duration-150",
                      tab === item ? "bg-panel text-ink" : "text-ink-secondary hover:text-ink")}>
                    {item === "all" ? "All channels" : <><ChannelMark channel={item} size={12} />
                      <span className={cn("tabular-nums", over ? "text-danger" : draft.custom[item] !== undefined ? "text-accent-text" : "")}>{length}/{BROADCAST_RULES[item].limit}</span></>}
                  </button>
                );
              })}
            </div>
            <textarea aria-label={tab === "all" ? "Post text" : `${BROADCAST_RULES[tab].label} text`} value={current} onChange={(event) => editText(event.target.value)}
              readOnly={locked || (tab !== "all" && published.has(tab))} rows={7} placeholder={tab === "all" ? "Write the post" : `Text for ${BROADCAST_RULES[tab].label}`}
              className="min-h-[140px] w-full resize-y bg-transparent px-3 py-2.5 text-[13.5px] leading-relaxed text-ink outline-none placeholder:text-ink-tertiary max-md:text-[16px]" />
            <div className="flex min-h-8 items-center gap-2 border-t border-hairline/30 px-3 text-[11.5px] text-ink-tertiary">
              {tab === "all"
                ? <span>Goes to every channel without its own text.</span>
                : published.has(tab)
                  ? <a href={published.get(tab)!.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent-text hover:underline">Published<ExternalLink size={11} /></a>
                  : draft.custom[tab] !== undefined
                    ? <button type="button" disabled={locked} className="inline-flex items-center gap-1 hover:text-ink" onClick={() => resetChannel(tab)}><RotateCcw size={11} />Use the shared text</button>
                    : <span>Edit to give {BROADCAST_RULES[tab].label} its own text.</span>}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            {media.map((item) => (
              <div key={item.id} className="group relative size-20 overflow-hidden rounded-lg border border-hairline/50 bg-inset" title={item.name}>
                {item.url && item.kind === "image" ? <img src={item.url} alt={item.name} className="size-full object-cover" loading="lazy" />
                  : item.url && item.kind === "video" ? <video src={item.url} muted preload="metadata" className="size-full object-cover" />
                    : <span className="flex size-full items-center justify-center px-1 text-center text-[11px] text-ink-tertiary">{item.name}</span>}
                {item.kind === "video" && <Film size={12} className="absolute bottom-1 left-1 text-white drop-shadow" aria-hidden="true" />}
                {!locked && (
                  <button type="button" aria-label={`Remove ${item.name}`} onClick={() => set({ assetIds: draft.assetIds.filter((id) => id !== item.id) })}
                    className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity duration-150 focus-visible:opacity-100 group-hover:opacity-100">
                    <X size={11} />
                  </button>
                )}
              </div>
            ))}
            {!locked && (
              <button type="button" aria-expanded={picking} onClick={() => setPicking((open) => !open)}
                className={cn("flex size-20 flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-[11.5px] transition-colors duration-150",
                  picking ? "border-accent/60 text-ink" : "border-hairline text-ink-secondary hover:border-accent/60 hover:text-ink")}>
                <ImagePlus size={16} />Media
              </button>
            )}
          </div>
          {picking && !locked && (
            <div className="rounded-xl border border-hairline/50 bg-inset p-2 motion-safe:animate-pop-in">
              {!design ? <p className="p-2 text-[12px] text-ink-tertiary">Loading assets</p>
                : !pickable.length ? <p className="p-2 text-[12px] text-ink-tertiary">No images or videos in Assets or Studio yet.</p> : (
                  <div className="grid max-h-56 grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-2 overflow-y-auto">
                    {pickable.map((asset) => {
                      const href = asset.fileUrl || asset.url || "";
                      const video = mediaKindOf(asset.contentType, asset.name) === "video";
                      return (
                        <button key={asset._id} type="button" title={asset.name} onClick={() => set({ assetIds: [...draft.assetIds, asset._id] })}
                          className="relative aspect-square overflow-hidden rounded-lg border border-hairline/40 bg-panel outline-none transition-[border-color,transform] duration-150 hover:border-accent/60 focus-visible:ring-2 focus-visible:ring-accent/60 active:scale-[0.97]">
                          {video ? <video src={href} muted preload="metadata" className="size-full object-cover" /> : <img src={href} alt={asset.name} loading="lazy" className="size-full object-cover" />}
                          {video && <Film size={12} className="absolute bottom-1 left-1 text-white drop-shadow" aria-hidden="true" />}
                        </button>
                      );
                    })}
                  </div>
                )}
            </div>
          )}
        </div>

        {problems.length > 0 && !locked && (
          <ul className="flex flex-col gap-0.5 text-[12px] text-warning" aria-label="Before scheduling">
            {[...new Set(problems)].map((problem) => <li key={problem}>{problem}</li>)}
          </ul>
        )}

        {post?.variants.some((variant) => variant.error) && (
          <ul className="flex flex-col gap-1 rounded-lg bg-danger/10 px-3 py-2 text-[12px] text-danger" aria-label="Publishing errors">
            {post.variants.filter((variant) => variant.error).map((variant) => <li key={variant.channel}><strong className="font-medium">{BROADCAST_RULES[variant.channel].label}:</strong> {variant.error}</li>)}
          </ul>
        )}

        {action.error && <Notice tone="danger">{action.error}</Notice>}

        {!locked ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-hairline/30 pt-3">
            <label className="flex items-center gap-2 text-[12px] text-ink-secondary">
              Publish
              <input type="datetime-local" aria-label="Publish at" className={cn(inputClass, "w-auto py-1")} value={draft.at} onChange={(event) => set({ at: event.target.value })} />
              {draft.at && <button type="button" className={cn(iconButton, "size-7")} aria-label="Publish now instead" onClick={() => set({ at: "" })}><X size={13} /></button>}
            </label>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {post && <button type="button" className={iconButton} aria-label="Delete post" title="Delete post" disabled={action.busy} onClick={remove}><Trash2 size={14} /></button>}
              {post?.status === "scheduled" && <button type="button" className={ghostButton} disabled={action.busy} onClick={unschedule}>Unschedule</button>}
              <button type="button" className={ghostButton} disabled={action.busy || !draft.channels.length} onClick={saveDraft}>Save draft</button>
              {needsApproval ? (
                <button type="button" className={primaryButton} disabled={action.busy || !draft.channels.length} onClick={approve}>
                  {action.busy ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}Approve
                </button>
              ) : (
                <button type="button" className={primaryButton} disabled={action.busy || !ready} title={problems[0]} onClick={schedule}>
                  {action.busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}{now ? "Publish now" : "Schedule"}
                </button>
              )}
            </div>
          </div>
        ) : post && (
          <div className="flex flex-wrap items-center gap-2 border-t border-hairline/30 pt-3">
            {post.variants.filter((variant) => variant.url).map((variant) => (
              <a key={variant.channel} href={variant.url} target="_blank" rel="noreferrer" className={cn(ghostButton, "min-h-7 px-2.5 py-1 text-[12px]")}>
                <ChannelMark channel={variant.channel} size={12} />Open on {BROADCAST_RULES[variant.channel].label}<ExternalLink size={11} />
              </a>
            ))}
            {canEdit && post.status === "published" && <button type="button" className={cn(iconButton, "ml-auto")} aria-label="Delete post" disabled={action.busy} onClick={remove}><Trash2 size={14} /></button>}
          </div>
        )}
      </div>
    </Modal>
  );
}
