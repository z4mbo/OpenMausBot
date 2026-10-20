import { useMemo, useState } from "react";
import { Check, Loader2, Search } from "lucide-react";
import { cloudMutation, useCloudQuery } from "@/lib/origin-cloud";
import { cn } from "@/lib/cn";
import { BROADCAST_CHANNELS, BROADCAST_RULES } from "../../../shared/broadcast";
import { CAMPAIGN_LIMITS, campaignSlug, type CampaignDetail, type CampaignLinkKind, type CampaignSummary } from "../../../shared/origin-campaigns";
import type { CloudBoard } from "../origin-pages/cloud-types";
import { Field, Modal, Notice, ghostButton, inputClass, primaryButton, useAction } from "../origin-pages/ui";
import { ChannelMark } from "./ChannelMark";
import { emptyCampaignForm, formOf, formProblem, type CampaignForm } from "./campaign-model";
import type { BroadcastPost } from "./broadcast-model";

export function CampaignDialog({ projectId, campaign, onSaved, onClose }: {
  projectId: string;
  campaign: CampaignSummary | null;
  onSaved(campaignId: string): void;
  onClose(): void;
}) {
  const [form, setForm] = useState<CampaignForm>(() => campaign ? formOf(campaign) : emptyCampaignForm());
  const { busy, error, run } = useAction();
  const set = (patch: Partial<CampaignForm>) => setForm((current) => ({ ...current, ...patch }));
  const problem = formProblem(form);
  const toggle = (channel: CampaignForm["channels"][number]) =>
    set({ channels: form.channels.includes(channel) ? form.channels.filter((item) => item !== channel) : BROADCAST_CHANNELS.filter((item) => item === channel || form.channels.includes(item)) });

  const save = () => run(async () => {
    const fields = { ...form, name: form.name.trim() };
    const id = campaign
      ? (await cloudMutation("campaigns:update", { projectId, campaignId: campaign._id, ...fields }), campaign._id)
      : await cloudMutation<string>("campaigns:create", { projectId, ...fields });
    onSaved(id);
  }, campaign ? "Could not save the campaign" : "Could not create the campaign");

  return (
    <Modal title={campaign ? "Edit campaign" : "New campaign"} onClose={onClose} className="sm:max-w-lg">
      <form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); if (!problem) void save(); }}>
        <Field label="Name">
          <input className={inputClass} value={form.name} maxLength={CAMPAIGN_LIMITS.name} autoFocus onChange={(event) => set({ name: event.target.value })} placeholder="Spring launch" />
          {!campaign && form.name.trim() && <span className="text-[11.5px] text-ink-tertiary">utm_campaign={campaignSlug(form.name)}</span>}
        </Field>
        <Field label="Goal">
          <textarea className={cn(inputClass, "min-h-[64px] resize-y")} value={form.goal} maxLength={CAMPAIGN_LIMITS.goal} onChange={(event) => set({ goal: event.target.value })} placeholder="200 sign-ups for the beta" />
        </Field>
        <Field label="Audience">
          <textarea className={cn(inputClass, "min-h-[48px] resize-y")} value={form.audience} maxLength={CAMPAIGN_LIMITS.audience} onChange={(event) => set({ audience: event.target.value })} placeholder="Indie founders shipping their first SaaS" />
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-ink-secondary">Channels</span>
          <div className="flex flex-wrap gap-1.5">
            {BROADCAST_CHANNELS.map((channel) => {
              const on = form.channels.includes(channel);
              return (
                <button key={channel} type="button" aria-pressed={on} onClick={() => toggle(channel)}
                  className={cn("flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] transition-colors duration-(--motion-fast) outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                    on ? "border-accent/50 bg-accent/15 text-ink" : "border-hairline/40 text-ink-secondary hover:bg-raised hover:text-ink")}>
                  <ChannelMark channel={channel} size={12} />{BROADCAST_RULES[channel].label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts"><input type="date" className={inputClass} value={form.startDate} onChange={(event) => set({ startDate: event.target.value })} /></Field>
          <Field label="Ends"><input type="date" className={inputClass} value={form.endDate} min={form.startDate || undefined} onChange={(event) => set({ endDate: event.target.value })} /></Field>
        </div>
        <Field label="Budget">
          <input className={inputClass} value={form.budgetNote} maxLength={CAMPAIGN_LIMITS.budget} onChange={(event) => set({ budgetNote: event.target.value })} placeholder="€300 for boosted posts" />
        </Field>
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex items-center justify-end gap-2 pt-1">
          {problem && form.name.trim() && <span className="mr-auto text-[12px] text-danger">{problem}</span>}
          <button type="button" className={ghostButton} onClick={onClose}>Cancel</button>
          <button type="submit" className={primaryButton} disabled={busy || Boolean(problem)}>
            {busy && <Loader2 size={14} className="animate-spin" />}{campaign ? "Save" : "Create"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

type Candidate = { id: string; title: string; meta: string; thumb?: string };

const LINK_TITLE: Record<CampaignLinkKind, string> = { post: "Link posts", generation: "Link Studio content", issue: "Link issues" };

type StudioRow = { _id: string; kind: string; status: string; prompt: string; modelLabel: string; outputs: { url: string; kind: string }[] };

function useCandidates(projectId: string, kind: CampaignLinkKind, posts: readonly BroadcastPost[]): Candidate[] | undefined {
  const studio = useCloudQuery<StudioRow[]>("studio:list", kind === "generation" ? { projectId } : "skip");
  const board = useCloudQuery<CloudBoard>("tasks:board", kind === "issue" ? { projectId } : "skip");
  return useMemo(() => {
    if (kind === "post") return posts.map((post) => ({ id: post._id, title: post.variants[0]?.text.trim() || "Media post", meta: `${post.status} · ${post.variants.map((variant) => BROADCAST_RULES[variant.channel].label).join(", ")}` }));
    if (kind === "generation") return studio?.filter((row) => row.status !== "failed").map((row) => ({ id: row._id, title: row.prompt || row.modelLabel, meta: `${row.kind} · ${row.modelLabel}`, ...(row.outputs[0]?.kind === "image" ? { thumb: row.outputs[0].url } : {}) }));
    if (!board) return undefined;
    const columns = new Map(board.columns.map((column) => [column._id, column.title]));
    return board.tasks.map((task) => ({ id: task._id, title: task.title, meta: `${task.done ? "Done" : columns.get(task.columnId) ?? ""}${task.assignedToName ? ` · ${task.assignedToName}` : ""}` }));
  }, [kind, posts, studio, board]);
}

function linkedIds(detail: CampaignDetail, kind: CampaignLinkKind): Set<string> {
  if (kind === "post") return new Set(detail.posts.map((post) => post._id));
  if (kind === "generation") return new Set(detail.generations.map((row) => row._id));
  return new Set(detail.issues.map((issue) => issue._id));
}

export function LinkDialog({ projectId, detail, kind, posts, onClose }: { projectId: string; detail: CampaignDetail; kind: CampaignLinkKind; posts: readonly BroadcastPost[]; onClose(): void }) {
  const candidates = useCandidates(projectId, kind, posts);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const linked = linkedIds(detail, kind);
  const needle = query.trim().toLowerCase();
  const shown = (candidates ?? []).filter((item) => !needle || `${item.title} ${item.meta}`.toLowerCase().includes(needle)).slice(0, 80);

  const toggle = async (item: Candidate) => {
    if (busy !== null) return;
    setBusy(item.id);
    setError("");
    try {
      await cloudMutation("campaigns:link", { projectId, campaignId: detail._id, kind, itemId: item.id, ...(linked.has(item.id) ? { remove: true } : {}) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change the link");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal title={LINK_TITLE[kind]} onClose={onClose} className="sm:max-w-lg">
      <label className="relative mb-2 flex items-center">
        <Search size={14} className="pointer-events-none absolute left-3 text-ink-tertiary" />
        <input className={cn(inputClass, "w-full pl-8")} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" aria-label="Search" autoFocus />
      </label>
      {error && <div className="mb-2"><Notice tone="danger">{error}</Notice></div>}
      <div className="-mx-1 flex max-h-[min(60vh,420px)] flex-col overflow-y-auto">
        {!candidates ? <span className="flex items-center gap-2 px-2 py-6 text-[13px] text-ink-tertiary"><Loader2 size={14} className="animate-spin" />Loading</span>
          : !shown.length ? <span className="px-2 py-6 text-center text-[13px] text-ink-tertiary">{candidates.length ? "No match" : "Nothing to link yet"}</span>
          : shown.map((item) => {
            const on = linked.has(item.id);
            return (
              <button key={item.id} type="button" aria-pressed={on} aria-busy={busy === item.id} onClick={() => void toggle(item)}
                className={cn("flex min-w-0 items-center gap-3 rounded-lg px-2 py-2 text-left outline-none transition-[background-color,opacity] duration-(--motion-fast) hover:bg-raised/60 focus-visible:bg-raised/60",
                  busy !== null && busy !== item.id && "opacity-60")}>
                {item.thumb ? <img src={item.thumb} alt="" className="size-9 shrink-0 rounded-md object-cover" /> : null}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-ink">{item.title}</span>
                  <span className="block truncate text-[11.5px] text-ink-tertiary">{item.meta}</span>
                </span>
                <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-md border", on ? "border-accent bg-accent text-accent-ink" : "border-hairline/60")}>
                  {busy === item.id ? <Loader2 size={12} className="animate-spin" /> : on ? <Check size={12} /> : null}
                </span>
              </button>
            );
          })}
      </div>
    </Modal>
  );
}
