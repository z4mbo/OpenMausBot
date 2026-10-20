import { useState, type FormEvent } from "react";
import { Check, Copy, CreditCard, Loader2, Pencil, Plus, RotateCw, Send, Trash2, Trophy, X } from "lucide-react";
import type { Bot } from "@/state/store";
import { cloudMutation, useCloudQuery } from "@/lib/origin-cloud";
import { cn } from "@/lib/cn";
import { copyText } from "@/lib/copy-text";
import { Select } from "../Select";
import { Field, Loading, Notice, cardClass, ghostButton, iconButton, inputClass, primaryButton, useAction } from "../origin-pages/ui";
import { CLOSED_STAGES, formatLeadValue, type PipelineChannel, type PipelineLead } from "../../../shared/origin-pipeline";
import { dealTotal, paymentMessage, type SalesDeal, type SalesLineItem, type SalesReplyChannel } from "../../../shared/origin-sales";
import { pipelineServer } from "./pipeline-api";
import { when } from "./activity-labels";

const WON_REASONS = ["Product fit", "Price", "Relationship", "Timing", "Referral"];
const LOST_REASONS = ["Price", "Chose a competitor", "No budget", "No decision", "Timing", "Not a fit"];
const small = "h-7 min-h-7 rounded-full px-3 text-[12px]";

const money = (deal: Pick<SalesDeal, "currency">, value: number) => formatLeadValue(value, deal.currency);

export function WonRequestBanner({ projectId, deal, canEdit }: { projectId: string; deal: SalesDeal; canEdit: boolean }) {
  const action = useAction();
  const request = deal.wonRequest;
  if (!request) return null;
  const answer = (confirm: boolean) => void action.run(() => cloudMutation("pipelineDeals:confirmWon", { projectId, dealId: deal._id, confirm }), "Could not answer");
  return (
    <div role="status" className="flex flex-wrap items-center gap-2 rounded-xl border border-accent/40 bg-accent/[0.06] px-3 py-2 text-[12.5px]">
      <Trophy size={14} className="shrink-0 text-accent-text" aria-hidden="true" />
      <span className="min-w-0 flex-1 text-ink">
        {request.by.name} says <strong className="font-medium">{deal.title}</strong> was won for {money(deal, request.amount)}{request.reason ? `: ${request.reason}` : ""}
      </span>
      {canEdit && <>
        <button type="button" className={cn(primaryButton, small)} disabled={action.busy} onClick={() => answer(true)}>{action.busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}Confirm won</button>
        <button type="button" className={cn(ghostButton, small)} disabled={action.busy} onClick={() => answer(false)}>Dismiss</button>
      </>}
      {action.error && <span className="w-full text-[12px] text-danger" role="alert">{action.error}</span>}
    </div>
  );
}

export function DealPanel({ projectId, lead, stages, currency, canEdit, stripe, chief, channels }: {
  projectId: string; lead: PipelineLead; stages: readonly string[]; currency: string; canEdit: boolean; stripe: boolean; chief: Bot; channels: Record<PipelineChannel, boolean> | null;
}) {
  const deals = useCloudQuery<SalesDeal[]>("pipelineDeals:forLead", { projectId, leadId: lead._id });
  const [editing, setEditing] = useState<string | null>(null);
  const open = stages.filter((stage) => !CLOSED_STAGES.includes(stage));
  return (
    <section className="flex flex-col gap-2.5 px-5 pb-8 pt-3" aria-label="Deals">
      <div className="flex items-center gap-2">
        <h3 className="text-[13px] font-semibold text-ink">Deals <span className="font-normal tabular-nums text-ink-tertiary">{deals?.length ?? ""}</span></h3>
        {canEdit && editing !== "new" && <button type="button" className={cn(ghostButton, "ml-auto", small)} onClick={() => setEditing("new")}><Plus size={12} />New deal</button>}
      </div>
      {editing === "new" && <DealEditor projectId={projectId} lead={lead} stages={open} currency={currency} onDone={() => setEditing(null)} />}
      {!deals ? <Loading label="Loading deals" variant="inline" />
        : !deals.length && editing !== "new" ? <p className="py-4 text-center text-[12.5px] text-ink-tertiary">No deals with {lead.name} yet.</p>
        : deals.map((deal) => editing === deal._id
          ? <DealEditor key={deal._id} projectId={projectId} lead={lead} stages={open} currency={currency} deal={deal} onDone={() => setEditing(null)} />
          : <DealCard key={deal._id} projectId={projectId} lead={lead} deal={deal} stages={open} canEdit={canEdit} stripe={stripe} chief={chief} channels={channels} onEdit={() => setEditing(deal._id)} />)}
    </section>
  );
}

