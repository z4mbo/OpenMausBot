import { useEffect, useState } from "react";
import { ArrowLeft, Inbox, MessagesSquare, Search, UserRound } from "lucide-react";
import type { Bot } from "@/state/store";
import { cloudMutation, useCloudQuery } from "@/lib/origin-cloud";
import { cn } from "@/lib/cn";
import { EmptyState, Loading, Segmented, ghostButton, inputClass, underGlass } from "../origin-pages/ui";
import type { PipelineActivity, PipelineChannel, PipelineLead } from "../../../shared/origin-pipeline";
import type { InboxThread, SalesDeal } from "../../../shared/origin-sales";
import { KIND_ICON, ago } from "./activity-labels";
import { Conversation } from "./Conversation";
import { WonRequestBanner } from "./DealPanel";

type Filter = "all" | "unread" | "approval";

export function InboxView({ projectId, projectName, canEdit, chief, channels, onOpenContact, onSetUp }: {
  projectId: string; projectName: string; canEdit: boolean; chief: Bot; channels: Record<PipelineChannel, boolean> | null;
  onOpenContact(leadId: string): void; onSetUp(): void;
}) {
  const threads = useCloudQuery<InboxThread[]>("pipelineInbox:threads", { projectId });
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [wide, setWide] = useState(() => typeof window === "undefined" || window.matchMedia("(min-width: 768px)").matches);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const change = () => setWide(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);

  if (!threads) return <Loading label="Loading conversations" variant="chat" />;
  const needle = query.trim().toLowerCase();
  const shown = threads.filter((row) => (filter === "all" || (filter === "unread" ? row.unread > 0 : row.pending > 0 || row.wonRequest))
    && (!needle || `${row.name} ${row.company ?? ""} ${row.last?.preview ?? ""}`.toLowerCase().includes(needle)));
  const active = selected ?? (wide ? shown[0]?.leadId ?? null : null);
  const unread = threads.filter((row) => row.unread > 0).length;
  const waiting = threads.filter((row) => row.pending > 0 || row.wonRequest).length;

  if (!threads.length) {
    return (
      <div className={cn("flex min-h-0 flex-1 flex-col px-4 md:px-6", underGlass)}>
        <EmptyState icon={<MessagesSquare size={22} />} title="No conversations yet"
          body="Emails, texts, WhatsApp messages and calls with your contacts gather here, with replies when inbound is on."
          action={<button type="button" className={ghostButton} onClick={onSetUp}><Inbox size={14} />Set up replies</button>} />
      </div>
    );
  }

  return (
    <div className={cn("flex min-h-0 flex-1 gap-4 px-4 pb-4 md:px-6", underGlass)}>
      {(wide || !active) && (
        <aside className="flex min-h-0 w-full flex-col gap-2 md:w-[300px] md:shrink-0" aria-label="Conversations">
          <Segmented label="Show" value={filter} onChange={setFilter}
            options={[{ value: "all", label: "All" }, { value: "unread", label: `Unread${unread ? ` ${unread}` : ""}` }, { value: "approval", label: `To approve${waiting ? ` ${waiting}` : ""}` }]} />
          <label className="relative flex items-center">
            <Search size={14} className="pointer-events-none absolute left-2.5 text-ink-tertiary" aria-hidden="true" />
            <input className={cn(inputClass, "h-8 pl-8")} placeholder="Search conversations" aria-label="Search conversations" value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
            {!shown.length && <li className="px-2 py-6 text-center text-[12.5px] text-ink-tertiary">Nothing here.</li>}
            {shown.map((row) => <ThreadRow key={row.leadId} row={row} active={row.leadId === active} onSelect={() => setSelected(row.leadId)} />)}
          </ul>
        </aside>
      )}
      {active && (
        <ThreadPane key={active} projectId={projectId} projectName={projectName} leadId={active} canEdit={canEdit} chief={chief} channels={channels} chosen={selected === active}
          onBack={wide ? undefined : () => setSelected(null)} onOpenContact={() => onOpenContact(active)} />
      )}
    </div>
  );
}

