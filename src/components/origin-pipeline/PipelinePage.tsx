import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { CalendarDays, Columns3, GripVertical, Inbox, List, Mail, Phone, Plus, Reply, Search, SlidersHorizontal, Sparkles, Target, Upload } from "lucide-react";
import { useStore, type Bot } from "@/state/store";
import { cloudMutation, useCloudQuery } from "@/lib/origin-cloud";
import { cn } from "@/lib/cn";
import { setChiefSectionOf } from "@/lib/origin-chief-section";
import { openBot } from "@/state/thread-navigation";
import { useShowThreads } from "@/lib/thread-preferences";
import { consumeLeadFocus, useLeadFocus } from "@/lib/origin-lead-focus";
import { BotAvatar } from "../Avatar";
import { GlassHeader } from "../GlassScrollFrame";
import { Select } from "../Select";
import { PersonAvatar } from "../origin-pages/PersonAvatar";
import type { CloudPerson } from "../origin-pages/cloud-types";
import { errorText } from "../origin-pages/repo-url";
import { useCardDrag, type CardDrag } from "../origin-pages/use-card-drag";
import {
  CloudGate, EmptyState, Loading, Notice, PageHeader, Segmented, cardClass, ghostButton, glassHeaderRow, iconButton, inputClass, primaryButton, underGlass,
  type OriginPageProps,
} from "../origin-pages/ui";
import { CLOSED_STAGES, formatLeadValue, stageTotals, type PipelineBoard, type PipelineChannel, type PipelineLead } from "../../../shared/origin-pipeline";
import { nextActions, scoreLead, topOpenValue } from "../../../shared/origin-pipeline-score";
import { dueTone, inStage, matchesLead, orderForDrop, ownerKey, pipelineValue, planBrief, sequenceBrief, withPendingMoves, type LeadInsight, type PendingMove } from "./pipeline-model";
import { pipelineServer } from "./pipeline-api";
import { LeadDrawer } from "./LeadDrawer";
import { OwnerAvatar, type OwnerOption } from "./owners";
import { CaptureDialog, ImportDialog, NewLeadDialog, PendingContacts, PipelineSettingsDialog, PlanDialog } from "./PipelineDialogs";
import { NextActionChip, ScoreBadge } from "./LeadInsight";

export function PipelinePage({ agent, ...props }: OriginPageProps & { agent: Bot }) {
  return (
    <CloudGate {...props} label="Pipeline">
      {({ project, projectId, canEdit, isAdmin }) => <Pipeline projectId={projectId} projectName={project.name} canEdit={canEdit} isAdmin={isAdmin} chief={agent} />}
    </CloudGate>
  );
}

type Dialog = "new" | "import" | "capture" | "settings" | "plan" | null;

function useOwners(projectId: string, chief: Bot): OwnerOption[] {
  const people = useCloudQuery<CloudPerson[]>("members:people", { projectId });
  const { state } = useStore();
  return useMemo(() => {
    const team = chief.section?.trim();
    const agents = [chief, ...(team ? state.bots.filter((bot) => !bot.hidden && bot.id !== chief.id && bot.section?.trim() === team) : [])];
    return [
      ...(people ?? []).map((person): OwnerOption => ({ kind: "member", name: person.name || person.email, id: person.userId, avatar: <PersonAvatar person={person} size={18} /> })),
      ...agents.map((bot): OwnerOption => ({ kind: "agent", name: bot.name, id: bot.id, avatar: <BotAvatar bot={bot} size={18} /> })),
    ];
  }, [people, state.bots, chief]);
}

