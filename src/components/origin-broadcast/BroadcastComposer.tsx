import { useMemo, useState } from "react";
import { Select } from "../Select";
import { Check, Copy, ExternalLink, Loader2, Megaphone, RotateCcw, ScanLine, Send, ShieldCheck, Trash2, X } from "lucide-react";
import { cloudMutation, useCloudQuery } from "@/lib/origin-cloud";
import { cn } from "@/lib/cn";
import {
  BROADCAST_CHANNELS, BROADCAST_RULES, REEL_CHANNELS, channelProblems, countText, mediaKindOf, reelProblems, withHashtag, withoutHashtag,
  type BroadcastAccount, type BroadcastChannel, type BroadcastFormat,
} from "../../../shared/broadcast";
import type { CampaignSummary } from "../../../shared/origin-campaigns";
import type { CloudDesign } from "../origin-pages/cloud-types";
import { Modal, Notice, Segmented, ghostButton, iconButton, inputClass, primaryButton, useAction } from "../origin-pages/ui";
import { ChannelMark } from "./ChannelMark";
import { ChannelPreview, PreviewTabs } from "./ChannelPreview";
import { AccountRow, BestTimes, HashtagRow, MediaStrip, ReelPanel, type PickableAsset } from "./ComposerParts";
import { fromLocalInput, metricSamples, toLocalInput, type BroadcastPost, type PostCampaign } from "./broadcast-model";
import { duplicatePost, publishNow } from "./post-actions";
import type { ChannelAccounts } from "./use-broadcast-accounts";

/** Seconds of slack under which a chosen time counts as "now". */
const NOW_SLACK_MS = 60_000;

type Draft = {
  format: BroadcastFormat;
  channels: BroadcastChannel[];
  base: string;
  custom: Partial<Record<BroadcastChannel, string>>;
  accounts: Partial<Record<BroadcastChannel, string>>;
  assetIds: string[];
  at: string;
  coverMs: number;
  music: string;
};

function draftOf(post: BroadcastPost | null, slot: number | undefined, format: BroadcastFormat): Draft {
  if (!post) return { format, channels: [], base: "", custom: {}, accounts: {}, assetIds: [], at: slot ? toLocalInput(slot) : "", coverMs: 0, music: "" };
  const base = post.variants[0]?.text ?? "";
  return {
    format: post.format ?? "post",
    channels: post.variants.map((variant) => variant.channel),
    base,
    custom: Object.fromEntries(post.variants.filter((variant) => variant.text !== base).map((variant) => [variant.channel, variant.text])),
    accounts: Object.fromEntries(post.variants.filter((variant) => variant.accountId).map((variant) => [variant.channel, variant.accountId!])),
    assetIds: post.media.map((item) => item.assetId),
    at: post.scheduledAt ? toLocalInput(post.scheduledAt) : "",
    coverMs: post.reel?.coverMs ?? 0,
    music: post.reel?.music ?? "",
  };
}

/** The name and handle a preview shows: an @handle label is the handle; an extra account's own name (Founder) is the name. */
function identity(projectName: string, account: BroadcastAccount | undefined): { name: string; handle: string } {
  const slug = `@${projectName.toLowerCase().replace(/[^a-z0-9]+/g, "") || "origin"}`;
  if (account?.label.startsWith("@")) return { name: projectName, handle: account.label };
  return { name: account && !account.isDefault ? account.label : projectName, handle: slug };
}

