import { useState } from "react";
import { CircleDollarSign, CreditCard, Plus, Trophy } from "lucide-react";
import { useCloudQuery } from "@/lib/origin-cloud";
import { cn } from "@/lib/cn";
import { EmptyState, Loading, Segmented, cardClass, primaryButton, underGlass } from "../origin-pages/ui";
import { CLOSED_STAGES, formatLeadValue } from "../../../shared/origin-pipeline";
import type { SalesDealRow, SalesTotals } from "../../../shared/origin-sales";

type Filter = "open" | "won" | "lost" | "all";

export function DealsView({ projectId, canEdit, hasContacts, onOpen, onNew }: { projectId: string; canEdit: boolean; hasContacts: boolean; onOpen(leadId: string): void; onNew(): void }) {
  const data = useCloudQuery<{ deals: SalesDealRow[]; totals: SalesTotals }>("pipelineDeals:list", { projectId });
  const [filter, setFilter] = useState<Filter>("open");
  if (!data) return <Loading label="Loading deals" variant="list" />;
  const { deals, totals } = data;
  const money = (value: number, currency = totals.currency) => formatLeadValue(value, currency);
  const shown = deals.filter((deal) => filter === "all" || (filter === "open" ? !CLOSED_STAGES.includes(deal.stage) : deal.stage === (filter === "won" ? "Won" : "Lost")));
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-6 md:px-6", underGlass)}>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Revenue">
        <Total label="Open" value={money(totals.openValue)} hint={`${totals.openCount} ${totals.openCount === 1 ? "deal" : "deals"}`} />
        <Total label="Won this month" value={money(totals.wonMonth)} />
        <Total label="Won in all" value={money(totals.wonTotal)} hint={`${totals.wonCount} won · ${totals.lostCount} lost`} />
        <Total label="To confirm" value={String(totals.awaitingConfirmation)} hint="An agent says won" />
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented label="Deals" value={filter} onChange={setFilter}
          options={[{ value: "open", label: "Open" }, { value: "won", label: "Won" }, { value: "lost", label: "Lost" }, { value: "all", label: "All" }]} />
        {canEdit && hasContacts && <button type="button" className={cn(primaryButton, "ml-auto")} onClick={onNew}><Plus size={14} />New deal</button>}
      </div>
      {!shown.length ? (
        <EmptyState compact icon={<CircleDollarSign size={22} />} title={deals.length ? "No deals here" : "No deals yet"}
          body={deals.length ? undefined : "Open a deal from a contact to track its value, products and close date, and get paid with a Stripe link."} />
      ) : (
        <ul className={cn(cardClass, "divide-y divide-hairline/30")}>
          {shown.map((deal) => (
            <li key={deal._id}>
              <button type="button" onClick={() => onOpen(deal.leadId)} className="flex w-full min-w-0 items-center gap-3 px-3 py-2.5 text-left outline-none transition-colors hover:bg-raised/30 focus-visible:ring-2 focus-visible:ring-accent/60">
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-[13.5px] font-medium text-ink">{deal.title}</strong>
                  <span className="block truncate text-[12px] text-ink-secondary">
                    {[`${deal.leadName}${deal.leadCompany ? ` · ${deal.leadCompany}` : ""}`, deal.closeDate && `closes ${deal.closeDate}`, deal.lineItems.length ? `${deal.lineItems.length} ${deal.lineItems.length === 1 ? "product" : "products"}` : ""].filter(Boolean).join(" · ")}
                  </span>
                </span>
                {deal.wonRequest && <span className="flex shrink-0 items-center gap-1 rounded-full bg-success/10 px-1.5 py-px text-[11px] text-success"><Trophy size={11} aria-hidden="true" />Confirm</span>}
                {deal.payment && <span title={deal.payment.paidAt ? "Paid" : "Payment link sent"} className={cn("shrink-0", deal.payment.paidAt ? "text-success" : "text-ink-tertiary")}><CreditCard size={13} aria-label={deal.payment.paidAt ? "Paid" : "Payment link sent"} /></span>}
                <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11.5px] max-sm:hidden", deal.stage === "Won" ? "bg-success/10 text-success" : "bg-raised text-ink-secondary")}>{deal.stage}</span>
                <span className="w-24 shrink-0 text-right text-[13px] font-medium tabular-nums text-ink">{money(deal.stage === "Won" ? deal.wonAmount ?? deal.value : deal.value, deal.currency)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Total({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className={cn(cardClass, "px-3 py-2.5")}>
      <dt className="truncate text-[11.5px] text-ink-tertiary">{label}</dt>
      <dd className="m-0">
        <span className="block truncate text-[18px] font-semibold tabular-nums tracking-[-0.01em] text-ink">{value}</span>
        {hint && <span className="block truncate text-[11.5px] text-ink-tertiary">{hint}</span>}
      </dd>
    </div>
  );
}
