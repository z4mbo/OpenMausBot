import { useEffect, useRef, useState } from "react";
import { ArrowLeft, BellOff, Inbox, MessagesSquare, Search, UserRound } from "lucide-react";
import type { Bot } from "@/state/store";
import { cloudMutation, useCloudQuery } from "@/lib/origin-cloud";
import { cn } from "@/lib/cn";
import { EmptyState, Loading, Notice, Segmented, ghostButton, inputClass, underGlass } from "../origin-pages/ui";
import { errorText } from "../origin-pages/repo-url";
import type { PipelineActivity, PipelineActor, PipelineChannel, PipelineLead } from "../../../shared/origin-pipeline";
import type { InboxFolder, InboxThread, SalesDeal } from "../../../shared/origin-sales";
import { KIND_ICON, ago } from "./activity-labels";
import { Conversation } from "./Conversation";
import { WonRequestBanner } from "./DealPanel";
import { ConversationActions, Kbd } from "./InboxActions";
import { useInboxPages } from "./inbox-pages";
import { OwnerAvatar, type OwnerOption } from "./owners";

type Filter = "unread" | "approval";

const FOLDERS: { value: InboxFolder; label: string }[] = [{ value: "open", label: "Open" }, { value: "snoozed", label: "Snoozed" }, { value: "archived", label: "Archived" }];
const typing = (target: EventTarget | null) => Boolean((target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable=true], [role=dialog], [role=menu]"));

export function InboxView({ projectId, projectName, canEdit, chief, channels, owners, onOpenContact, onSetUp }: {
  projectId: string; projectName: string; canEdit: boolean; chief: Bot; channels: Record<PipelineChannel, boolean> | null; owners: readonly OwnerOption[];
  onOpenContact(leadId: string): void; onSetUp(): void;
}) {
  const [folder, setFolder] = useState<InboxFolder>("open");
  const pages = useInboxPages(projectId, folder);
  const [filter, setFilter] = useState<Filter | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [moved, setMoved] = useState<ReadonlySet<string>>(new Set());
  const [snoozing, setSnoozing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const list = useRef<HTMLUListElement>(null);
  const more = useRef<HTMLLIElement>(null);
  const [wide, setWide] = useState(() => typeof window === "undefined" || window.matchMedia("(min-width: 768px)").matches);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const change = () => setWide(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => { setMoved(new Set()); setSelected(null); }, [folder]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4_000);
    return () => clearTimeout(timer);
  }, [notice]);

  const threads = pages.threads;
  const needle = query.trim().toLowerCase();
  const shown = (threads ?? []).filter((row) => !moved.has(row.leadId)
    && (!filter || (filter === "unread" ? row.unread > 0 : row.pending > 0 || row.wonRequest))
    && (!needle || `${row.name} ${row.company ?? ""} ${row.last?.preview ?? ""}`.toLowerCase().includes(needle)));
  const active = selected && shown.some((row) => row.leadId === selected) ? selected : wide ? shown[0]?.leadId ?? null : null;
  const current = shown.find((row) => row.leadId === active);

  useEffect(() => {
    const sentinel = more.current;
    if (!sentinel || pages.isDone) return;
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) pages.loadMore(); }, { root: list.current, rootMargin: "240px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [pages, shown.length]);

  const move = async (state: InboxFolder, until?: number) => {
    if (!current || !canEdit) return;
    const index = shown.findIndex((row) => row.leadId === current.leadId);
    const next = shown[index + 1] ?? shown[index - 1];
    setBusy(true);
    setNotice("");
    try {
      await cloudMutation("pipelineInbox:setState", { projectId, leadIds: [current.leadId], state, ...(until ? { until } : {}) });
      setMoved((set) => new Set(set).add(current.leadId));
      setSelected(next?.leadId ?? null);
      setNotice(state === "archived" ? `Archived ${current.name}.` : state === "snoozed" ? `Snoozed ${current.name} until ${new Date(until!).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}.` : `Moved ${current.name} to the inbox.`);
    } catch (error) {
      setNotice(errorText(error, "Could not move the conversation"));
    } finally { setBusy(false); }
  };
  const assign = (owner: PipelineActor | null) => {
    if (!current) return;
    setBusy(true);
    void cloudMutation("pipelineContacts:bulkUpdate", { projectId, leadIds: [current.leadId], owner: owner ? { kind: owner.kind, name: owner.name, ...(owner.id ? { id: owner.id } : {}) } : null })
      .then(() => setNotice(owner ? `Assigned ${current.name} to ${owner.name}.` : `${current.name} is unassigned.`), (error) => setNotice(errorText(error, "Could not assign the conversation")))
      .finally(() => setBusy(false));
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) return;
      const index = shown.findIndex((row) => row.leadId === active);
      const go = (to: number) => {
        const row = shown[Math.max(0, Math.min(shown.length - 1, to))];
        if (!row) return;
        setSelected(row.leadId);
        list.current?.querySelector<HTMLElement>(`[data-lead-id="${row.leadId}"]`)?.scrollIntoView({ block: "nearest" });
      };
      const handled = event.key === "j" ? (go(index + 1), true)
        : event.key === "k" ? (go(index < 0 ? 0 : index - 1), true)
        : event.key === "e" && canEdit && current ? (void move(folder === "open" ? "archived" : "open"), true)
        : event.key === "s" && canEdit && current && folder !== "snoozed" ? (setSnoozing(true), true)
        : event.key === "r" && canEdit && current ? (document.querySelector<HTMLTextAreaElement>("form[aria-label=Reply] textarea")?.focus(), true)
        : event.key === "Escape" && !wide && selected ? (setSelected(null), true) : false;
      if (handled) event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!threads) return <>{pages.queries}<Loading label="Loading conversations" variant="chat" /></>;

  if (!threads.length && folder === "open" && !moved.size) {
    return (
      <div className={cn("flex min-h-0 flex-1 flex-col px-4 md:px-6", underGlass)}>
        {pages.queries}
        <EmptyState icon={<MessagesSquare size={22} />} title="No conversations yet"
          body="Emails, texts, WhatsApp messages and calls with your contacts gather here."
          action={<div className="flex flex-wrap justify-center gap-2">
            <button type="button" className={ghostButton} onClick={onSetUp}><Inbox size={14} />Set up replies</button>
            <button type="button" className={ghostButton} onClick={() => setFolder("archived")}>Archived</button>
          </div>} />
      </div>
    );
  }

  const unread = threads.filter((row) => row.unread > 0).length;
  const waiting = threads.filter((row) => row.pending > 0 || row.wonRequest).length;
  const toggle = (value: Filter) => setFilter((now) => (now === value ? null : value));
  const chip = (value: Filter, label: string, count: number) => (
    <button type="button" aria-pressed={filter === value} onClick={() => toggle(value)}
      className={cn("inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
        filter === value ? "border-accent/50 bg-accent/10 text-accent-text" : "border-hairline/50 text-ink-secondary hover:bg-raised/60 hover:text-ink")}>
      {label}{count > 0 && <span className="tabular-nums text-ink-tertiary">{count}</span>}
    </button>
  );

  return (
    <div className={cn("flex min-h-0 flex-1 gap-4 px-4 pb-4 md:px-6", underGlass)}>
      {pages.queries}
      {(wide || !active) && (
        <aside className="flex min-h-0 w-full flex-col gap-2 md:w-[320px] md:shrink-0" aria-label="Conversations">
          <Segmented label="Folder" value={folder} onChange={setFolder} options={FOLDERS} />
          <div className="flex items-center gap-1.5">
            <label className="relative flex min-w-0 flex-1 items-center">
              <Search size={14} className="pointer-events-none absolute left-2.5 text-ink-tertiary" aria-hidden="true" />
              <input className={cn(inputClass, "h-8 pl-8")} placeholder="Search" aria-label="Search conversations" value={query} onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Escape") { setQuery(""); event.currentTarget.blur(); } }} />
            </label>
            {chip("unread", "Unread", unread)}
            {chip("approval", "To approve", waiting)}
          </div>
          <ul ref={list} className="-mx-1 flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-1 pb-1">
            {!shown.length && <li className="px-2 py-10 text-center text-[12.5px] text-ink-tertiary">{needle || filter ? "No conversation matches." : folder === "snoozed" ? "Nothing snoozed." : folder === "archived" ? "Nothing archived." : "Inbox zero."}</li>}
            {shown.map((row) => <ThreadRow key={row.leadId} row={row} folder={folder} owners={owners} active={row.leadId === active} onSelect={() => setSelected(row.leadId)} />)}
            {!pages.isDone && (
              <li ref={more} className="flex justify-center py-2">
                <button type="button" className="rounded-full px-3 py-1 text-[12px] text-ink-tertiary hover:bg-raised/60 hover:text-ink" onClick={pages.loadMore}>Show older</button>
              </li>
            )}
          </ul>
          {notice && <Notice>{notice}</Notice>}
          {wide && canEdit && (
            <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-1 text-[11px] text-ink-tertiary" aria-label="Keyboard shortcuts">
              <span><Kbd>j</Kbd> <Kbd>k</Kbd> move</span><span><Kbd>e</Kbd> {folder === "open" ? "archive" : "inbox"}</span>
              {folder !== "snoozed" && <span><Kbd>s</Kbd> snooze</span>}<span><Kbd>r</Kbd> reply</span>
            </p>
          )}
        </aside>
      )}
      {active && current && (
        <ThreadPane key={active} projectId={projectId} projectName={projectName} thread={current} folder={folder} canEdit={canEdit} chief={chief} channels={channels} chosen={selected === active}
          owners={owners} busy={busy} snoozing={snoozing} onSnoozing={setSnoozing} onMove={(state, until) => void move(state, until)} onAssign={assign}
          onBack={wide ? undefined : () => setSelected(null)} onOpenContact={() => onOpenContact(active)} />
      )}
    </div>
  );
}

