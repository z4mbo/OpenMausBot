import { useState } from "react";
import { Lock, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { useCloudLinks, useCloudProjectFor, useCloudWorkspaceFor } from "@/lib/origin-cloud-links";
import { useCloudQuery } from "@/lib/origin-cloud/hooks";
import { cloudMutation, cloudQueryOnce } from "@/lib/origin-cloud/client";
import { shareBotToWorkspace } from "@/lib/origin-shared-agents";
import { useAvatarLooks } from "@/lib/origin-avatar-looks";
import { t } from "@/lib/i18n";
import { api, useStore, type Bot, type Message } from "@/state/store";

const chip = "rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors duration-100";

/** Under another member's row: who sent it, or whose machine and model produced it. */
export function RemoteRowNote({ message }: { message: Message }) {
  const remote = message.remote;
  if (!remote) return null;
  if (message.role === "user") return <div data-remote-sender className="mt-1 text-[11px] text-ink-tertiary">{remote.name}</div>;
  if (message.kind !== "text") return null;
  const label = remote.status === "interrupted"
    ? t("shared.interrupted")
    : remote.model ? t("shared.ranOn", { name: remote.name, model: remote.model }) : t("shared.ranOnComputer", { name: remote.name });
  return <div data-remote-run className="mt-1 text-[11px] text-ink-tertiary">{label}</div>;
}

/** A card raised by another member's run: only they can answer it, on their machine. */
export function RemoteCard({ message }: { message: Message }) {
  const card = message.card;
  if (!card) return null;
  return (
    <div data-remote-card className="rounded-2xl border border-hairline/60 bg-raised px-4 py-3">
      <p className="text-[13.5px] font-medium text-ink">{card.title}</p>
      {card.subtitle && <p className="mt-0.5 line-clamp-3 text-[12.5px] text-ink-secondary">{card.subtitle}</p>}
      <p className="mt-2 text-[12px] text-ink-tertiary">
        {card.answered ?? (card.expired ? null : t("shared.waitingApproval", { name: message.remote?.name ?? "" }))}
      </p>
    </div>
  );
}

function ReviewStrip({ bot }: { bot: Bot }) {
  const review = bot.shared?.review;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!review) return null;
  const answer = async (accept: boolean) => {
    setBusy(true);
    try {
      await api(`/api/bots/${encodeURIComponent(bot.id)}/shared-review`, { method: "POST", body: JSON.stringify({ accept }) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div data-shared-review className="rounded-2xl border border-hairline/60 bg-raised px-4 py-3">
      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 text-[13px] text-ink">{t("shared.review", { name: review.by, bot: bot.name })}</p>
        <button type="button" className={cn(chip, "text-ink-secondary hover:text-ink")} onClick={() => setOpen((value) => !value)}>
          {open ? t("shared.reviewHide") : t("shared.reviewShow")}
        </button>
        <button type="button" disabled={busy} className={cn(chip, "text-ink-secondary hover:text-ink")} onClick={() => void answer(false)}>{t("shared.reviewKeep")}</button>
        <button type="button" disabled={busy} className={cn(chip, "bg-accent text-white")} onClick={() => void answer(true)}>{t("shared.reviewAccept")}</button>
      </div>
      {open && <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-xl bg-sunken px-3 py-2 text-[12px] text-ink-secondary">{review.soul}</pre>}
    </div>
  );
}

/** Above the composer of a shared bot: pending definition review, who holds the thread, privacy of a new thread, and the
 * nudge to set up a model when this member has none. */
export function SharedThreadBar({ bot, empty }: { bot: Bot; empty: boolean }) {
  const { dispatch } = useStore();
  const task = bot.tasks?.find((candidate) => candidate.threadId === bot.threadId);
  if (!bot.shared) return <ShareBotChip bot={bot} />;
  if (!task) return null;
  const run = task.shared?.run;
  const noModel = !bot.modelSelection?.instanceId;
  const setPrivate = (value: boolean) => void api(`/api/bots/${encodeURIComponent(bot.id)}/shared-private`, {
    method: "PUT", body: JSON.stringify({ threadId: task.threadId, private: value }),
  });
  return (
    <div className="pointer-events-auto mx-5 mb-2 grid gap-2 animate-[pop-in_120ms_ease-out]" data-shared-thread>
      <ReviewStrip bot={bot} />
      {noModel && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-hairline/60 bg-raised px-4 py-2.5">
          <p className="text-[13px] text-ink-secondary">{t("shared.setupModel")}</p>
          <button type="button" className={cn(chip, "bg-accent text-white")} onClick={() => dispatch({ type: "toggleWelcome", open: true })}>
            {t("shared.setupModelAction")}
          </button>
        </div>
      )}
      <div className="flex items-center gap-2 px-1 text-[12px] text-ink-tertiary">
        {task.shared ? <Users className="size-3.5" aria-hidden /> : <Lock className="size-3.5" aria-hidden />}
        <span>{task.shared ? t("shared.sharedThread") : t("shared.privateThread")}</span>
        {!task.shared && empty && (
          <button type="button" className="text-ink-secondary underline-offset-2 hover:underline" onClick={() => setPrivate(!task.sharedPrivate)}>
            {task.sharedPrivate ? t("shared.share") : t("shared.keepPrivate")}
          </button>
        )}
        {run && !run.mine && <span data-shared-busy className="ml-auto text-ink-secondary">{t("shared.workingFor", { name: run.by })}</span>}
        {!run?.mine && Boolean(task.shared?.queued) && !run && <span className="ml-auto">{t("shared.waiting", { count: task.shared!.queued! })}</span>}
      </div>
    </div>
  );
}

/** Offered on a private bot whose project team lives in a workspace that shares its agents. */
function ShareBotChip({ bot }: { bot: Bot }) {
  const { state } = useStore();
  const projectId = useCloudProjectFor(bot);
  const teamId = useCloudWorkspaceFor(bot);
  const links = useCloudLinks();
  const looks = useAvatarLooks();
  const settings = useCloudQuery<{ sharedAgents: boolean }>("agents:teamSettings", teamId && projectId ? { teamId } : "skip");
  const [status, setStatus] = useState<"idle" | "busy" | { error: string }>("idle");
  if (!settings?.sharedAgents || !projectId || !teamId || bot.hidden || links.projects[bot.id]) return null;
  const share = async () => {
    setStatus("busy");
    try {
      const team = state.bots.filter((candidate) => candidate.section?.trim() && candidate.section.trim() === bot.section?.trim());
      await shareBotToWorkspace({
        cloud: { query: (name, args) => cloudQueryOnce(name, args), mutation: (name, args) => cloudMutation(name, args) },
        call: (path, init) => api(path, init), looks,
        driverKindOf: (instanceId) => state.instances.find((instance) => instance.instanceId === instanceId)?.driverKind,
      }, bot, { teamId, projectId }, team);
      setStatus("idle");
    } catch (error) {
      setStatus({ error: error instanceof Error ? error.message : String(error) });
    }
  };
  return (
    <div className="pointer-events-auto mx-5 mb-2 flex items-center gap-2 px-1 text-[12px] text-ink-tertiary" data-share-bot>
      <Users className="size-3.5" aria-hidden />
      <button type="button" disabled={status === "busy"} className="text-ink-secondary underline-offset-2 hover:underline" onClick={() => void share()}>
        {t("shared.shareBot")}
      </button>
      {typeof status === "object" && <span className="text-danger">{t("shared.shareFailed", { error: status.error })}</span>}
    </div>
  );
}
