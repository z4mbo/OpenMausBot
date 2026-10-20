import { useState } from "react";
import { CircleDollarSign, CreditCard, Plus, Sparkles, Trophy } from "lucide-react";
import { useCloudQuery } from "@/lib/origin-cloud";
import { cn } from "@/lib/cn";
import { EmptyState, Loading, Segmented, cardClass, primaryButton, underGlass } from "../origin-pages/ui";
import { CLOSED_STAGES, formatLeadValue } from "../../../shared/origin-pipeline";
import type { SalesCurrencyTotals, SalesDealRow, SalesTotals } from "../../../shared/origin-sales";

type Filter = "open" | "won" | "lost" | "all";

const today = () => new Date().toISOString().slice(0, 10);
const shortDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

function otherLine(row: SalesCurrencyTotals): string {
  return [row.openCount ? `${formatLeadValue(row.openValue, row.currency)} open` : "", row.wonCount ? `${formatLeadValue(row.wonTotal, row.currency)} won` : ""].filter(Boolean).join(" · ");
}

export function DealsView({ projectId, canEdit, hasContacts, onOpen, onNew }: { projectId: string; canEdit: boolean; hasContacts: boolean; onOpen(leadId: string): void; onNew(): void }) {
  const data = useCloudQuery<{ deals: SalesDealRow[]; totals: SalesTotals }>("pipelineDeals:list", { projectId });
  const [filter, setFilter] = useState<Filter>("open");
  if (!data) return <Loading label="Loading deals" variant="list" />;
  const { deals, totals } = data;
  const money = (value: number, currency = totals.currency) => formatLeadValue(value, currency);
  const counts: Record<Filter, number> = {
    open: deals.filter((deal) => !CLOSED_STAGES.includes(deal.stage)).length, won: deals.filter((deal) => deal.stage === "Won").length,
    lost: deals.filter((deal) => deal.stage === "Lost").length, all: deals.length,
  };
  const shown = deals.filter((deal) => filter === "all" || (filter === "open" ? !CLOSED_STAGES.includes(deal.stage) : deal.stage === (filter === "won" ? "Won" : "Lost")));
  const others = (totals.others ?? []).filter((row) => row.openCount || row.wonCount);
  const label = (value: Filter, text: string) => <span className="flex items-center gap-1.5">{text}{counts[value] > 0 && <span className="tabular-nums text-ink-tertiary">{counts[value]}</span>}</span>;

  if (!deals.length) {
    return (
      <div className={cn("flex min-h-0 flex-1 flex-col px-4 md:px-6", underGlass)}>
        <EmptyState icon={<CircleDollarSign size={22} />} title="No deals yet"
          body="A deal tracks what a contact may buy, by when, and gets paid through a Stripe link."
          action={canEdit && hasContacts ? <button type="button" className={primaryButton} onClick={onNew}><Plus size={14} />New deal</button> : undefined} />
      </div>
    );
  }

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-6 md:px-6", underGlass)}>
      <section aria-label="Revenue" className="flex flex-col gap-1.5">
        <dl className={cn(cardClass, "grid grid-cols-2 divide-hairline/40 sm:grid-cols-4 sm:divide-x max-sm:[&>div:nth-child(n+3)]:border-t max-sm:[&>div:nth-child(even)]:border-l max-sm:[&>div]:border-hairline/40")}>
          <Total label="Open pipeline" value={money(totals.openValue)} hint={`${totals.openCount} ${totals.openCount === 1 ? "deal" : "deals"}`} />
          <Total label="Won this month" value={money(totals.wonMonth)} tone={totals.wonMonth > 0 ? "good" : undefined} />
          <Total label="Won to date" value={money(totals.wonTotal)} hint={`${totals.wonCount} won · ${totals.lostCount} lost`} />
          <Total label="Win rate" value={totals.wonCount + totals.lostCount ? `${Math.round((totals.wonCount / (totals.wonCount + totals.lostCount)) * 100)}%` : "—"}
            hint={totals.awaitingConfirmation ? `${totals.awaitingConfirmation} to confirm` : "of closed deals"} tone={totals.awaitingConfirmation ? "attention" : undefined} />
        </dl>
        {others.length > 0 && (
          <p className="px-1 text-[12px] text-ink-tertiary">
            Kept apart, not converted:{others.map((row, index) => <span key={row.currency} className="tabular-nums text-ink-secondary">{index ? " · " : " "}{otherLine(row)}</span>)}
          </p>
        )}
      </section>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented label="Deals" value={filter} onChange={setFilter}
          options={[{ value: "open", label: label("open", "Open") }, { value: "won", label: label("won", "Won") }, { value: "lost", label: label("lost", "Lost") }, { value: "all", label: label("all", "All") }]} />
        {canEdit && hasContacts && <button type="button" className={cn(primaryButton, "ml-auto")} onClick={onNew}><Plus size={14} />New deal</button>}
      </div>
      {!shown.length ? (
        <p className="py-10 text-center text-[12.5px] text-ink-tertiary">{filter === "open" ? "No open deals." : filter === "won" ? "Nothing won yet." : "Nothing lost."}</p>
      ) : (
        <div className={cn(cardClass, "overflow-hidden")}>
          <div aria-hidden="true" className="grid grid-cols-[minmax(0,1fr)_7rem_5rem_7rem] gap-3 border-b border-hairline/40 px-3 py-2 text-[11.5px] text-ink-tertiary max-sm:hidden">
            <span>Deal</span><span>Stage</span><span>Close</span><span className="text-right">Value</span>
          </div>
          <ul className="divide-y divide-hairline/30" aria-label="Deals">
            {shown.map((deal) => <DealRow key={deal._id} deal={deal} onOpen={() => onOpen(deal.leadId)} />)}
          </ul>
        </div>
      )}
    </div>
  );
}