function ThreadRow({ row, folder, owners, active, onSelect }: { row: InboxThread; folder: InboxFolder; owners: readonly OwnerOption[]; active: boolean; onSelect(): void }) {
  return (
    <li>
      <button type="button" data-lead-id={row.leadId} onClick={onSelect} aria-current={active ? "true" : undefined}
        className={cn("relative flex w-full min-w-0 items-start gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none transition-colors duration-(--motion-fast) hover:bg-raised/40 focus-visible:ring-2 focus-visible:ring-accent/60",
          active && "bg-raised/70 hover:bg-raised/70")}>
        <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", row.unread ? "bg-accent" : "bg-transparent")} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <strong className={cn("min-w-0 flex-1 truncate text-[13px]", row.unread ? "font-semibold text-ink" : "font-medium text-ink-secondary")}>{row.name}</strong>
            {folder === "snoozed" && row.snoozedUntil
              ? <span className="flex shrink-0 items-center gap-1 text-[11px] text-ink-tertiary"><BellOff size={10} aria-hidden="true" />{new Date(row.snoozedUntil).toLocaleString(undefined, { weekday: "short", hour: "numeric" })}</span>
              : <span className="shrink-0 text-[11px] tabular-nums text-ink-tertiary">{ago(row.lastAt)}</span>}
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-ink-tertiary">
            {row.last && <span className="shrink-0">{KIND_ICON[row.last.kind as keyof typeof KIND_ICON]}</span>}
            <span className={cn("min-w-0 flex-1 truncate", row.unread && "text-ink-secondary")}>{row.last ? `${row.last.inbound ? "" : "You: "}${row.last.preview}` : row.company ?? ""}</span>
            {row.unread > 1 && <span className="shrink-0 tabular-nums text-accent-text">{row.unread}</span>}
            {row.unread > 0 && <span className="sr-only">{row.unread} unread</span>}
            <OwnerAvatar owner={row.owner} owners={owners} size={16} />
          </span>
          {(row.pending > 0 || row.wonRequest) && (
            <span className="mt-1 flex flex-wrap gap-1">
              {row.pending > 0 && <span className="rounded-full bg-accent/15 px-1.5 py-px text-[10.5px] text-accent-text">{row.pending} to approve</span>}
              {row.wonRequest && <span className="rounded-full bg-success/10 px-1.5 py-px text-[10.5px] text-success">Confirm won</span>}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

function ThreadPane({ projectId, projectName, thread, folder, canEdit, chief, channels, chosen, owners, busy, snoozing, onSnoozing, onMove, onAssign, onBack, onOpenContact }: {
  projectId: string; projectName: string; thread: InboxThread; folder: InboxFolder; canEdit: boolean; chief: Bot; channels: Record<PipelineChannel, boolean> | null; chosen: boolean;
  owners: readonly OwnerOption[]; busy: boolean; snoozing: boolean; onSnoozing(open: boolean): void; onMove(state: InboxFolder, until?: number): void;
  onAssign(owner: PipelineActor | null): void; onBack?(): void; onOpenContact(): void;
}) {
  const leadId = thread.leadId;
  const detail = useCloudQuery<{ lead: PipelineLead; activities: PipelineActivity[] } | null>("pipeline:lead", { projectId, leadId });
  const deals = useCloudQuery<SalesDeal[]>("pipelineDeals:forLead", { projectId, leadId });
  const unread = chosen ? detail?.lead.unreadReplies ?? 0 : 0;
  useEffect(() => {
    if (unread) void cloudMutation("pipeline:markRead", { projectId, leadId }).catch(() => undefined);
  }, [unread, projectId, leadId]);
  if (!detail) return <div className="min-w-0 flex-1"><Loading label="Opening conversation" variant="chat" /></div>;
  const { lead } = detail;
  const meta = [lead.company, lead.stage, lead.email ?? lead.phone].filter(Boolean).join(" · ");
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col rounded-2xl border border-hairline/40 bg-app motion-safe:animate-[rise_var(--motion-fast)_var(--ease-out)_backwards]" aria-label={`Conversation with ${lead.name}`}>
      <header className="flex flex-wrap items-center gap-x-2 gap-y-2 border-b border-hairline/40 px-3 py-2.5">
        {onBack && <button type="button" className="inline-flex size-8 items-center justify-center rounded-lg text-ink-secondary hover:bg-raised hover:text-ink" aria-label="Back to conversations" onClick={onBack}><ArrowLeft size={16} /></button>}
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-semibold tracking-[-0.01em] text-ink">{lead.name}</h3>
          {meta && <p className="truncate text-[12px] text-ink-tertiary">{meta}</p>}
        </div>
        <div className="flex items-center gap-1.5 max-sm:w-full max-sm:justify-end">
          {canEdit && <ConversationActions folder={lead.inbox ?? folder} owner={lead.owner} owners={owners} busy={busy} snoozing={snoozing} onSnoozing={onSnoozing} onAssign={onAssign} onMove={onMove} />}
          <button type="button" className={cn(ghostButton, "h-8 min-h-8 rounded-full px-2.5 text-[12.5px]")} onClick={onOpenContact} title="Open the contact and its deals"><UserRound size={13} /><span className="max-sm:sr-only">Contact</span></button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain px-3 py-3">
        {(deals ?? []).filter((deal) => deal.wonRequest).map((deal) => <WonRequestBanner key={deal._id} projectId={projectId} deal={deal} canEdit={canEdit} />)}
        <Conversation projectId={projectId} projectName={projectName} lead={lead} activities={detail.activities} canEdit={canEdit} chief={chief} channels={channels} />
      </div>
    </section>
  );
}
