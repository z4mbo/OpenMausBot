import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from "react";
import { CalendarDays, CircleDollarSign, Columns3, GripVertical, Inbox, Mail, MessagesSquare, Phone, Plus, Reply, Search, SlidersHorizontal, Sparkles, Target, Upload, Users } from "lucide-react";
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
  CloudGate, EmptyState, Loading, Notice, PageHeader, Segmented, ghostButton, glassHeaderRow, iconButton, inputClass, primaryButton, underGlass,
  type OriginPageProps,
} from "../origin-pages/ui";
import { CLOSED_STAGES, formatLeadValue, stageTotals, type PipelineBoard, type PipelineChannel, type PipelineLead } from "../../../shared/origin-pipeline";
import { nextActions, scoreLead, topOpenValue } from "../../../shared/origin-pipeline-score";
import { dueTone, inStage, matchesLead, orderForDrop, ownerKey, pipelineValue, planBrief, sequenceBrief, withPendingMoves, type LeadInsight, type PendingMove } from "./pipeline-model";
import { pipelineServer } from "./pipeline-api";
import { LeadDrawer, type DrawerTab } from "./LeadDrawer";
import { OwnerAvatar, type OwnerOption } from "./owners";
import { CaptureDialog, ImportDialog, NewLeadDialog, PendingContacts, PipelineSettingsDialog, PlanDialog, type SettingsTab } from "./PipelineDialogs";
import { NextActionChip } from "./LeadInsight";
import { ContactsView } from "./ContactsView";
import { InboxView } from "./InboxView";
import { DealsView } from "./DealsView";
import { NewDealDialog } from "./SalesDialogs";

export function PipelinePage({ agent, ...props }: OriginPageProps & { agent: Bot }) {
  return (
    <CloudGate {...props} label="Sales">
      {({ project, projectId, canEdit, isAdmin }) => <Pipeline projectId={projectId} projectName={project.name} canEdit={canEdit} isAdmin={isAdmin} chief={agent} />}
    </CloudGate>
  );
}

type Dialog = "new" | "import" | "capture" | "settings" | "plan" | "deal" | null;
type View = "inbox" | "contacts" | "board" | "deals";
const VIEW_KEY = "origin.sales.view";
const VIEWS: readonly View[] = ["inbox", "contacts", "board", "deals"];

