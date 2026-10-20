import { useState } from "react";
import { CalendarClock, ExternalLink, Loader2, Send, ShieldCheck } from "lucide-react";
import { cloudMutation, useCloudQuery } from "@/lib/origin-cloud";
import { openExternalLink } from "@/lib/app-links";
import { cn } from "@/lib/cn";
import { BROADCAST_RULES, type BroadcastChannel } from "../../../shared/broadcast";
import { postCardItem } from "../../../shared/origin-chat-card-items";
import type { OriginChatCard, OriginPostCardItem } from "../../../shared/origin-chat-cards";
import { ChannelMark } from "../origin-broadcast/ChannelMark";
import { ChannelPreview, CoverVideo, PreviewTabs } from "../origin-broadcast/ChannelPreview";
import { errorText } from "../origin-pages/repo-url";
import { CardFrame, More, dateTime, quietButton, rowButton, solidButton, useItemOpener } from "./CardFrame";

type Card = Extract<OriginChatCard, { kind: "broadcast" }>;
type Live = { canEdit: boolean; posts: Array<{ _id: string }> };

const STATUS: Record<OriginPostCardItem["status"], { label: string; tone: string }> = {
  draft: { label: "Draft", tone: "bg-raised/70 text-ink-secondary" },
  scheduled: { label: "Scheduled", tone: "bg-accent/12 text-accent-text" },
  publishing: { label: "Publishing", tone: "bg-accent/12 text-accent-text motion-safe:animate-pulse" },
  published: { label: "Published", tone: "bg-success/12 text-success" },
  failed: { label: "Failed", tone: "bg-danger/10 text-danger" },
};

function StatusBadge({ post }: { post: OriginPostCardItem }) {
  const { label, tone } = post.needsApproval ? { label: "Needs approval", tone: "bg-warning/12 text-warning" } : STATUS[post.status];
  return <span className={cn("shrink-0 rounded-md px-1.5 py-px text-[11px] font-medium", tone)}>{label}</span>;
}

function Thumb({ post }: { post: OriginPostCardItem }) {
  const first = post.media.find((item) => item.url && (item.kind === "image" || item.kind === "video"));
  if (!first?.url) return <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-raised/60 text-ink-tertiary"><Send size={14} aria-hidden="true" /></span>;
  return (
    <span className="size-10 shrink-0 overflow-hidden rounded-lg bg-inset">
      {first.kind === "video" ? <CoverVideo url={first.url} className="size-full" /> : <img src={first.url} alt="" loading="lazy" className="size-full object-cover" />}
    </span>
  );
}

const FOLDED_CHARS = 120;
const handleOf = (projectName: string) => `@${projectName.toLowerCase().replace(/[^a-z0-9]+/g, "") || "origin"}`;
const nextHour = () => {
  const at = new Date(Date.now() + 3_600_000);
  at.setMinutes(0, 0, 0);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
};

function PostActions({ post, canEdit, onOpen }: { post: OriginPostCardItem; canEdit: boolean; onOpen(): void }) {
  const [at, setAt] = useState(nextHour);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (work: () => Promise<unknown>, fallback: string) => {
    setBusy(true);
    setError("");
    try { await work(); } catch (cause) { setError(errorText(cause, fallback)); } finally { setBusy(false); }
  };
  const published = post.channels.filter((channel) => channel.url);
  if (post.status === "published" || post.status === "publishing") {
    return published.length ? (
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {published.map((channel) => (
          <button key={channel.channel} type="button" className={quietButton} onClick={() => void openExternalLink(channel.url!)}>
            <ChannelMark channel={channel.channel} size={12} />Open on {BROADCAST_RULES[channel.channel].label}<ExternalLink size={11} aria-hidden="true" />
          </button>
        ))}
      </div>
    ) : null;
  }
  if (post.status === "scheduled") {
    return <p className="mt-2.5 flex items-center gap-1.5 text-[12px] text-ink-secondary"><CalendarClock size={13} aria-hidden="true" />Goes out {post.scheduledAt ? dateTime(post.scheduledAt) : "soon"}</p>;
  }
  if (!canEdit) {
    return <p className="mt-2.5 text-[12px] text-ink-tertiary">{post.needsApproval ? "Waits for an editor's approval." : "An editor schedules it."}</p>;
  }
  return (
    <div className="mt-2.5 flex flex-col gap-1.5" role="group" aria-label="Post actions">
      {post.needsApproval && post.channels.some((channel) => channel.truncated) ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 text-[12px] text-ink-secondary">This post is longer than the card shows. Read all of it before you approve it.</span>
          <button type="button" className={quietButton} onClick={onOpen}>Open post</button>
        </div>
      ) : post.needsApproval ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 text-[12px] text-ink-secondary">{post.agentName ?? "An agent"} wrote it. Approve it before it can be scheduled.</span>
          <button type="button" className={solidButton} disabled={busy} onClick={() => void run(() => cloudMutation("broadcast:approve", { postId: post.id }), "Could not approve the post")}>
            {busy ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <ShieldCheck size={13} aria-hidden="true" />}Approve
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <input type="datetime-local" aria-label="Publish at" value={at} onChange={(event) => setAt(event.target.value)}
            className="h-7 min-w-0 flex-1 rounded-lg border border-hairline/60 bg-inset px-2 text-[12px] text-ink outline-none transition-colors duration-(--motion-fast) focus:border-accent/70" />
          <button type="button" className={solidButton} disabled={busy || !at} onClick={() => void run(() => cloudMutation("broadcast:schedule", { postId: post.id, at: new Date(at).getTime() }), "Could not schedule the post")}>
            {busy ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <CalendarClock size={13} aria-hidden="true" />}Schedule
          </button>
        </div>
      )}
      {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
    </div>
  );
}