function Pipeline({ projectId, projectName, canEdit, isAdmin, chief }: { projectId: string; projectName: string; canEdit: boolean; isAdmin: boolean; chief: Bot }) {
  const board = useCloudQuery<PipelineBoard>("pipeline:board", { projectId });
  const owners = useOwners(projectId, chief);
  const { dispatch } = useStore();
  const showThreads = useShowThreads();
  const [layout, setLayout] = useState<"board" | "table">("board");
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [repliesOnly, setRepliesOnly] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const focus = useLeadFocus(projectId);
  useEffect(() => {
    if (!focus) return;
    setOpen(focus.leadId);
    consumeLeadFocus(focus);
  }, [focus]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [pending, setPending] = useState<ReadonlyMap<string, PendingMove>>(new Map());
  const [notice, setNotice] = useState("");
  const [channels, setChannels] = useState<Record<PipelineChannel, boolean> | null>(null);
  const lanesRef = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const dropped = useRef<(leadId: string, stage: string, beforeLeadId?: string) => void>(() => {});
  const cardDrag = useCardDrag({ enabled: canEdit, root: lanesRef, onDrop: (leadId, target) => dropped.current(leadId, target.columnId, target.beforeTaskId) });

  useEffect(() => {
    let live = true;
    void pipelineServer.channels().then((value) => { if (live) setChannels(value); }, () => { if (live) setChannels(null); });
    return () => { live = false; };
  }, [dialog]);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || target?.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return;
      if (event.key === "/") { event.preventDefault(); search.current?.focus(); }
      if (event.key === "n" && canEdit) { event.preventDefault(); setDialog("new"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canEdit]);

  if (!board) return <Loading label="Loading pipeline" variant="board" />;

  const leads = withPendingMoves(board.leads, pending);
  const visible = leads.filter((lead) => matchesLead(lead, query.trim()) && (!stageFilter || lead.stage === stageFilter) && (!ownerFilter || ownerKey(lead.owner) === ownerFilter)
    && (!repliesOnly || Boolean(lead.unreadReplies)));
  const totals = stageTotals(visible, board.stages);
  const value = pipelineValue(board.leads);
  const currency = board.settings.currency;
  const pendingLeads = new Set(board.pending.map((row) => row.leadId));
  const scoring = { stages: board.stages, topValue: topOpenValue(board.leads), currency, now: Date.now() };
  const insights = new Map<string, LeadInsight>(leads.map((lead) => {
    const context = { ...scoring, pending: pendingLeads.has(lead._id) };
    return [lead._id, { ...scoreLead(lead, context), actions: nextActions(lead, context) }];
  }));
  const unreadLeads = board.leads.filter((lead) => lead.unreadReplies).length;
  const stageCounts = new Map(board.stages.map((stage) => [stage, board.leads.filter((lead) => lead.stage === stage).length]));
  const report = (error: unknown) => setNotice(errorText(error, "Something went wrong"));

  const move = (leadId: string, stage: string, beforeLeadId?: string) => {
    const lead = leads.find((item) => item._id === leadId);
    if (!lead) return;
    if (lead.stage === stage) {
      const lane = inStage(leads, stage);
      if (lane[lane.findIndex((item) => item._id === leadId) + 1]?._id === beforeLeadId) return;
    }
    setPending((current) => new Map(current).set(leadId, { stage, order: orderForDrop(leads, leadId, stage, beforeLeadId) }));
    void cloudMutation("pipeline:moveLead", { projectId, leadId, stage, ...(beforeLeadId ? { beforeLeadId } : {}) })
      .catch(report)
      .finally(() => setPending((current) => { const next = new Map(current); next.delete(leadId); return next; }));
  };
  dropped.current = move;

  const keyMove = (event: KeyboardEvent<HTMLElement>, lead: PipelineLead) => {
    if (!canEdit || !event.altKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    event.preventDefault();
    const next = board.stages[board.stages.indexOf(lead.stage) + (event.key === "ArrowLeft" ? -1 : 1)];
    if (next) move(lead._id, next, inStage(leads, next)[0]?._id);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-task-id="${lead._id}"]`)?.focus());
  };

  const planLeads = selected.size ? visible.filter((lead) => selected.has(lead._id)) : visible.filter((lead) => !CLOSED_STAGES.includes(lead.stage));
  const handOff = (text: string) => {
    dispatch({ type: "send", botId: chief.id, text });
    setDialog(null);
    setChiefSectionOf(chief.id, "chat");
    openBot(dispatch, chief, showThreads);
  };
  const planFor = (list: readonly PipelineLead[], direction = "") => planBrief({ projectName, leads: list, currency, direction });
  const ownerOptions = owners.map((owner) => ({ value: ownerKey(owner), label: owner.name }));

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden motion-safe:animate-[rise_var(--motion-base)_var(--ease-out)_backwards]" aria-label="Pipeline">
      <PageHeader title="Pipeline" count={<span title="Open pipeline value · won">{formatLeadValue(value.open, currency)} open{value.won ? ` · ${formatLeadValue(value.won, currency)} won` : ""}</span>}>
        <Segmented label="Layout" value={layout} onChange={setLayout}
          options={[{ value: "board", label: <Columns3 size={14} aria-label="Board" />, title: "Board" }, { value: "table", label: <List size={14} aria-label="Table" />, title: "Table" }]} />
        <label className="relative flex min-w-32 flex-1 items-center sm:flex-none">
          <Search size={14} className="pointer-events-none absolute left-2.5 text-ink-tertiary" aria-hidden="true" />
          <input ref={search} className={cn(inputClass, "h-8 pl-8 sm:w-44")} placeholder="Search leads" aria-label="Search leads" value={query} onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Escape") { setQuery(""); event.currentTarget.blur(); } }} />
        </label>
        {layout === "table" && (
          <Select size="sm" aria-label="Stage" value={stageFilter} onChange={(event) => setStageFilter(event.target.value)}>
            <option value="">All stages</option>
            {board.stages.map((stage) => <option key={stage} value={stage}>{stage}</option>)}
          </Select>
        )}
        <div className="max-sm:hidden">
          <Select size="sm" aria-label="Owner" value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)}>
            <option value="">Everyone</option>
            {ownerOptions.map((owner) => <option key={owner.value} value={owner.value}>{owner.label}</option>)}
          </Select>
        </div>
        {(unreadLeads > 0 || repliesOnly) && (
          <button type="button" aria-pressed={repliesOnly} onClick={() => setRepliesOnly((value) => !value)} title={repliesOnly ? "Show every lead" : "Show leads with unread replies"}
            className={cn(ghostButton, "h-8 rounded-full px-2.5", repliesOnly && "border-accent/50 bg-accent/10 text-accent-text hover:bg-accent/15")}>
            <Reply size={14} />Replies{unreadLeads > 0 && <span className="rounded-full bg-accent px-1.5 text-[11px] font-semibold tabular-nums text-accent-ink">{unreadLeads}</span>}
          </button>
        )}
        <div className="flex items-center">
          <button type="button" className={iconButton} title="Lead capture" aria-label="Lead capture" onClick={() => setDialog("capture")}><Inbox size={16} /></button>
          {canEdit && <button type="button" className={iconButton} title="Import CSV" aria-label="Import CSV" onClick={() => setDialog("import")}><Upload size={16} /></button>}
          <button type="button" className={iconButton} title="Pipeline settings" aria-label="Pipeline settings" onClick={() => setDialog("settings")}><SlidersHorizontal size={16} /></button>
        </div>
        <button type="button" className={ghostButton} disabled={!planLeads.length} onClick={() => setDialog("plan")} title={`Ask ${chief.name} for an outreach plan`}>
          <Sparkles size={14} />Plan{selected.size ? ` (${selected.size})` : ""}
        </button>
        {canEdit && <button type="button" className={primaryButton} onClick={() => setDialog("new")} title="New lead (N)"><Plus size={14} />New lead</button>}
      </PageHeader>
      {(!canEdit || notice || board.pending.length > 0) && (
        <GlassHeader>
          <div className={cn("flex flex-col gap-2", glassHeaderRow)}>
            {!canEdit && <Notice>You have view-only access to this project.</Notice>}
            {notice && <Notice tone="danger">{notice}</Notice>}
            {board.pending.length > 0 && <PendingContacts projectId={projectId} pending={board.pending} canEdit={canEdit} botId={chief.id} onOpen={setOpen} onError={setNotice} />}
          </div>
        </GlassHeader>
      )}

      {!board.leads.length ? (
        <div className={cn("flex min-h-0 flex-1 flex-col px-4 md:px-6", underGlass)}>
          <EmptyState icon={<Target size={22} />} title="No leads yet" body={canEdit ? "Add the people you want to win, import a CSV, or turn on lead capture so your landing page fills this in." : undefined}
            action={canEdit ? (
              <div className="flex flex-wrap justify-center gap-2">
                <button type="button" className={primaryButton} onClick={() => setDialog("new")}><Plus size={14} />New lead</button>
                <button type="button" className={ghostButton} onClick={() => setDialog("import")}><Upload size={14} />Import CSV</button>
                <button type="button" className={ghostButton} onClick={() => setDialog("capture")}><Inbox size={14} />Lead capture</button>
              </div>
            ) : undefined} />
        </div>
      ) : layout === "table" ? (
        <LeadTable leads={visible} stages={board.stages} currency={currency} canEdit={canEdit} selected={selected} pendingLeads={pendingLeads} insights={insights}
          onSelect={setSelected} onOpen={setOpen} onStage={(lead, stage) => move(lead._id, stage)} />
      ) : (
        <div ref={lanesRef} className={cn("flex min-h-0 flex-1 snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-4 md:scroll-px-6 md:px-6", underGlass)}>
          {board.stages.map((stage) => {
            const items = inStage(visible, stage);
            const here = cardDrag.target?.columnId === stage ? cardDrag.target : null;
            const lifted = cardDrag.drag;
            const total = totals.get(stage) ?? { count: 0, value: 0 };
            const closed = CLOSED_STAGES.includes(stage);
            return (
              <div key={stage} data-column-id={stage}
                className={cn("flex w-[min(17.5rem,85vw)] shrink-0 snap-start flex-col rounded-2xl p-2 transition-[background-color] duration-(--motion-fast)", closed ? "bg-inset/25" : "bg-inset/50", lifted && "bg-inset/70", here && "bg-inset/90")}>
                <div className="flex items-baseline gap-2 px-2 pb-2 pt-1">
                  <span aria-hidden="true" className={cn("size-2 shrink-0 self-center rounded-full", stage === "Won" ? "bg-success" : stage === "Lost" ? "bg-ink-tertiary/60" : "bg-accent")}
                    style={closed ? undefined : { opacity: 0.35 + (board.stages.indexOf(stage) / Math.max(1, board.stages.length - 3)) * 0.65 }} />
                  <strong className={cn("truncate text-[13px] font-semibold", closed ? "text-ink-secondary" : "text-ink")}>{stage}</strong>
                  <span className="text-[12px] tabular-nums text-ink-tertiary">{total.count}</span>
                  {total.value > 0 && <span className="ml-auto text-[12px] tabular-nums text-ink-secondary">{formatLeadValue(total.value, currency)}</span>}
                </div>
                <ol data-lane-list className="flex min-h-[3rem] flex-1 flex-col gap-2 overflow-y-auto p-0.5" aria-label={`${stage} leads`}>
                  {items.map((lead) => lifted?.taskId === lead._id ? null : (
                    <li key={lead._id} className="flex flex-col gap-2">
                      {here?.beforeTaskId === lead._id && lifted && <DropGap height={lifted.height} />}
                      <LeadCard lead={lead} currency={currency} canEdit={canEdit} awaiting={pendingLeads.has(lead._id)} owners={owners} insight={insights.get(lead._id)}
                        onOpen={() => { if (!cardDrag.justDropped()) setOpen(lead._id); }}
                        onPointerDown={(event) => cardDrag.press(event, lead._id)} onKeyDown={(event) => keyMove(event, lead)} />
                    </li>
                  ))}
                  {here && !here.beforeTaskId && lifted && <li><DropGap height={lifted.height} /></li>}
                  {!items.some((lead) => lead._id !== lifted?.taskId) && !here && (
                    <li className="rounded-xl border border-dashed border-hairline/50 px-3 py-5 text-center text-[12.5px] text-ink-tertiary">
                      {query || ownerFilter || repliesOnly ? "No matching leads" : canEdit ? "Drop leads here" : "No leads"}
                    </li>
                  )}
                </ol>
              </div>
            );
          })}
          {cardDrag.drag && <DragGhost drag={cardDrag.drag} ghost={cardDrag.ghost} lead={leads.find((lead) => lead._id === cardDrag.drag!.taskId)} currency={currency} owners={owners} />}
        </div>
      )}

      {open && <LeadDrawer key={open} projectId={projectId} projectName={projectName} leadId={open} stages={board.stages} currency={currency} canEdit={canEdit}
        owners={owners} chief={chief} channels={channels} settings={board.settings} insight={insights.get(open)} onClose={() => setOpen(null)} onPlan={(lead) => handOff(planFor([lead]))}
        onSequence={(lead) => handOff(sequenceBrief({ projectName, lead, currency }))} />}
      {dialog === "new" && <NewLeadDialog projectId={projectId} stages={board.stages} onClose={() => setDialog(null)} onCreated={(leadId) => { setDialog(null); setOpen(leadId); }} />}
      {dialog === "import" && <ImportDialog projectId={projectId} onClose={() => setDialog(null)} />}
      {dialog === "capture" && <CaptureDialog projectId={projectId} settings={board.settings} canEdit={canEdit} onClose={() => setDialog(null)} />}
      {dialog === "settings" && <PipelineSettingsDialog projectId={projectId} settings={board.settings} stages={board.stages} counts={stageCounts} canEdit={canEdit} isAdmin={isAdmin} channels={channels} onClose={() => setDialog(null)} />}
      {dialog === "plan" && <PlanDialog chief={chief} leads={planLeads} selected={selected.size > 0} onClose={() => setDialog(null)} onSend={(direction) => handOff(planFor(planLeads, direction))} />}
    </section>
  );
}

function DropGap({ height }: { height: number }) {
  return <span aria-hidden="true" className="block rounded-xl border-2 border-dashed border-accent/45 bg-accent/[0.06] motion-safe:animate-[pop-in_var(--motion-base)_var(--ease-out)]" style={{ height }} />;
}

function DragGhost({ drag, ghost, lead, currency, owners }: { drag: CardDrag; ghost: RefObject<HTMLDivElement | null>; lead?: PipelineLead; currency: string; owners: readonly OwnerOption[] }) {
  if (!lead) return null;
  return (
    <div ref={ghost} aria-hidden="true" className="pointer-events-none fixed left-0 top-0 z-[60]" style={{ width: drag.width, transform: `translate3d(${drag.x}px, ${drag.y}px, 0)` }}>
      <div className="rotate-[1.5deg] scale-[1.03] motion-safe:animate-[pop-in_var(--motion-fast)_var(--ease-out)]">
        <LeadCard lead={lead} currency={currency} canEdit={false} awaiting={false} owners={owners} lifted />
      </div>
    </div>
  );
}

function LeadCard({ lead, currency, canEdit, awaiting, owners, insight, lifted = false, onOpen, onPointerDown, onKeyDown }: {
  lead: PipelineLead; currency: string; canEdit: boolean; awaiting: boolean; owners: readonly OwnerOption[]; insight?: LeadInsight; lifted?: boolean;
  onOpen?(): void; onPointerDown?(event: PointerEvent<HTMLElement>): void; onKeyDown?(event: KeyboardEvent<HTMLElement>): void;
}) {
  const due = dueTone(lead.nextDue);
  const hint = insight?.actions.find((item) => item.kind !== "reply" && item.kind !== "approve" && item.kind !== "overdue");
  return (
    <article tabIndex={lifted ? -1 : 0} data-task-id={lifted ? undefined : lead._id} aria-label={`${lead.name}${lead.company ? `, ${lead.company}` : ""}`}
      aria-keyshortcuts={canEdit ? "Alt+ArrowLeft Alt+ArrowRight" : undefined}
      onPointerDown={onPointerDown} onClick={onOpen}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen?.(); return; }
        onKeyDown?.(event);
      }}
      className={cn("group relative cursor-pointer rounded-xl border border-hairline/40 bg-panel px-3 py-2.5 outline-none transition-[border-color,background-color] duration-(--motion-fast) hover:border-hairline hover:bg-raised/40 focus-visible:ring-2 focus-visible:ring-accent/60",
        canEdit && "cursor-grab select-none active:cursor-grabbing", lifted && "cursor-grabbing border-hairline")}>
      <div className="flex items-start gap-2">
        {canEdit && <GripVertical size={12} className="absolute left-0 top-[13px] text-ink-tertiary opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 touch:opacity-100 max-md:hidden" aria-hidden="true" />}
        <div className="min-w-0 flex-1">
          <strong className="flex min-w-0 items-center gap-1.5 text-[13.5px] font-medium leading-snug text-ink">
            <span className="truncate">{lead.name}</span>
            {lead.unreadReplies ? <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-accent px-1.5 text-[10.5px] font-semibold text-accent-ink" title={`${lead.unreadReplies} unread ${lead.unreadReplies === 1 ? "reply" : "replies"}`}>
              <Reply size={10} aria-hidden="true" />{lead.unreadReplies}<span className="sr-only"> unread {lead.unreadReplies === 1 ? "reply" : "replies"}</span></span> : null}
          </strong>
          {lead.company && <span className="block truncate text-[12px] text-ink-secondary">{lead.company}</span>}
        </div>
        {lead.value ? <span className="shrink-0 text-[12.5px] font-medium tabular-nums text-ink">{formatLeadValue(lead.value, currency)}</span> : null}
      </div>
      {lead.nextStep && <p className="mt-1.5 line-clamp-2 text-[12px] leading-snug text-ink-secondary">{lead.nextStep}</p>}
      <div className="mt-2 flex min-w-0 items-center gap-2 text-[11.5px] text-ink-tertiary">
        {lead.email && <Mail size={12} aria-label="Has email" />}
        {lead.phone && <Phone size={12} aria-label="Has phone" />}
        {due && <span className={cn("flex items-center gap-1", due.tone === "late" ? "text-danger" : due.tone === "soon" ? "text-warning" : "text-ink-secondary")}><CalendarDays size={11} aria-hidden="true" />{due.label}</span>}
        {awaiting && <span className="rounded-full bg-accent/15 px-1.5 py-px text-[11px] text-accent-text">Needs approval</span>}
        {!awaiting && hint && <NextActionChip action={hint} />}
        {lead.tags.slice(0, 2).map((tag) => <span key={tag} className="truncate rounded-full border border-hairline/50 px-1.5 py-px text-[11px]">{tag}</span>)}
        <span className="ml-auto"><OwnerAvatar owner={lead.owner} owners={owners} /></span>
      </div>
    </article>
  );
}

function LeadTable({ leads, stages, currency, canEdit, selected, pendingLeads, insights, onSelect, onOpen, onStage }: {
  leads: readonly PipelineLead[]; stages: readonly string[]; currency: string; canEdit: boolean; selected: ReadonlySet<string>; pendingLeads: ReadonlySet<string>; insights: ReadonlyMap<string, LeadInsight>;
  onSelect(next: ReadonlySet<string>): void; onOpen(leadId: string): void; onStage(lead: PipelineLead, stage: string): void;
}) {
  const [sort, setSort] = useState<{ key: "name" | "stage" | "value" | "due" | "activity" | "score"; desc: boolean }>({ key: "activity", desc: true });
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
  const header = (key: typeof sort.key, label: string, className = "") => (
    <th scope="col" className={cn("px-2 py-2 font-medium", className)} aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : undefined}>
      <button type="button" className="rounded hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent/60" onClick={() => setSort((current) => ({ key, desc: current.key === key ? !current.desc : key !== "name" }))}>
        {label}{sort.key === key ? (sort.desc ? " ↓" : " ↑") : ""}
      </button>
    </th>
  );
  if (!leads.length) return <div className={cn("px-4 md:px-6", underGlass)}><EmptyState compact icon={<Search size={22} />} title="No matching leads" body="Try another search or filter." /></div>;
  return (
    <div className={cn("min-h-0 flex-1 overflow-auto px-4 pb-6 md:px-6", underGlass)}>
      <div className={cn(cardClass, "overflow-x-auto")}>
        <table className="w-full min-w-[920px] border-collapse text-left text-[13px]">
          <thead className="border-b border-hairline/40 text-[12px] text-ink-tertiary">
            <tr>
              <th scope="col" className="w-9 px-3 py-2">
                <input type="checkbox" aria-label="Select all leads" checked={all} className="accent-[var(--color-accent)]"
                  onChange={() => onSelect(all ? new Set() : new Set(leads.map((lead) => lead._id)))} />
              </th>
              {header("name", "Lead")}
              {header("stage", "Stage")}
              {header("value", "Value", "text-right")}
              {header("score", "Score", "text-right")}
              <th scope="col" className="px-2 py-2 font-medium">Next</th>
              <th scope="col" className="px-2 py-2 font-medium">Contact</th>
              <th scope="col" className="px-2 py-2 font-medium">Next step</th>
              {header("due", "Due")}
              <th scope="col" className="px-2 py-2 font-medium">Source</th>
              {header("activity", "Last touch")}
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline/30">
            {sorted.map((lead) => {
              const due = dueTone(lead.nextDue);
              const touched = lead.lastActivityAt ?? lead.createdAt;
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
                  <td className="max-w-[220px] truncate px-2 py-1.5 text-ink-secondary">{lead.nextStep ?? ""}</td>
                  <td className={cn("whitespace-nowrap px-2 py-1.5 text-[12px]", due?.tone === "late" ? "text-danger" : due?.tone === "soon" ? "text-warning" : "text-ink-secondary")}>{due?.label ?? ""}</td>
                  <td className="max-w-[120px] truncate px-2 py-1.5 text-[12px] text-ink-tertiary">{lead.source}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-[12px] text-ink-tertiary">{new Date(touched).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