function rememberedView(): View {
  try {
    const saved = localStorage.getItem(VIEW_KEY);
    return VIEWS.includes(saved as View) ? saved as View : "inbox";
  } catch { return "inbox"; }
}

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
  const [view, setViewState] = useState<View>(rememberedView);
  const [query, setQuery] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [repliesOnly, setRepliesOnly] = useState(false);
  const [open, setOpen] = useState<{ leadId: string; tab: DrawerTab } | null>(null);
  const focus = useLeadFocus(projectId);
  useEffect(() => {
    if (!focus) return;
    setOpen({ leadId: focus.leadId, tab: "conversation" });
    consumeLeadFocus(focus);
  }, [focus]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const [pending, setPending] = useState<ReadonlyMap<string, PendingMove>>(new Map());
  const [notice, setNotice] = useState("");
  const [connections, setConnections] = useState<{ channels: Record<PipelineChannel, boolean>; stripe: boolean } | null>(null);
  const lanesRef = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const dropped = useRef<(leadId: string, stage: string, beforeLeadId?: string) => void>(() => {});
  const cardDrag = useCardDrag({ enabled: canEdit && view === "board", root: lanesRef, onDrop: (leadId, target) => dropped.current(leadId, target.columnId, target.beforeTaskId) });
  const setView = (next: View) => {
    setViewState(next);
    try { localStorage.setItem(VIEW_KEY, next); } catch { return; }
  };

  useEffect(() => {
    let live = true;
    void pipelineServer.connections().then((value) => { if (live) setConnections(value); }, () => { if (live) setConnections(null); });
    return () => { live = false; };
  }, [dialog]);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || target?.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return;
      if (event.key === "/" && search.current) { event.preventDefault(); search.current.focus(); }
      if (event.key === "n" && canEdit) { event.preventDefault(); setDialog("new"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canEdit]);

  if (!board) return <Loading label="Loading sales" variant="board" />;

  const channels = connections?.channels ?? null;
  const leads = withPendingMoves(board.leads, pending);
  const visible = leads.filter((lead) => matchesLead(lead, query.trim()) && (!ownerFilter || ownerKey(lead.owner) === ownerFilter) && (!repliesOnly || Boolean(lead.unreadReplies)));
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
  const openLead = (leadId: string, tab: DrawerTab = "conversation") => setOpen({ leadId, tab });
  const openSettings = (tab: SettingsTab) => { setSettingsTab(tab); setDialog("settings"); };

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

  const planLeads = visible.filter((lead) => !CLOSED_STAGES.includes(lead.stage));
  const handOff = (text: string) => {
    dispatch({ type: "send", botId: chief.id, text });
    setDialog(null);
    setChiefSectionOf(chief.id, "chat");
    openBot(dispatch, chief, showThreads);
  };
  const planFor = (list: readonly PipelineLead[], direction = "") => planBrief({ projectName, leads: list, currency, direction });
  const ownerOptions = owners.map((owner) => ({ value: ownerKey(owner), label: owner.name }));
  const viewLabel = (icon: ReactNode, label: string, badge?: number) => (
    <span className="flex items-center gap-1.5">{icon}<span className="max-[420px]:sr-only">{label}</span>
      {badge ? <span className="rounded-full bg-accent px-1.5 text-[10.5px] font-semibold tabular-nums text-accent-ink">{badge}</span> : null}</span>
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden motion-safe:animate-[rise_var(--motion-base)_var(--ease-out)_backwards]" aria-label="Sales">
      <PageHeader title="Sales" count={<span title="Open value · won">{formatLeadValue(value.open, currency)} open{value.won ? ` · ${formatLeadValue(value.won, currency)} won` : ""}</span>}>
        <Segmented label="Sales view" value={view} onChange={setView} options={[
          { value: "inbox", label: viewLabel(<MessagesSquare size={14} aria-hidden="true" />, "Inbox", unreadLeads), title: "Conversations" },
          { value: "contacts", label: viewLabel(<Users size={14} aria-hidden="true" />, "Contacts"), title: "Every contact" },
          { value: "board", label: viewLabel(<Columns3 size={14} aria-hidden="true" />, "Pipeline"), title: "Contacts by stage" },
          { value: "deals", label: viewLabel(<CircleDollarSign size={14} aria-hidden="true" />, "Deals"), title: "Deals and revenue" },
        ]} />
        {view === "board" && <>
          <label className="relative flex min-w-32 flex-1 items-center sm:flex-none">
            <Search size={14} className="pointer-events-none absolute left-2.5 text-ink-tertiary" aria-hidden="true" />
            <input ref={search} className={cn(inputClass, "h-8 pl-8 sm:w-44")} placeholder="Search leads" aria-label="Search leads" value={query} onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Escape") { setQuery(""); event.currentTarget.blur(); } }} />
          </label>
          <div className="max-sm:hidden">
            <Select size="sm" aria-label="Owner" value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)}>
              <option value="">Everyone</option>
              {ownerOptions.map((owner) => <option key={owner.value} value={owner.value}>{owner.label}</option>)}
            </Select>
          </div>
          {(unreadLeads > 0 || repliesOnly) && (
            <button type="button" aria-pressed={repliesOnly} onClick={() => setRepliesOnly((current) => !current)} title={repliesOnly ? "Show every lead" : "Show leads with unread replies"}
              className={cn(ghostButton, "h-8 rounded-full px-2.5", repliesOnly && "border-accent/50 bg-accent/10 text-accent-text hover:bg-accent/15")}>
              <Reply size={14} />Replies{unreadLeads > 0 && <span className="rounded-full bg-accent px-1.5 text-[11px] font-semibold tabular-nums text-accent-ink">{unreadLeads}</span>}
            </button>
          )}
        </>}
        <div className="flex items-center sm:ml-auto">
          <button type="button" className={iconButton} title="Capture from pages and apps" aria-label="Lead capture" onClick={() => setDialog("capture")}><Inbox size={16} /></button>
          {canEdit && <button type="button" className={iconButton} title="Import CSV" aria-label="Import CSV" onClick={() => setDialog("import")}><Upload size={16} /></button>}
          <button type="button" className={iconButton} title="Sales settings" aria-label="Sales settings" onClick={() => openSettings("general")}><SlidersHorizontal size={16} /></button>
        </div>
        {view === "board" && (
          <button type="button" className={ghostButton} disabled={!planLeads.length} onClick={() => setDialog("plan")} title={`Ask ${chief.name} for an outreach plan`}>
            <Sparkles size={14} />Plan
          </button>
        )}
        {canEdit && <button type="button" className={primaryButton} onClick={() => setDialog("new")} title="New contact (N)"><Plus size={14} /><span className="max-[420px]:sr-only">New contact</span></button>}
      </PageHeader>
      {(!canEdit || notice || (board.pending.length > 0 && view !== "inbox")) && (
        <GlassHeader>
          <div className={cn("flex flex-col gap-2", glassHeaderRow)}>
            {!canEdit && <Notice>You have view-only access to this project.</Notice>}
            {notice && <Notice tone="danger">{notice}</Notice>}
            {board.pending.length > 0 && view !== "inbox" && <PendingContacts projectId={projectId} pending={board.pending} canEdit={canEdit} botId={chief.id} onOpen={(leadId) => openLead(leadId)} onError={setNotice} />}
          </div>
        </GlassHeader>
      )}

      {view === "inbox" ? (
        <InboxView projectId={projectId} projectName={projectName} canEdit={canEdit} chief={chief} channels={channels} onOpenContact={(leadId) => openLead(leadId, "deals")} onSetUp={() => openSettings("inbound")} />
      ) : view === "contacts" ? (
        <ContactsView projectId={projectId} leads={leads} stages={board.stages} currency={currency} canEdit={canEdit} owners={owners} insights={insights} pendingLeads={pendingLeads}
          onOpen={(leadId) => openLead(leadId)} onStage={(lead, stage) => move(lead._id, stage)} onCapture={() => setDialog("capture")} onImport={() => setDialog("import")} onNew={() => setDialog("new")} />
      ) : view === "deals" ? (
        <DealsView projectId={projectId} canEdit={canEdit} hasContacts={board.leads.length > 0} onOpen={(leadId) => openLead(leadId, "deals")} onNew={() => setDialog("deal")} />
      ) : !board.leads.length ? (
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
                        onOpen={() => { if (!cardDrag.justDropped()) openLead(lead._id); }}
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

      {open && <LeadDrawer key={open.leadId} projectId={projectId} projectName={projectName} leadId={open.leadId} initialTab={open.tab} stages={board.stages} currency={currency} canEdit={canEdit}
        owners={owners} chief={chief} channels={channels} stripe={connections?.stripe ?? false} settings={board.settings} insight={insights.get(open.leadId)} onClose={() => setOpen(null)}
        onPlan={(lead) => handOff(planFor([lead]))} onSequence={(lead) => handOff(sequenceBrief({ projectName, lead, currency }))} />}
      {dialog === "new" && <NewLeadDialog projectId={projectId} stages={board.stages} onClose={() => setDialog(null)} onCreated={(leadId) => { setDialog(null); openLead(leadId, "activity"); }} />}
      {dialog === "import" && <ImportDialog projectId={projectId} onClose={() => setDialog(null)} />}
      {dialog === "capture" && <CaptureDialog projectId={projectId} settings={board.settings} canEdit={canEdit} onClose={() => setDialog(null)} />}
      {dialog === "settings" && <PipelineSettingsDialog projectId={projectId} settings={board.settings} stages={board.stages} counts={stageCounts} canEdit={canEdit} isAdmin={isAdmin} channels={channels}
        stripe={connections?.stripe ?? null} initialTab={settingsTab} onClose={() => setDialog(null)} />}
      {dialog === "plan" && <PlanDialog chief={chief} leads={planLeads} selected={false} onClose={() => setDialog(null)} onSend={(direction) => handOff(planFor(planLeads, direction))} />}
      {dialog === "deal" && <NewDealDialog projectId={projectId} leads={board.leads} onClose={() => setDialog(null)} onCreated={(leadId) => { setDialog(null); openLead(leadId, "deals"); }} />}
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