function SinglePost({ card, post, canEdit }: { card: Card; post: OriginPostCardItem; canEdit: boolean }) {
  const opener = useItemOpener(card.projectId);
  const channels = post.channels.map((channel) => channel.channel);
  const [shown, setShown] = useState<BroadcastChannel | undefined>(channels[0]);
  const channel = post.channels.find((entry) => entry.channel === shown) ?? post.channels[0];
  const projectName = card.projectName ?? "Origin";
  return (
    <CardFrame kind="broadcast" label={`${card.heading}, ${post.needsApproval ? "needs approval" : STATUS[post.status].label}`} icon={Send} wide
      title={<span className="flex items-center gap-2"><span className="truncate">{card.heading}</span><StatusBadge post={post} /></span>}
      meta={[card.projectName, post.agentName && `by ${post.agentName}`].filter(Boolean).join(" · ")}
      openLabel="Open post in Publish" onOpen={() => opener.open({ kind: "post", itemId: post.id })} openable={opener.openable}>
      {channels.length > 1 && shown && <div className="mt-2.5 flex"><PreviewTabs channels={channels} value={shown} onChange={setShown} /></div>}
      {channel && (
        <div className="mt-2" data-card-preview={channel.channel}>
          <ChannelPreview channel={channel.channel} text={channel.text} format={post.format ?? "post"} name={projectName} handle={handleOf(projectName)} safeZones={false}
            media={post.media.map((item, index) => ({ id: `${index}:${item.name}`, name: item.name, url: item.url ?? null, kind: item.kind === "image" || item.kind === "video" ? item.kind : "other" }))} />
          {channel.text.length > FOLDED_CHARS && (
            <details className="mt-1.5 rounded-lg bg-raised/40 px-2.5 py-1.5 text-[12.5px] text-ink-secondary">
              <summary className="cursor-pointer text-[12px] text-ink-tertiary outline-none hover:text-ink focus-visible:text-ink">Full text for {BROADCAST_RULES[channel.channel].label}</summary>
              <p className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{channel.text}{channel.truncated ? "…" : ""}</p>
            </details>
          )}
          {channel.error && <p className="mt-1.5 text-[12px] text-danger">{BROADCAST_RULES[channel.channel].label} failed: {channel.error}</p>}
        </div>
      )}
      <PostActions post={post} canEdit={canEdit} onOpen={() => opener.open({ kind: "post", itemId: post.id })} />
    </CardFrame>
  );
}

export function BroadcastCard({ card }: { card: Card }) {
  const live = useCloudQuery<Live>("broadcast:list", { projectId: card.projectId });
  const opener = useItemOpener(card.projectId);
  const posts = card.posts.map((post) => {
    const row = live?.posts.find((candidate) => candidate._id === post.id);
    return row ? postCardItem(row) : post;
  });
  if (posts.length === 1) return <SinglePost card={card} post={posts[0]!} canEdit={live?.canEdit ?? false} />;
  return (
    <CardFrame kind="broadcast" label={card.heading} icon={Send} title={card.heading} meta={card.projectName}
      openLabel="Open Publish" onOpen={() => opener.open({ kind: "post" })} openable={opener.openable}>
      <ul className="mt-2 flex flex-col gap-0.5" aria-label="Posts">
        {posts.map((post) => (
          <li key={post.id}>
            <button type="button" className={rowButton} disabled={!opener.openable} title={opener.title}
              onClick={() => opener.open({ kind: "post", itemId: post.id })}>
              <Thumb post={post} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] text-ink">{post.channels[0]?.text.trim() || `${post.media.length} media`}</span>
                <span className="flex items-center gap-1.5 text-[11.5px] text-ink-tertiary">
                  {post.channels.map((channel) => <ChannelMark key={channel.channel} channel={channel.channel} size={11} />)}
                  {post.scheduledAt ? <span className="truncate">{dateTime(post.scheduledAt)}</span> : null}
                </span>
              </span>
              <StatusBadge post={post} />
            </button>
          </li>
        ))}
      </ul>
      <More count={card.more} where="Publish" />
    </CardFrame>
  );
}