function DealCard({ projectId, lead, deal, stages, canEdit, stripe, chief, channels, onEdit }: {
  projectId: string; lead: PipelineLead; deal: SalesDeal; stages: readonly string[]; canEdit: boolean; stripe: boolean; chief: Bot; channels: Record<PipelineChannel, boolean> | null; onEdit(): void;
}) {
  const action = useAction();
  const [closing, setClosing] = useState<"won" | "lost" | null>(null);
  const closed = CLOSED_STAGES.includes(deal.stage);
  const run = (fn: () => Promise<unknown>, fallback: string) => void action.run(fn, fallback);
  const remove = () => { if (window.confirm(`Delete the deal ${deal.title}?`)) run(() => cloudMutation("pipelineDeals:remove", { projectId, dealId: deal._id }), "Could not delete the deal"); };
  return (
    <article className={cn(cardClass, "flex flex-col gap-2 px-3 py-2.5")} aria-label={`Deal ${deal.title}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <strong className="block truncate text-[13.5px] font-medium text-ink">{deal.title}</strong>
          <span className="text-[12px] text-ink-tertiary">{[deal.closeDate && `Closes ${deal.closeDate}`, `Opened by ${deal.createdBy.name}`].filter(Boolean).join(" · ")}</span>
        </div>
        <span className="shrink-0 text-[14px] font-semibold tabular-nums text-ink">{money(deal, deal.stage === "Won" ? deal.wonAmount ?? deal.value : deal.value)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {closed ? (
          <span className={cn("rounded-full px-2 py-0.5 text-[12px]", deal.stage === "Won" ? "bg-success/10 text-success" : "bg-raised text-ink-secondary")}>
            {deal.stage}{deal.reason ? ` · ${deal.reason}` : ""}{deal.closedBy ? ` · ${deal.closedBy.name}` : ""}
          </span>
        ) : canEdit ? (
          <Select size="sm" aria-label={`Stage of ${deal.title}`} value={deal.stage} onChange={(event) => run(() => cloudMutation("pipelineDeals:upsert", { projectId, dealId: deal._id, stage: event.target.value }), "Could not move the deal")}>
            {stages.map((stage) => <option key={stage} value={stage}>{stage}</option>)}
          </Select>
        ) : <span className="rounded-full bg-raised px-2 py-0.5 text-[12px] text-ink-secondary">{deal.stage}</span>}
        {canEdit && (
          <div className="ml-auto flex items-center">
            {closed && <button type="button" className={cn(ghostButton, small)} disabled={action.busy} onClick={() => run(() => cloudMutation("pipelineDeals:upsert", { projectId, dealId: deal._id, stage: stages[stages.length - 1] }), "Could not reopen the deal")}><RotateCw size={12} />Reopen</button>}
            <button type="button" className={cn(iconButton, "size-7")} aria-label={`Edit ${deal.title}`} onClick={onEdit}><Pencil size={13} /></button>
            <button type="button" className={cn(iconButton, "size-7 hover:text-danger")} aria-label={`Delete ${deal.title}`} onClick={remove}><Trash2 size={13} /></button>
          </div>
        )}
      </div>
      {deal.lineItems.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-[12px] text-ink-secondary">
          {deal.lineItems.map((item, index) => (
            <li key={index} className="flex gap-2"><span className="min-w-0 flex-1 truncate">{item.quantity} × {item.name}</span><span className="tabular-nums">{money(deal, item.quantity * item.unitPrice)}</span></li>
          ))}
        </ul>
      )}
      {deal.notes && <p className="line-clamp-3 whitespace-pre-wrap text-[12.5px] text-ink-secondary">{deal.notes}</p>}
      <WonRequestBanner projectId={projectId} deal={deal} canEdit={canEdit} />
      {canEdit && !closed && !closing && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={cn(primaryButton, small)} onClick={() => setClosing("won")}><Trophy size={12} />Mark won</button>
          <button type="button" className={cn(ghostButton, small)} onClick={() => setClosing("lost")}><X size={12} />Mark lost</button>
        </div>
      )}
      {closing && <CloseForm projectId={projectId} deal={deal} outcome={closing} onDone={() => setClosing(null)} />}
      {canEdit && !closed && <PaymentBox projectId={projectId} lead={lead} deal={deal} stripe={stripe} chief={chief} channels={channels} />}
      {deal.payment?.paidAt && <p className="text-[12px] text-success">Paid {money(deal, deal.payment.paidAmount ?? deal.payment.amount)} through Stripe · {when(deal.payment.paidAt)}</p>}
      {action.error && <Notice tone="danger">{action.error}</Notice>}
    </article>
  );
}

function CloseForm({ projectId, deal, outcome, onDone }: { projectId: string; deal: SalesDeal; outcome: "won" | "lost"; onDone(): void }) {
  const [amount, setAmount] = useState(String(deal.value || ""));
  const [reason, setReason] = useState("");
  const action = useAction();
  const list = `${deal._id}-${outcome}-reasons`;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = Number(amount.replace(",", "."));
    if (outcome === "won" && (!amount.trim() || !Number.isFinite(value))) { action.setError("Enter the amount won"); return; }
    if (await action.run(() => cloudMutation("pipelineDeals:closeDeal", { projectId, dealId: deal._id, outcome, ...(outcome === "won" ? { amount: value } : {}), ...(reason.trim() ? { reason } : {}) }), "Could not close the deal")) onDone();
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2 rounded-xl bg-inset/60 p-2.5">
      <div className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
        {outcome === "won" && <Field label={`Amount won (${deal.currency})`}><input className={cn(inputClass, "tabular-nums")} inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} autoFocus /></Field>}
        <Field label={outcome === "won" ? "Why they bought" : "Why it was lost"} className={outcome === "lost" ? "col-span-2 max-sm:col-span-1" : undefined}>
          <input className={inputClass} list={list} value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} autoFocus={outcome === "lost"} />
          <datalist id={list}>{(outcome === "won" ? WON_REASONS : LOST_REASONS).map((item) => <option key={item} value={item} />)}</datalist>
        </Field>
      </div>
      {action.error && <Notice tone="danger">{action.error}</Notice>}
      <div className="flex justify-end gap-2">
        <button type="button" className={cn(ghostButton, small)} onClick={onDone}>Cancel</button>
        <button className={cn(primaryButton, small)} disabled={action.busy}>{action.busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}{outcome === "won" ? "Mark won" : "Mark lost"}</button>
      </div>
    </form>
  );
}

function PaymentBox({ projectId, lead, deal, stripe, chief, channels }: { projectId: string; lead: PipelineLead; deal: SalesDeal; stripe: boolean; chief: Bot; channels: Record<PipelineChannel, boolean> | null }) {
  const action = useAction();
  const [info, setInfo] = useState("");
  const payment = deal.payment;
  const reachable: SalesReplyChannel[] = [...(lead.email ? ["email" as const] : []), ...(lead.phone ? ["sms" as const, "whatsapp" as const] : [])];
  const [channel, setChannel] = useState<SalesReplyChannel | "">(reachable[0] ?? "");
  const [message, setMessage] = useState("");
  const text = message || (payment ? paymentMessage(lead, deal, payment.url, payment.amount) : "");
  const create = () => void action.run(async () => { await pipelineServer.quote({ projectId, dealId: deal._id }); setInfo(""); }, "Could not make the payment link");
  const check = () => void action.run(async () => {
    const result = await pipelineServer.checkPayment({ projectId, dealId: deal._id });
    setInfo(result.paid ? `Paid ${money(deal, result.amount ?? 0)}. The deal is won.` : "No payment yet.");
  }, "Could not check the payment");
  const send = () => void action.run(async () => {
    if (!channel) return;
    const { activityId } = await cloudMutation<{ activityId: string }>("pipeline:draftContact", {
      projectId, leadId: lead._id, channel, body: text, ...(channel === "email" ? { subject: `Payment link: ${deal.title}` } : {}),
    });
    setInfo((await pipelineServer.send({ projectId, activityId, botId: chief.id })).message);
  }, "Could not send the link");
  if (!payment) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={cn(ghostButton, small)} disabled={!stripe || action.busy || !deal.value} onClick={create}
          title={stripe ? "Make a Stripe payment link for this deal" : "Connect Stripe under Settings > Integrations"}>
          {action.busy ? <Loader2 size={12} className="animate-spin" /> : <CreditCard size={12} />}Payment link
        </button>
        {!stripe && <span className="text-[12px] text-ink-tertiary">Connect Stripe under Settings &gt; Integrations to send payment links.</span>}
        {action.error && <span className="w-full text-[12px] text-danger" role="alert">{action.error}</span>}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-inset/60 p-2.5">
      <div className="flex min-w-0 items-center gap-2 text-[12.5px]">
        <CreditCard size={13} className="shrink-0 text-ink-tertiary" aria-hidden="true" />
        <a href={payment.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-accent-text hover:underline">{payment.url}</a>
        <button type="button" className={cn(iconButton, "size-7")} aria-label="Copy the payment link" onClick={() => void copyText(payment.url).then((result) => setInfo(result === "copied" ? "Copied." : "Could not copy the link."))}><Copy size={13} /></button>
        <span className={cn("shrink-0 rounded-full px-1.5 py-px text-[11px]", payment.paidAt ? "bg-success/10 text-success" : "bg-raised text-ink-secondary")}>{payment.paidAt ? "Paid" : "Unpaid"}</span>
      </div>
      {!payment.paidAt && <>
        <textarea className={cn(inputClass, "min-h-[64px] resize-y")} aria-label="Payment message" value={text} maxLength={1600} onChange={(event) => setMessage(event.target.value)} />
        <div className="flex flex-wrap items-center gap-2">
          <Select size="sm" aria-label="Send the link by" value={channel} onChange={(event) => setChannel(event.target.value as SalesReplyChannel)} disabled={!reachable.length}>
            {!reachable.length && <option value="">No email or phone</option>}
            {reachable.map((value) => <option key={value} value={value} disabled={channels ? !channels[value] : false}>{{ email: "Email", sms: "Text", whatsapp: "WhatsApp" }[value]}</option>)}
          </Select>
          <button type="button" className={cn(primaryButton, small)} disabled={!channel || action.busy || !text.trim()} onClick={send}><Send size={12} />Send to {lead.name.split(" ")[0]}</button>
          <button type="button" className={cn(ghostButton, small, "ml-auto")} disabled={action.busy} onClick={check}>{action.busy ? <Loader2 size={12} className="animate-spin" /> : <RotateCw size={12} />}Check payment</button>
        </div>
      </>}
      {info && <p className="text-[12px] text-ink-secondary" role="status">{info}</p>}
      {action.error && <p className="text-[12px] text-danger" role="alert">{action.error}</p>}
    </div>
  );
}

type ItemDraft = { name: string; quantity: string; unitPrice: string };

function DealEditor({ projectId, lead, stages, currency, deal, onDone }: { projectId: string; lead: PipelineLead; stages: readonly string[]; currency: string; deal?: SalesDeal; onDone(): void }) {
  const [title, setTitle] = useState(deal?.title ?? (lead.company ? `${lead.company} deal` : `${lead.name} deal`));
  const [stage, setStage] = useState(deal && stages.includes(deal.stage) ? deal.stage : stages.includes(lead.stage) ? lead.stage : stages[0] ?? "");
  const [value, setValue] = useState(deal ? String(deal.value) : lead.value ? String(lead.value) : "");
  const [dealCurrency, setCurrency] = useState(deal?.currency ?? currency);
  const [closeDate, setCloseDate] = useState(deal?.closeDate ?? "");
  const [notes, setNotes] = useState(deal?.notes ?? "");
  const [items, setItems] = useState<ItemDraft[]>(deal?.lineItems.map((item) => ({ name: item.name, quantity: String(item.quantity), unitPrice: String(item.unitPrice) })) ?? []);
  const action = useAction();
  const parsed: SalesLineItem[] = items.filter((item) => item.name.trim()).map((item) => ({ name: item.name, quantity: Number(item.quantity.replace(",", ".")) || 0, unitPrice: Number(item.unitPrice.replace(",", ".")) || 0 }));
  const total = parsed.length ? dealTotal(parsed) : null;
  const setItem = (index: number, patch: Partial<ItemDraft>) => setItems(items.map((item, at) => (at === index ? { ...item, ...patch } : item)));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const amount = value.trim() ? Number(value.replace(",", ".")) : 0;
    if (total === null && !Number.isFinite(amount)) { action.setError("Value must be a number"); return; }
    const ok = await action.run(() => cloudMutation("pipelineDeals:upsert", {
      projectId, ...(deal ? { dealId: deal._id } : { leadId: lead._id }), title, stage, currency: dealCurrency, closeDate, notes, lineItems: parsed,
      ...(total === null ? { value: amount } : {}),
    }), "Could not save the deal");
    if (ok) onDone();
  };
  return (
    <form onSubmit={submit} className={cn(cardClass, "flex flex-col gap-2.5 p-3")} aria-label={deal ? `Edit ${deal.title}` : "New deal"}>
      <Field label="Deal"><input className={inputClass} value={title} maxLength={200} required onChange={(event) => setTitle(event.target.value)} autoFocus /></Field>
      <div className="grid grid-cols-3 gap-2 max-sm:grid-cols-2">
        <Field label="Stage"><Select className="w-full" value={stage} onChange={(event) => setStage(event.target.value)}>{stages.map((name) => <option key={name} value={name}>{name}</option>)}</Select></Field>
        <Field label="Value"><input className={cn(inputClass, "tabular-nums")} inputMode="decimal" value={total === null ? value : String(total)} disabled={total !== null} onChange={(event) => setValue(event.target.value)} placeholder="0" /></Field>
        <Field label="Currency"><input className={cn(inputClass, "uppercase")} value={dealCurrency} maxLength={3} onChange={(event) => setCurrency(event.target.value.toUpperCase())} /></Field>
        <Field label="Expected close" className="max-sm:col-span-2"><input className={inputClass} type="date" value={closeDate} onChange={(event) => setCloseDate(event.target.value)} /></Field>
      </div>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-[12px] font-medium text-ink-secondary">Products</legend>
        {items.map((item, index) => (
          <div key={index} className="grid grid-cols-[1fr_4rem_6rem_auto] items-center gap-1.5 max-sm:grid-cols-[1fr_3.5rem_5rem_auto]">
            <input className={inputClass} aria-label={`Product ${index + 1}`} value={item.name} maxLength={120} placeholder="Annual licence" onChange={(event) => setItem(index, { name: event.target.value })} />
            <input className={cn(inputClass, "tabular-nums")} aria-label={`Quantity ${index + 1}`} inputMode="decimal" value={item.quantity} onChange={(event) => setItem(index, { quantity: event.target.value })} />
            <input className={cn(inputClass, "tabular-nums")} aria-label={`Unit price ${index + 1}`} inputMode="decimal" value={item.unitPrice} placeholder="0" onChange={(event) => setItem(index, { unitPrice: event.target.value })} />
            <button type="button" className={cn(iconButton, "size-7")} aria-label={`Remove product ${index + 1}`} onClick={() => setItems(items.filter((_, at) => at !== index))}><X size={13} /></button>
          </div>
        ))}
        <button type="button" className={cn(ghostButton, small, "self-start")} disabled={items.length >= 20} onClick={() => setItems([...items, { name: "", quantity: "1", unitPrice: "" }])}><Plus size={12} />Add product</button>
      </fieldset>
      <Field label="Notes"><textarea className={cn(inputClass, "min-h-[56px] resize-y")} value={notes} maxLength={8000} onChange={(event) => setNotes(event.target.value)} /></Field>
      {action.error && <Notice tone="danger">{action.error}</Notice>}
      <div className="flex justify-end gap-2">
        <button type="button" className={cn(ghostButton, small)} onClick={onDone}>Cancel</button>
        <button className={cn(primaryButton, small)} disabled={action.busy || !title.trim()}>{action.busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}Save deal</button>
      </div>
    </form>
  );
}
