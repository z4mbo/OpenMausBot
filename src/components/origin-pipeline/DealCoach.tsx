import { useState } from "react";
import { Loader2, RotateCw, Send, Sparkles } from "lucide-react";
import type { Bot } from "@/state/store";
import { cloudMutation } from "@/lib/origin-cloud";
import { cn } from "@/lib/cn";
import { ghostButton, inputClass, primaryButton, useAction } from "../origin-pages/ui";
import type { PipelineChannel, PipelineLead } from "../../../shared/origin-pipeline";
import type { DealRisk, SalesDeal } from "../../../shared/origin-sales";
import { ago } from "./activity-labels";
import { pipelineServer } from "./pipeline-api";

const small = "h-7 min-h-7 rounded-full px-3 text-[12px]";
const RISK: Record<DealRisk, { label: string; dot: string; text: string }> = {
  low: { label: "Low risk", dot: "bg-success", text: "text-success" },
  medium: { label: "Medium risk", dot: "bg-warning", text: "text-warning" },
  high: { label: "High risk", dot: "bg-danger", text: "text-danger" },
};
const CHANNEL = { email: "Email", sms: "Text", whatsapp: "WhatsApp" } as const;

export function DealCoachPanel({ projectId, projectName, lead, deal, canEdit, chief, channels }: {
  projectId: string; projectName: string; lead: PipelineLead; deal: SalesDeal; canEdit: boolean; chief: Bot; channels: Record<PipelineChannel, boolean> | null;
}) {
  const asking = useAction();
  const sending = useAction();
  const [draft, setDraft] = useState<string | null>(null);
  const [info, setInfo] = useState("");
  const coach = deal.coach;
  const ask = () => void asking.run(async () => { await pipelineServer.coach({ projectId, dealId: deal._id, botId: chief.id, projectName }); setDraft(null); setInfo(""); }, "The coach could not read this deal");

  if (!coach) {
    if (!canEdit) return null;
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={cn(ghostButton, small)} disabled={asking.busy} onClick={ask} title={`${chief.name}'s quick model reads the deal and its conversation`}>
          {asking.busy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}Coach
        </button>
        {asking.busy && <span className="text-[12px] text-ink-tertiary" role="status">Reading the deal…</span>}
        {asking.error && <span className="w-full text-[12px] text-danger" role="alert">{asking.error}</span>}
      </div>
    );
  }

  const risk = RISK[coach.risk];
  const follow = coach.followUp;
  const body = draft ?? follow.body;
  const blocked = channels && !channels[follow.channel] ? `Connect ${follow.channel === "email" ? "Brevo" : "Twilio"} under Settings > Integrations to send it.` : "";
  const send = () => void sending.run(async () => {
    const { activityId } = await cloudMutation<{ activityId: string }>("pipeline:draftContact", {
      projectId, leadId: lead._id, channel: follow.channel, body, ...(follow.channel === "email" ? { subject: follow.subject || `About ${deal.title}` } : {}),
    });
    setInfo((await pipelineServer.send({ projectId, activityId, botId: chief.id })).message);
  }, "Could not send the follow-up");

  return (
    <section aria-label="Deal coach" className="flex flex-col gap-2 rounded-xl border border-hairline/40 bg-inset/40 p-2.5 motion-safe:animate-[pop-in_var(--motion-fast)_var(--ease-out)]">
      <header className="flex items-center gap-2 text-[11.5px]">
        <Sparkles size={12} className="text-ink-tertiary" aria-hidden="true" />
        <span className="font-medium text-ink-secondary">Coach</span>
        <span className={cn("flex items-center gap-1", risk.text)}><span className={cn("size-1.5 rounded-full", risk.dot)} aria-hidden="true" />{risk.label}</span>
        <span className="ml-auto text-ink-tertiary">{coach.by ? `${coach.by} · ` : ""}{ago(coach.at)}</span>
        {canEdit && (
          <button type="button" className="inline-flex size-6 items-center justify-center rounded-md text-ink-tertiary hover:bg-raised hover:text-ink disabled:opacity-50" aria-label="Ask the coach again" disabled={asking.busy} onClick={ask}>
            {asking.busy ? <Loader2 size={12} className="animate-spin" /> : <RotateCw size={12} />}
          </button>
        )}
      </header>
      <p className="text-[13px] font-medium leading-snug text-ink">{coach.nextAction}</p>
      {coach.riskReason && <p className="text-[12px] leading-snug text-ink-secondary">{coach.riskReason}</p>}
      <div className="flex flex-col gap-1.5 border-t border-hairline/40 pt-2">
        <span className="text-[11.5px] text-ink-tertiary">{CHANNEL[follow.channel]} follow-up{follow.subject ? ` · ${follow.subject}` : ""}</span>
        {canEdit
          ? <textarea className={cn(inputClass, "min-h-[72px] resize-y text-[12.5px] leading-relaxed")} aria-label="Coach follow-up" value={body} maxLength={follow.channel === "sms" ? 1600 : 4000} onChange={(event) => setDraft(event.target.value)} />
          : <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink-secondary">{body}</p>}
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={cn(primaryButton, small)} disabled={sending.busy || !body.trim() || Boolean(blocked)} onClick={send}>
              {sending.busy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}Send to {lead.name.split(" ")[0]}
            </button>
            {blocked && <span className="text-[12px] text-ink-tertiary">{blocked}</span>}
          </div>
        )}
      </div>
      {info && <p className="text-[12px] text-ink-secondary" role="status">{info}</p>}
      {(asking.error || sending.error) && <p className="text-[12px] text-danger" role="alert">{asking.error || sending.error}</p>}
    </section>
  );
}