function DealRow({ deal, onOpen }: { deal: SalesDealRow; onOpen(): void }) {
  const open = !CLOSED_STAGES.includes(deal.stage);
  const late = open && deal.closeDate !== undefined && deal.closeDate < today();
  const value = deal.stage === "Won" ? deal.wonAmount ?? deal.value : deal.value;
  return (
    <li>
      <button type="button" onClick={onOpen}
        className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 px-3 py-2.5 text-left outline-none transition-colors duration-(--motion-fast) hover:bg-raised/30 focus-visible:bg-raised/40 sm:grid-cols-[minmax(0,1fr)_7rem_5rem_7rem]">
        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-1.5">
            <strong className="truncate text-[13.5px] font-medium text-ink">{deal.title}</strong>
            {deal.wonRequest && <span className="flex shrink-0 items-center gap-1 rounded-full bg-success/10 px-1.5 py-px text-[11px] text-success"><Trophy size={11} aria-hidden="true" />Confirm</span>}
            {deal.payment && <span title={deal.payment.paidAt ? "Paid through Stripe" : "Payment link sent"} className={cn("shrink-0", deal.payment.paidAt ? "text-success" : "text-ink-tertiary")}><CreditCard size={12} aria-label={deal.payment.paidAt ? "Paid" : "Payment link sent"} /></span>}
            {deal.coach && open && <span title={`Coach: ${deal.coach.nextAction}`} className={cn("shrink-0", deal.coach.risk === "high" ? "text-danger" : deal.coach.risk === "medium" ? "text-warning" : "text-ink-tertiary")}><Sparkles size={12} aria-label={`${deal.coach.risk} risk`} /></span>}
          </span>
          <span className="block truncate text-[12px] text-ink-tertiary">{deal.leadName}{deal.leadCompany ? ` · ${deal.leadCompany}` : ""}</span>
        </span>
        <span className="max-sm:hidden"><StagePill stage={deal.stage} /></span>
        <span className={cn("text-[12.5px] tabular-nums max-sm:hidden", late ? "text-danger" : "text-ink-secondary")}>{deal.closeDate ? shortDay(deal.closeDate) : "—"}</span>
        <span className="text-right">
          <span className={cn("block text-[13.5px] font-medium tabular-nums", deal.stage === "Lost" ? "text-ink-tertiary line-through decoration-ink-tertiary/50" : "text-ink")}>{formatLeadValue(value, deal.currency)}</span>
          <span className="block text-[11.5px] text-ink-tertiary sm:hidden">{deal.stage}{deal.closeDate ? ` · ${shortDay(deal.closeDate)}` : ""}</span>
        </span>
      </button>
    </li>
  );
}

function StagePill({ stage }: { stage: string }) {
  const tone = stage === "Won" ? "bg-success" : stage === "Lost" ? "bg-ink-tertiary/60" : "bg-accent";
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 text-[12.5px] text-ink-secondary">
      <span className={cn("size-1.5 shrink-0 rounded-full", tone)} aria-hidden="true" /><span className="truncate">{stage}</span>
    </span>
  );
}

function Total({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "good" | "attention" }) {
  return (
    <div className="min-w-0 px-3.5 py-3">
      <dt className="truncate text-[11.5px] text-ink-tertiary">{label}</dt>
      <dd className="m-0">
        <span className={cn("block truncate text-[20px] font-semibold tabular-nums tracking-[-0.02em]", tone === "good" ? "text-success" : "text-ink")}>{value}</span>
        {hint && <span className={cn("block truncate text-[11.5px]", tone === "attention" ? "text-accent-text" : "text-ink-tertiary")}>{hint}</span>}
      </dd>
    </div>
  );
}
