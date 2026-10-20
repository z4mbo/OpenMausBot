import { useEffect, useState, type RefObject } from "react";
import { useStore, currentTaskBot, type Bot, type ModelSelection } from "@/state/store";
import { useModelHostCatalog, sharedSelection, sharedSourceReady, sharedSourceLabel, type ModelHostSource } from "@/lib/origin-model-hosts";
import { approvalModeFor, modelSwitchNeedsAsk } from "../../shared/approval-mode";
import { sameModelSelection } from "../../shared/thread-model";
import { t } from "@/lib/i18n";
import { ConfirmDialog } from "./ConfirmDialog";
import { SharedModelChoices, SharedModelsStatus } from "./SharedModelChoices";

export function RemoteModelPicker({ bot, threadId, updateBotDefault, onChosen, confirmationRef }: { bot: Bot; threadId?: string; updateBotDefault: boolean; onChosen: () => void; confirmationRef?: RefObject<boolean> }) {
  const { state, dispatch } = useStore();
  const catalog = useModelHostCatalog(bot, true);
  const [pending, setPending] = useState<{ selection: ModelSelection; source: ModelHostSource } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => () => { if (confirmationRef) confirmationRef.current = false; }, [confirmationRef]);
  useEffect(() => { if (!catalog.ready) { setPending(null); if (confirmationRef) confirmationRef.current = false; } }, [catalog.ready, confirmationRef]);
  const clear = () => { setPending(null); if (confirmationRef) confirmationRef.current = false; };
  if (!bot.shared || !catalog.ready) return null;
  const confirm = () => {
    if (!pending || bot.busy) return;
    const source = catalog.sources.find(candidate => candidate.hostId === pending.source.hostId && candidate.sourceId === pending.source.sourceId);
    if (!source || !sharedSourceReady(source) || !source.models.includes(pending.selection.model)) { setError(t("modelHost.changed")); clear(); void catalog.reload(); return; }
    const profile = state.bots.find(candidate => candidate.id === bot.id) ?? bot;
    const targets = updateBotDefault ? [currentTaskBot(profile, threadId ?? bot.threadId), profile] : [bot];
    const resetApprovalToAsk = targets.some(target => modelSwitchNeedsAsk(approvalModeFor(target), state.instances.find(instance => instance.instanceId === target.modelSelection.instanceId)?.driverKind, undefined));
    dispatch({ type: "setModel", botId: bot.id, threadId: threadId ?? bot.threadId, updateBotDefault, selection: sharedSelection(source, pending.selection.model), ...(resetApprovalToAsk ? { resetApprovalToAsk: true } : {}) });
    clear(); onChosen();
  };
  return <section data-remote-model-picker className="shrink-0 border-t border-hairline/40 px-3 py-2">
    <details>
      <summary className="cursor-pointer text-[12px] font-medium text-ink-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">{t("modelHost.title")}</summary>
      <div className="mt-2 grid max-h-[min(20rem,45dvh)] min-w-0 gap-2 overflow-y-auto">
        <SharedModelsStatus {...catalog} count={catalog.sources.length} />
        {!!catalog.sources.length && <SharedModelChoices sources={catalog.sources} paidAllowed disabled={Boolean(bot.busy)} excluded={[bot.modelSelection]}
          actionLabel={t("modelHost.use")} onChoose={(selection, source) => { if (!sameModelSelection(selection, bot.modelSelection)) { setError(""); if (confirmationRef) confirmationRef.current = true; setPending({ selection, source }); } }} />}
        <p className="text-[11px] leading-relaxed text-ink-secondary">{t("modelHost.approvals")}</p>
        {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
      </div>
    </details>
    <ConfirmDialog open={pending !== null} title={t("modelHost.confirmTitle")}
      body={pending ? t(pending.source.billing === "metered" ? "modelHost.confirmMetered" : "modelHost.confirmPlan", { source: sharedSourceLabel(pending.source), model: pending.selection.model }) : ""}
      tone="neutral" confirmLabel={t("modelHost.use")} onCancel={clear} onConfirm={confirm} />
  </section>;
}