function ThreadRow({ row, active, onSelect }: { row: InboxThread; active: boolean; onSelect(): void }) {
  return (
    <li>
      <button type="button" onClick={onSelect} aria-current={active ? "true" : undefined}
        className={cn("flex w-full min-w-0 items-start gap-2.5 rounded-xl px-2.5 py-2 text-left outline-none transition-colors hover:bg-raised/50 focus-visible:ring-2 focus-visible:ring-accent/60",
          active && "bg-raised/70")}>
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-inset text-[12px] font-medium text-ink-secondary" aria-hidden="true">{row.name.trim().charAt(0).toUpperCase()}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <strong className={cn("min-w-0 flex-1 truncate text-[13px]", row.unread ? "font-semibold text-ink" : "font-medium text-ink")}>{row.name}</strong>
            <span className="shrink-0 text-[11px] tabular-nums text-ink-tertiary">{ago(row.lastAt)}</span>
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-ink-secondary">
            {row.last && <span className="shrink-0 text-ink-tertiary">{KIND_ICON[row.last.kind as keyof typeof KIND_ICON]}</span>}
            <span className="min-w-0 flex-1 truncate">{row.last ? `${row.last.inbound ? "" : "You: "}${row.last.preview}` : row.company ?? ""}</span>
            {row.unread > 0 && <span className="shrink-0 rounded-full bg-accent px-1.5 text-[10.5px] font-semibold tabular-nums text-accent-ink">{row.unread}<span className="sr-only"> unread</span></span>}
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

function ThreadPane({ projectId, projectName, leadId, canEdit, chief, channels, chosen, onBack, onOpenContact }: {
  projectId: string; projectName: string; leadId: string; canEdit: boolean; chief: Bot; channels: Record<PipelineChannel, boolean> | null; chosen: boolean; onBack?(): void; onOpenContact(): void;
}) {
  const detail = useCloudQuery<{ lead: PipelineLead; activities: PipelineActivity[] } | null>("pipeline:lead", { projectId, leadId });
  const deals = useCloudQuery<SalesDeal[]>("pipelineDeals:forLead", { projectId, leadId });
  const unread = chosen ? detail?.lead.unreadReplies ?? 0 : 0;
  useEffect(() => {
    if (unread) void cloudMutation("pipeline:markRead", { projectId, leadId }).catch(() => undefined);
  }, [unread, projectId, leadId]);
  if (!detail) return <div className="min-w-0 flex-1"><Loading label="Opening conversation" variant="chat" /></div>;
  const { lead } = detail;
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col rounded-2xl border border-hairline/40 bg-app motion-safe:animate-[rise_var(--motion-fast)_var(--ease-out)_backwards]" aria-label={`Conversation with ${lead.name}`}>
      <header className="flex items-center gap-2 border-b border-hairline/40 px-3 py-2">
        {onBack && <button type="button" className="inline-flex size-8 items-center justify-center rounded-lg text-ink-secondary hover:bg-raised hover:text-ink" aria-label="Back to conversations" onClick={onBack}><ArrowLeft size={16} /></button>}
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[14px] font-semibold text-ink">{lead.name}</h3>
          <p className="truncate text-[12px] text-ink-tertiary">{[lead.company, lead.stage, lead.email, lead.phone].filter(Boolean).join(" · ")}</p>
        </div>
        <button type="button" className={cn(ghostButton, "h-8 rounded-full px-2.5")} onClick={onOpenContact}><UserRound size={13} />Contact</button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain px-3 py-3">
        {(deals ?? []).filter((deal) => deal.wonRequest).map((deal) => <WonRequestBanner key={deal._id} projectId={projectId} deal={deal} canEdit={canEdit} />)}
        <Conversation projectId={projectId} projectName={projectName} lead={lead} activities={detail.activities} canEdit={canEdit} chief={chief} channels={channels} />
      </div>
    </section>
  );
}