export function BroadcastComposer({ projectId, projectName, post, slot, format = "post", canEdit, accounts, posts, campaigns, postCampaigns, initialCampaignId, onOpenPost, onConnect, onClose }: {
  projectId: string;
  projectName: string;
  post: BroadcastPost | null;
  slot?: number;
  format?: BroadcastFormat;
  canEdit: boolean;
  accounts: ChannelAccounts | null;
  posts: readonly BroadcastPost[];
  campaigns: readonly CampaignSummary[];
  /** The campaigns that already list this post. */
  postCampaigns: readonly PostCampaign[];
  initialCampaignId?: string;
  onOpenPost(postId: string): void;
  onConnect(): void;
  onClose(): void;
}) {
  const [draft, setDraft] = useState(() => draftOf(post, slot, format));
  const [tab, setTab] = useState<BroadcastChannel | "all">("all");
  const [previewChannel, setPreviewChannel] = useState<BroadcastChannel | null>(null);
  const [safeZones, setSafeZones] = useState(true);
  const [campaignId, setCampaignId] = useState(() => postCampaigns[0]?.id ?? initialCampaignId ?? "");
  const design = useCloudQuery<CloudDesign>("design:list", { projectId });
  const action = useAction();
  const published = new Map((post?.variants ?? []).filter((variant) => variant.result === "published").map((variant) => [variant.channel, variant]));
  const locked = !canEdit || post?.status === "published" || post?.status === "publishing";
  const reel = draft.format === "reel";
  const known = useMemo(() => new Map([
    ...(post?.media ?? []).map((item) => [item.assetId, { name: item.name, url: item.url, kind: item.kind }] as const),
    ...(design?.assets ?? []).map((asset) => [asset._id, { name: asset.name, url: asset.fileUrl ?? asset.url ?? null, kind: mediaKindOf(asset.contentType, asset.name) }] as const),
  ]), [design, post]);
  const media = draft.assetIds.map((id) => ({ id, ...(known.get(id) ?? { name: "Missing file", url: null, kind: "other" as const }) }));
  const pickable: PickableAsset[] = (design?.assets ?? []).flatMap((asset) => {
    const kind = mediaKindOf(asset.contentType, asset.name);
    const url = asset.fileUrl || asset.url;
    return (kind === "image" || kind === "video") && url && !draft.assetIds.includes(asset._id) ? [{ id: asset._id, name: asset.name, url, kind }] : [];
  });
  const kinds = media.map((item) => item.kind);
  const textOf = (channel: BroadcastChannel) => published.get(channel)?.text ?? draft.custom[channel] ?? draft.base;
  const open = draft.channels.filter((channel) => !published.has(channel));
  const problems = [...new Set([...(reel ? reelProblems(open, kinds) : []), ...open.flatMap((channel) => channelProblems(channel, textOf(channel), kinds))])];
  const at = fromLocalInput(draft.at);
  const now = at === undefined || at <= Date.now() + NOW_SLACK_MS;
  const needsApproval = Boolean(post?.needsApproval);
  const ready = draft.channels.length > 0 && !problems.length && !needsApproval;
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const shownPreview = previewChannel && draft.channels.includes(previewChannel) ? previewChannel : tab !== "all" ? tab : draft.channels[0];

  const setFormat = (format: BroadcastFormat) => {
    if (format === draft.format) return;
    if (format === "reel") {
      const video = draft.assetIds.find((id) => known.get(id)?.kind === "video");
      set({ format, channels: draft.channels.filter((channel) => REEL_CHANNELS.includes(channel) || published.has(channel)), assetIds: video ? [video] : [] });
      if (tab !== "all" && !REEL_CHANNELS.includes(tab)) setTab("all");
    } else set({ format });
  };
  const toggleChannel = (channel: BroadcastChannel) => {
    if (published.has(channel)) return;
    const channels = draft.channels.includes(channel) ? draft.channels.filter((item) => item !== channel) : BROADCAST_CHANNELS.filter((item) => item === channel || draft.channels.includes(item));
    set({ channels });
    if (tab === channel && !channels.includes(channel)) setTab("all");
  };
  const writeText = (value: string, channel: BroadcastChannel | "all" = tab) => {
    if (channel === "all") set({ base: value });
    else set({ custom: { ...draft.custom, [channel]: value } });
  };
  const resetChannel = (channel: BroadcastChannel) => {
    const { [channel]: _dropped, ...custom } = draft.custom;
    set({ custom });
  };
  const accountFor = (channel: BroadcastChannel) => {
    const options = accounts?.[channel] ?? [];
    return options.find((account) => account.id === draft.accounts[channel]) ?? options[0];
  };

  const linkCampaign = async (postId: string) => {
    const before = postCampaigns[0]?.id ?? "";
    if (campaignId === before) return;
    if (before) await cloudMutation("campaigns:link", { projectId, campaignId: before, kind: "post", itemId: postId, remove: true });
    if (campaignId) await cloudMutation("campaigns:link", { projectId, campaignId, kind: "post", itemId: postId });
  };
  const save = async () => {
    const postId = await saveFields();
    await linkCampaign(postId);
    return postId;
  };
  const saveFields = async () => cloudMutation<string>("broadcast:save", {
    projectId, ...(post ? { postId: post._id } : {}), assetIds: draft.assetIds, format: draft.format,
    ...(reel ? { reel: { coverMs: draft.coverMs, ...(draft.music.trim() ? { music: draft.music.trim() } : {}) } } : {}),
    variants: draft.channels.map((channel) => {
      const account = accountFor(channel);
      return { channel, text: textOf(channel), ...(account && !account.isDefault ? { accountId: account.id, accountLabel: account.label } : {}) };
    }),
  });
  const run = (work: () => Promise<unknown>, fallback: string, close = true) => void action.run(work, fallback).then((ok) => { if (ok && close) onClose(); });
  const saveDraft = () => run(save, "Could not save the post");
  const approve = () => run(async () => {
    const postId = await save();
    await cloudMutation("broadcast:approve", { postId });
  }, "Could not approve the post");
  const schedule = () => run(async () => {
    const postId = await save();
    if (now) await publishNow(postId);
    else await cloudMutation("broadcast:schedule", { postId, at });
  }, "Could not schedule the post");
  const duplicate = () => run(async () => {
    const postId = await duplicatePost(projectId, post!, postCampaigns);
    onOpenPost(postId);
  }, "Could not copy the post", false);
  const unschedule = () => run(() => cloudMutation("broadcast:unschedule", { postId: post!._id }), "Could not unschedule the post");
  const remove = () => {
    if (!post || !window.confirm("Delete this post?")) return;
    run(() => cloudMutation("broadcast:remove", { postId: post._id }), "Could not delete the post");
  };

  const current = tab === "all" ? draft.base : textOf(tab);
  const title = !post ? (reel ? "New reel" : "New post") : post.status === "published" ? "Published post" : post.needsApproval ? `Draft by ${post.agentName ?? "an agent"}` : reel ? "Edit reel" : "Edit post";
  const video = media.find((item) => item.kind === "video") ?? null;
  const previewAccount = shownPreview ? accountFor(shownPreview) : undefined;
  const reelPreview = reel && (shownPreview === "instagram" || shownPreview === "tiktok");

  return (
    <Modal title={title} onClose={onClose} canClose={() => !action.busy} wide className="sm:max-w-5xl">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
        <div className="flex min-w-0 flex-col gap-3">
          {needsApproval && <Notice>{post?.agentName ?? "An agent"} drafted this post. Review it and approve it before it can be scheduled.</Notice>}

          <div className="flex flex-wrap items-center gap-2">
            {!locked && <Segmented label="Format" value={draft.format} onChange={setFormat} options={[{ value: "post", label: "Post" }, { value: "reel", label: "Reel" }]} />}
            <div role="group" aria-label="Channels" className="flex flex-wrap gap-1">
              {BROADCAST_CHANNELS.map((channel) => {
                const on = draft.channels.includes(channel);
                const done = published.get(channel);
                const off = reel && !REEL_CHANNELS.includes(channel);
                return (
                  <button key={channel} type="button" aria-pressed={on} aria-label={BROADCAST_RULES[channel].label} title={off ? `${BROADCAST_RULES[channel].label} does not take reels` : BROADCAST_RULES[channel].label}
                    disabled={locked || Boolean(done) || off} onClick={() => toggleChannel(channel)}
                    className={cn("relative inline-flex size-8 items-center justify-center rounded-lg border transition-[border-color,background-color,color,transform] duration-(--motion-fast) active:scale-95 disabled:cursor-default disabled:active:scale-100",
                      on ? "border-accent/70 bg-accent/12 text-ink" : "border-hairline/50 text-ink-tertiary hover:border-hairline hover:text-ink", off && "opacity-30")}>
                    <ChannelMark channel={channel} size={14} />
                    {done && <Check size={10} strokeWidth={3} className="absolute -right-1 -top-1 rounded-full bg-success p-px text-white" aria-label="Published" />}
                  </button>
                );
              })}
            </div>
          </div>

          {campaigns.length > 0 && (
            <label className="flex w-fit max-w-full items-center gap-2 text-[12px] text-ink-secondary">
              <Megaphone size={13} className="shrink-0 text-ink-tertiary" aria-hidden="true" />Campaign
              <Select size="sm" className="min-w-0 max-w-[240px]" aria-label="Campaign" value={campaignId} disabled={locked} onChange={(event) => setCampaignId(event.target.value)}>
                <option value="">None</option>
                {campaigns.map((campaign) => <option key={campaign._id} value={campaign._id}>{campaign.name}</option>)}
              </Select>
            </label>
          )}

          <AccountRow channels={open} accounts={accounts} chosen={draft.accounts} locked={locked} onConnect={onConnect}
            onChoose={(channel, accountId) => set({ accounts: { ...draft.accounts, [channel]: accountId } })} />

          {(draft.channels.length > 0 || !locked) && (
            <div className="flex flex-col overflow-hidden rounded-xl border border-hairline/50 bg-inset transition-colors duration-(--motion-fast) focus-within:border-accent/60">
              <div role="tablist" aria-label="Text per channel" className="flex gap-0.5 overflow-x-auto border-b border-hairline/40 px-1.5 pt-1.5 [scrollbar-width:none]">
                {(["all", ...draft.channels] as const).map((item) => {
                  const length = item === "all" ? null : countText(item, textOf(item));
                  const over = item !== "all" && length! > BROADCAST_RULES[item].limit;
                  return (
                    <button key={item} type="button" role="tab" aria-selected={tab === item} onClick={() => { setTab(item); if (item !== "all") setPreviewChannel(item); }}
                      className={cn("flex h-8 shrink-0 items-center gap-1.5 rounded-t-lg px-2.5 text-[12px] transition-colors duration-(--motion-fast)",
                        tab === item ? "bg-panel text-ink" : "text-ink-secondary hover:text-ink")}>
                      {item === "all" ? (reel ? "Caption" : "All channels") : <><ChannelMark channel={item} size={12} />
                        <span className={cn("tabular-nums", over ? "text-danger" : draft.custom[item] !== undefined ? "text-accent-text" : "")}>{length}/{BROADCAST_RULES[item].limit}</span></>}
                    </button>
                  );
                })}
              </div>
              <textarea aria-label={tab === "all" ? "Post text" : `${BROADCAST_RULES[tab].label} text`} value={current} onChange={(event) => writeText(event.target.value)}
                readOnly={locked || (tab !== "all" && published.has(tab))} rows={6} placeholder={tab === "all" ? (reel ? "Write the caption" : "Write the post") : `Text for ${BROADCAST_RULES[tab].label}`}
                className="min-h-[132px] w-full resize-y bg-transparent px-3 py-2.5 text-[13.5px] leading-relaxed text-ink outline-none placeholder:text-ink-tertiary max-md:text-[16px]" />
              <HashtagRow channel={tab} text={current} locked={locked || (tab !== "all" && published.has(tab))}
                onAdd={(tag) => writeText(withHashtag(current, tag))} onRemove={(tag) => writeText(withoutHashtag(current, tag))} />
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

          {reel
            ? <ReelPanel video={video} videos={pickable.filter((asset) => asset.kind === "video")} coverMs={draft.coverMs} music={draft.music} locked={locked}
              onVideo={(id) => set({ assetIds: id ? [id] : [], coverMs: 0 })} onCover={(coverMs) => set({ coverMs })} onMusic={(music) => set({ music })} />
            : <MediaStrip media={media} pickable={pickable} locked={locked} onAdd={(id) => set({ assetIds: [...draft.assetIds, id] })} onRemove={(id) => set({ assetIds: draft.assetIds.filter((item) => item !== id) })} />}

          {problems.length > 0 && !locked && (
            <ul className="flex flex-col gap-0.5 text-[12px] text-warning" aria-label="Before scheduling">
              {problems.map((problem) => <li key={problem}>{problem}</li>)}
            </ul>
          )}

          {post?.variants.some((variant) => variant.error) && (
            <ul className="flex flex-col gap-1 rounded-lg bg-danger/10 px-3 py-2 text-[12px] text-danger" aria-label="Publishing errors">
              {post.variants.filter((variant) => variant.error).map((variant) => <li key={variant.channel}><strong className="font-medium">{BROADCAST_RULES[variant.channel].label}:</strong> {variant.error}</li>)}
            </ul>
          )}
          {action.error && <Notice tone="danger">{action.error}</Notice>}
        </div>

        <aside aria-label="Preview" className="flex min-w-0 flex-col gap-2.5 rounded-xl bg-inset/60 p-3 lg:sticky lg:top-0 lg:self-start">
          <div className="flex items-center gap-2">
            <span className="text-[11.5px] font-medium text-ink-tertiary">Preview</span>
            {reelPreview && (
              <button type="button" aria-pressed={safeZones} onClick={() => setSafeZones((on) => !on)}
                className={cn("inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11.5px] transition-colors duration-(--motion-fast)", safeZones ? "bg-raised text-ink" : "text-ink-tertiary hover:text-ink")}>
                <ScanLine size={12} />Safe zones
              </button>
            )}
            {draft.channels.length > 1 && <span className="ml-auto"><PreviewTabs channels={draft.channels} value={shownPreview!} onChange={setPreviewChannel} /></span>}
          </div>
          {shownPreview
            ? <div key={`${shownPreview}-${draft.format}`} className="motion-safe:animate-[rise_var(--motion-fast)_var(--ease-out)_backwards]">
              <ChannelPreview channel={shownPreview} text={textOf(shownPreview)} media={media} format={draft.format} coverMs={draft.coverMs} music={draft.music}
                {...identity(projectName, previewAccount)} safeZones={safeZones} />
            </div>
            : <p className="py-10 text-center text-[12px] text-ink-tertiary">Pick a channel to see the post as it will appear.</p>}
        </aside>
      </div>

      {!locked ? (
        <div className="mt-4 flex flex-col gap-2 border-t border-hairline/30 pt-3">
          {open.length > 0 && <BestTimes samples={metricSamples(posts)} channels={open} onPick={(next) => set({ at: toLocalInput(next) })} />}
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-[12px] text-ink-secondary">
              Publish
              <input type="datetime-local" aria-label="Publish at" className={cn(inputClass, "w-auto py-1")} value={draft.at} onChange={(event) => set({ at: event.target.value })} />
              {draft.at && <button type="button" className={cn(iconButton, "size-7")} aria-label="Publish now instead" onClick={() => set({ at: "" })}><X size={13} /></button>}
            </label>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {post && <button type="button" className={iconButton} aria-label="Delete post" title="Delete post" disabled={action.busy} onClick={remove}><Trash2 size={14} /></button>}
              {post && <button type="button" className={iconButton} aria-label="Duplicate post" title="Duplicate as a new draft" disabled={action.busy} onClick={duplicate}><Copy size={14} /></button>}
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
        </div>
      ) : post && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-hairline/30 pt-3">
          {post.variants.filter((variant) => variant.url).map((variant) => (
            <a key={variant.channel} href={variant.url} target="_blank" rel="noreferrer" className={cn(ghostButton, "min-h-7 px-2.5 py-1 text-[12px]")}>
              <ChannelMark channel={variant.channel} size={12} />Open on {BROADCAST_RULES[variant.channel].label}<ExternalLink size={11} />
            </a>
          ))}
          {canEdit && post.status === "published" && <>
            <button type="button" className={cn(iconButton, "ml-auto")} aria-label="Duplicate post" title="Duplicate as a new draft" disabled={action.busy} onClick={duplicate}><Copy size={14} /></button>
            <button type="button" className={iconButton} aria-label="Delete post" disabled={action.busy} onClick={remove}><Trash2 size={14} /></button>
          </>}
        </div>
      )}
    </Modal>
  );
}
