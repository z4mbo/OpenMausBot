import { useMemo, useState } from "react";
import { Bookmark, Download, GitMerge, Inbox, Loader2, Plus, Reply, Search, Tag, Upload, Users, X, Zap } from "lucide-react";
import { cloudMutation, useCloudQuery } from "@/lib/origin-cloud";
import { cn } from "@/lib/cn";
import { Select } from "../Select";
import { EmptyState, Notice, cardClass, ghostButton, inputClass, primaryButton, underGlass } from "../origin-pages/ui";
import { CLOSED_STAGES, formatLeadValue, type PipelineLead } from "../../../shared/origin-pipeline";
import {
  contactsCsv, duplicateGroups, leadSources, matchesView, type CaptureHealth, type SalesView, type SalesViewFilters,
} from "../../../shared/origin-sales";
import { defaultSequence, dueTone, ownerKey, type LeadInsight } from "./pipeline-model";
import { OwnerAvatar, type OwnerOption } from "./owners";
import { NextActionChip, ScoreBadge } from "./LeadInsight";
import { MergeDialog, SaveViewDialog } from "./SalesDialogs";
import { since } from "./activity-labels";
import { errorText } from "../origin-pages/repo-url";

type Sort = { key: "name" | "stage" | "value" | "due" | "activity" | "score"; desc: boolean };

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function ContactsView({ projectId, leads, stages, currency, canEdit, owners, insights, pendingLeads, onOpen, onStage, onCapture, onImport, onNew }: {
  projectId: string; leads: readonly PipelineLead[]; stages: readonly string[]; currency: string; canEdit: boolean; owners: readonly OwnerOption[];
  insights: ReadonlyMap<string, LeadInsight>; pendingLeads: ReadonlySet<string>;
  onOpen(leadId: string): void; onStage(lead: PipelineLead, stage: string): void; onCapture(): void; onImport(): void; onNew(): void;
}) {
  const views = useCloudQuery<SalesView[]>("pipelineContacts:views", { projectId });
  const health = useCloudQuery<CaptureHealth>("pipelineContacts:captureHealth", { projectId });
  const [filters, setFilters] = useState<SalesViewFilters>({});
  const [viewId, setViewId] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [dialog, setDialog] = useState<"merge" | "view" | null>(null);
  const [notice, setNotice] = useState<{ tone: "info" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [tag, setTag] = useState("");

  const visible = leads.filter((lead) => matchesView(lead, filters, ownerKey));
  const groups = useMemo(() => duplicateGroups(leads), [leads]);
  const sources = useMemo(() => [...new Set(leads.flatMap(leadSources))].sort(), [leads]);
  const tags = useMemo(() => [...new Set(leads.flatMap((lead) => lead.tags))].sort(), [leads]);
  const chosen = visible.filter((lead) => selected.has(lead._id));
  const active = Object.values(filters).some((value) => value !== undefined && value !== "" && value !== false);
  const set = (patch: SalesViewFilters) => { setViewId(""); setFilters((current) => ({ ...current, ...patch })); };
  const apply = (id: string) => {
    setViewId(id);
    setFilters(views?.find((view) => view._id === id)?.filters ?? {});
    setSelected(new Set());
  };

  const bulk = async (label: string, run: () => Promise<string>) => {
    setBusy(true);
    setNotice(null);
    try { setNotice({ tone: "info", text: await run() }); }
    catch (error) { setNotice({ tone: "danger", text: errorText(error, `Could not ${label}`) }); }
    finally { setBusy(false); }
  };
  const update = (patch: Record<string, unknown>, label: string) => void bulk(label, async () => {
    const { updated } = await cloudMutation<{ updated: number }>("pipelineContacts:bulkUpdate", { projectId, leadIds: chosen.map((lead) => lead._id), ...patch });
    return `Updated ${updated} ${updated === 1 ? "contact" : "contacts"}.`;
  });
  const sequence = () => void bulk("start sequences", async () => {
    let started = 0;
    const skipped: string[] = [];
    for (const lead of chosen) {
      if (CLOSED_STAGES.includes(lead.stage)) { skipped.push(lead.name); continue; }
      try {
        const steps = defaultSequence(lead).map(({ key: _key, ...step }) => step);
        await cloudMutation("pipelineSequences:start", { projectId, leadId: lead._id, steps });
        started++;
      } catch { skipped.push(lead.name); }
    }
    return `Started ${started} ${started === 1 ? "sequence" : "sequences"}; each first touch waits for approval.${skipped.length ? ` Skipped ${skipped.slice(0, 3).join(", ")}${skipped.length > 3 ? ` and ${skipped.length - 3} more` : ""}.` : ""}`;
  });
  const exportCsv = () => download(`contacts-${new Date().toISOString().slice(0, 10)}.csv`, contactsCsv(chosen.length ? chosen : visible));
  const removeView = (view: SalesView) => {
    if (!window.confirm(`Delete the view ${view.name}?`)) return;
    void cloudMutation("pipelineContacts:removeView", { projectId, viewId: view._id }).then(() => { if (viewId === view._id) apply(""); }, () => undefined);
  };
  const summary = [filters.query && `"${filters.query}"`, filters.stage, filters.owner && owners.find((owner) => ownerKey(owner) === filters.owner)?.name, filters.source && `from ${filters.source}`,
    filters.tag && `#${filters.tag}`, filters.reach && `with ${filters.reach}`, filters.unread && "unread"].filter(Boolean).join(" · ");

  if (!leads.length) {
    return (
      <div className={cn("flex min-h-0 flex-1 flex-col px-4 md:px-6", underGlass)}>
        <EmptyState icon={<Users size={22} />} title="No contacts yet" body={canEdit ? "Add the people you want to win, import a CSV, or capture them from your pages and apps." : undefined}
          action={canEdit ? (
            <div className="flex flex-wrap justify-center gap-2">
              <button type="button" className={primaryButton} onClick={onNew}><Plus size={14} />New contact</button>
              <button type="button" className={ghostButton} onClick={onImport}><Upload size={14} />Import CSV</button>
              <button type="button" className={ghostButton} onClick={onCapture}><Inbox size={14} />Capture from apps</button>
            </div>
          ) : undefined} />
      </div>
    );
  }

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-6 md:px-6", underGlass)}>
      <div className="flex flex-wrap items-center gap-1.5" role="toolbar" aria-label="Saved views">
        <ViewChip label="All contacts" count={leads.length} active={!viewId && !active} onClick={() => { apply(""); }} />
        {(views ?? []).map((view) => (
          <ViewChip key={view._id} label={view.name} active={viewId === view._id} onClick={() => apply(view._id)} onRemove={canEdit ? () => removeView(view) : undefined} />
        ))}
        {canEdit && active && !viewId && <button type="button" className={cn(ghostButton, "h-7 min-h-7 rounded-full px-2.5 text-[12px]")} onClick={() => setDialog("view")}><Bookmark size={12} />Save view</button>}
        <button type="button" onClick={onCapture} className="ml-auto flex items-center gap-1.5 rounded-full px-2 py-1 text-[12px] text-ink-tertiary hover:text-ink" title="Lead capture from your pages and apps">
          <span className={cn("size-1.5 rounded-full", health?.lastCaptureAt && Date.now() - health.lastCaptureAt < 7 * 86_400_000 ? "bg-success" : "bg-ink-tertiary/60")} aria-hidden="true" />
          {health?.lastCaptureAt ? `Last captured ${since(health.lastCaptureAt)} · ${health.last24h} today` : "Nothing captured yet"}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex min-w-40 flex-1 items-center sm:max-w-60">
          <Search size={14} className="pointer-events-none absolute left-2.5 text-ink-tertiary" aria-hidden="true" />
          <input className={cn(inputClass, "h-8 pl-8")} placeholder="Search contacts" aria-label="Search contacts" value={filters.query ?? ""} onChange={(event) => set({ query: event.target.value })} />
        </label>
        <Select size="sm" aria-label="Stage" value={filters.stage ?? ""} onChange={(event) => set({ stage: event.target.value || undefined })}>
          <option value="">All stages</option>{stages.map((stage) => <option key={stage} value={stage}>{stage}</option>)}
        </Select>
        <Select size="sm" aria-label="Owner" value={filters.owner ?? ""} onChange={(event) => set({ owner: event.target.value || undefined })}>
          <option value="">Everyone</option>{owners.map((owner) => <option key={ownerKey(owner)} value={ownerKey(owner)}>{owner.name}</option>)}
        </Select>
        <Select size="sm" aria-label="Source" value={filters.source ?? ""} onChange={(event) => set({ source: event.target.value || undefined })}>
          <option value="">All sources</option>{sources.map((source) => <option key={source} value={source}>{source}</option>)}
        </Select>
        {tags.length > 0 && (
          <Select size="sm" aria-label="Tag" value={filters.tag ?? ""} onChange={(event) => set({ tag: event.target.value || undefined })}>
            <option value="">All tags</option>{tags.map((item) => <option key={item} value={item}>{item}</option>)}
          </Select>
        )}
        <Select size="sm" aria-label="Reachable by" value={filters.reach ?? ""} onChange={(event) => set({ reach: (event.target.value || undefined) as SalesViewFilters["reach"] })}>
          <option value="">Any contact info</option><option value="email">Has email</option><option value="phone">Has phone</option>
        </Select>
        <button type="button" aria-pressed={Boolean(filters.unread)} onClick={() => set({ unread: !filters.unread || undefined })}
          className={cn(ghostButton, "h-8 rounded-full px-2.5", filters.unread && "border-accent/50 bg-accent/10 text-accent-text")}><Reply size={13} />Unread</button>
        {groups.length > 0 && canEdit && (
          <button type="button" className={cn(ghostButton, "h-8 rounded-full px-2.5")} onClick={() => setDialog("merge")}><GitMerge size={13} />{groups.length} possible {groups.length === 1 ? "duplicate" : "duplicates"}</button>
        )}
        <button type="button" className={cn(ghostButton, "h-8 rounded-full px-2.5", groups.length > 0 && canEdit ? "" : "sm:ml-auto")} onClick={exportCsv} title="Export the selected contacts, or every one shown, as CSV">
          <Download size={13} />Export{chosen.length ? ` ${chosen.length}` : ""}
        </button>
      </div>
      {chosen.length > 0 && canEdit && (
        <div className={cn(cardClass, "flex flex-wrap items-center gap-2 px-3 py-2 motion-safe:animate-pop-in")} role="toolbar" aria-label="Bulk actions">
          <strong className="text-[12.5px] font-medium text-ink">{chosen.length} selected</strong>
          <Select size="sm" aria-label="Assign to" value="" disabled={busy} onChange={(event) => {
            const key = event.target.value;
            if (!key) return;
            const owner = owners.find((option) => ownerKey(option) === key);
            update({ owner: owner ? { kind: owner.kind, name: owner.name, ...(owner.id ? { id: owner.id } : {}) } : null }, "assign");
          }}>
            <option value="">Assign to…</option>{owners.map((owner) => <option key={ownerKey(owner)} value={ownerKey(owner)}>{owner.name}</option>)}<option value="none">No owner</option>
          </Select>
          <Select size="sm" aria-label="Move to stage" value="" disabled={busy} onChange={(event) => { if (event.target.value) update({ stage: event.target.value }, "move"); }}>
            <option value="">Move to…</option>{stages.map((stage) => <option key={stage} value={stage}>{stage}</option>)}
          </Select>
          <form className="flex items-center gap-1" onSubmit={(event) => { event.preventDefault(); if (tag.trim()) { update({ addTags: [tag] }, "tag"); setTag(""); } }}>
            <span className="relative flex items-center">
              <Tag size={12} className="pointer-events-none absolute left-2 text-ink-tertiary" aria-hidden="true" />
              <input className={cn(inputClass, "h-8 w-28 pl-6 text-[12.5px]")} aria-label="Tag to add" placeholder="Add tag" value={tag} maxLength={40} onChange={(event) => setTag(event.target.value)} />
            </span>
          </form>
          <button type="button" className={cn(ghostButton, "h-8 rounded-full px-2.5")} disabled={busy} onClick={sequence} title="Day 0 email, day 3 text and day 7 call, drafted for approval">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}Start sequence
          </button>
          <button type="button" className="ml-auto text-[12px] text-ink-tertiary hover:text-ink" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      <ContactTable leads={visible} stages={stages} currency={currency} canEdit={canEdit} owners={owners} selected={selected} pendingLeads={pendingLeads} insights={insights}
        onSelect={setSelected} onOpen={onOpen} onStage={onStage} />
      {dialog === "merge" && <MergeDialog projectId={projectId} groups={groups} currency={currency} onClose={() => setDialog(null)} />}
      {dialog === "view" && <SaveViewDialog projectId={projectId} summary={summary} filters={filters as Record<string, unknown>} onClose={() => setDialog(null)} onSaved={(id) => { setDialog(null); setViewId(id); }} />}
    </div>
  );
}

function ViewChip({ label, count, active, onClick, onRemove }: { label: string; count?: number; active: boolean; onClick(): void; onRemove?(): void }) {
  return (
    <span className={cn("inline-flex h-7 items-center rounded-full border text-[12.5px] transition-colors", active ? "border-accent/50 bg-accent/10 text-accent-text" : "border-hairline/50 text-ink-secondary hover:text-ink")}>
      <button type="button" aria-pressed={active} className="flex h-full items-center gap-1 rounded-full px-2.5 outline-none focus-visible:ring-2 focus-visible:ring-accent/60" onClick={onClick}>
        {label}{count !== undefined && <span className="tabular-nums text-ink-tertiary">{count}</span>}
      </button>
      {onRemove && <button type="button" aria-label={`Delete the view ${label}`} className="-ml-1 mr-1 flex size-5 items-center justify-center rounded-full text-ink-tertiary hover:text-ink" onClick={onRemove}><X size={11} /></button>}
    </span>
  );
}

function ContactTable({ leads, stages, currency, canEdit, owners, selected, pendingLeads, insights, onSelect, onOpen, onStage }: {
  leads: readonly PipelineLead[]; stages: readonly string[]; currency: string; canEdit: boolean; owners: readonly OwnerOption[]; selected: ReadonlySet<string>; pendingLeads: ReadonlySet<string>;
  insights: ReadonlyMap<string, LeadInsight>; onSelect(next: ReadonlySet<string>): void; onOpen(leadId: string): void; onStage(lead: PipelineLead, stage: string): void;
}) {
  const [sort, setSort] = useState<Sort>({ key: "activity", desc: true });
  const sorted = [...leads].sort((a, b) => {
    const order = sort.key === "name" ? a.name.localeCompare(b.name)
      : sort.key === "stage" ? stages.indexOf(a.stage) - stages.indexOf(b.stage)
      : sort.key === "value" ? (a.value ?? 0) - (b.value ?? 0)
      : sort.key === "due" ? (a.nextDue ?? "9999").localeCompare(b.nextDue ?? "9999")
      : sort.key === "score" ? (insights.get(a._id)?.score ?? 0) - (insights.get(b._id)?.score ?? 0)
      : (a.lastActivityAt ?? a.createdAt) - (b.lastActivityAt ?? b.createdAt);
    return sort.desc ? -order : order;
  });
  const all = leads.length > 0 && leads.every((lead) => selected.has(lead._id));
  const header = (key: Sort["key"], label: string, className = "") => (
    <th scope="col" className={cn("px-2 py-2 font-medium", className)} aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : undefined}>
      <button type="button" className="rounded hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent/60" onClick={() => setSort((current) => ({ key, desc: current.key === key ? !current.desc : key !== "name" }))}>
        {label}{sort.key === key ? (sort.desc ? " ↓" : " ↑") : ""}
      </button>
    </th>
  );
  if (!leads.length) return <EmptyState compact icon={<Search size={22} />} title="No matching contacts" body="Try another search or filter." />;
  return (
    <div className={cn(cardClass, "relative overflow-x-auto")}>
      <table className="w-full min-w-[1000px] border-collapse text-left text-[13px]">
        <thead className="border-b border-hairline/40 text-[12px] text-ink-tertiary">
          <tr>
            <th scope="col" className="w-9 px-3 py-2">
              <input type="checkbox" aria-label="Select all contacts" checked={all} className="accent-[var(--color-accent)]" onChange={() => onSelect(all ? new Set() : new Set(leads.map((lead) => lead._id)))} />
            </th>
            {header("name", "Contact")}
            {header("stage", "Stage")}
            {header("value", "Value", "text-right")}
            {header("score", "Score", "text-right")}
            <th scope="col" className="px-2 py-2 font-medium">Next</th>
            <th scope="col" className="px-2 py-2 font-medium">Email and phone</th>
            <th scope="col" className="px-2 py-2 font-medium">Sources</th>
            <th scope="col" className="px-2 py-2 font-medium">Owner</th>
            {header("due", "Due")}
            {header("activity", "Last touch")}
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline/30">
          {sorted.map((lead) => {
            const due = dueTone(lead.nextDue);
            const insight = insights.get(lead._id);
            return (
              <tr key={lead._id} className={cn("cursor-pointer transition-colors hover:bg-raised/30", selected.has(lead._id) && "bg-accent/[0.06]")} onClick={() => onOpen(lead._id)}>
                <td className="px-3 py-1.5" onClick={(event) => event.stopPropagation()}>
                  <input type="checkbox" aria-label={`Select ${lead.name}`} checked={selected.has(lead._id)} className="accent-[var(--color-accent)]"
                    onChange={() => { const next = new Set(selected); if (next.has(lead._id)) next.delete(lead._id); else next.add(lead._id); onSelect(next); }} />
                </td>
                <td className="max-w-[220px] px-2 py-1.5">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <button type="button" className="block min-w-0 truncate rounded text-left font-medium text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/60" onClick={(event) => { event.stopPropagation(); onOpen(lead._id); }}>{lead.name}</button>
                    {lead.unreadReplies ? <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-accent px-1.5 text-[10.5px] font-semibold text-accent-ink"><Reply size={10} aria-hidden="true" />{lead.unreadReplies}<span className="sr-only"> unread</span></span> : null}
                  </span>
                  {lead.company && <span className="block truncate text-[12px] text-ink-secondary">{lead.company}</span>}
                </td>
                <td className="px-2 py-1.5" onClick={(event) => event.stopPropagation()}>
                  {canEdit ? (
                    <Select size="sm" aria-label={`Stage of ${lead.name}`} value={lead.stage} onChange={(event) => onStage(lead, event.target.value)}>
                      {stages.map((stage) => <option key={stage} value={stage}>{stage}</option>)}
                    </Select>
                  ) : <span className="text-ink-secondary">{lead.stage}</span>}
                  {pendingLeads.has(lead._id) && <span className="ml-1.5 rounded-full bg-accent/15 px-1.5 py-px text-[11px] text-accent-text">Approval</span>}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-ink">{lead.value ? formatLeadValue(lead.value, currency) : <span className="text-ink-tertiary">—</span>}</td>
                <td className="px-2 py-1.5 text-right">{insight && !CLOSED_STAGES.includes(lead.stage) ? <ScoreBadge score={insight} /> : <span className="text-ink-tertiary">—</span>}</td>
                <td className="px-2 py-1.5"><span className="flex flex-wrap gap-1">{insight?.actions.map((item) => <NextActionChip key={item.kind} action={item} />)}</span></td>
                <td className="max-w-[200px] px-2 py-1.5 text-[12px] text-ink-secondary"><span className="block truncate">{lead.email ?? ""}</span><span className="block truncate tabular-nums">{lead.phone ?? ""}</span></td>
                <td className="max-w-[160px] px-2 py-1.5 text-[12px] text-ink-tertiary"><span className="block truncate" title={leadSources(lead).join(", ")}>{leadSources(lead).join(" · ")}</span></td>
                <td className="px-2 py-1.5"><OwnerAvatar owner={lead.owner} owners={owners} /></td>
                <td className={cn("whitespace-nowrap px-2 py-1.5 text-[12px]", due?.tone === "late" ? "text-danger" : due?.tone === "soon" ? "text-warning" : "text-ink-secondary")}>{due?.label ?? ""}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-[12px] text-ink-tertiary">{new Date(lead.lastActivityAt ?? lead.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
