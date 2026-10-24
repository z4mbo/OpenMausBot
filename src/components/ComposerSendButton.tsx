import { ArrowUp, Clock, Square } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

const ROUND = "flex size-8 shrink-0 items-center justify-center rounded-full transition-[filter,background-color,color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-composer";

export function ComposerSendButton({ busy, canSteer, hasContent, attachmentPending, sendLabel, onSend, onStop }: {
  busy: boolean;
  canSteer: boolean;
  hasContent: boolean;
  attachmentPending: boolean;
  sendLabel: string;
  onSend: () => void;
  onStop?: () => void;
}) {
  if (onStop && !hasContent) {
    return (
      <button type="button" data-composer-stop onClick={onStop} aria-label={t("chat.stopTurn")} title={t("chat.stopTurn")}
        className={cn(ROUND, "bg-accent text-accent-ink hover:brightness-110")}>
        <Square size={12} className="fill-current" aria-hidden="true" />
      </button>
    );
  }
  const queue = busy && !canSteer;
  return (
    <>
      {onStop && (
        <button type="button" data-composer-stop onClick={onStop} aria-label={t("chat.stopTurn")} title={t("chat.stopTurn")}
          className={cn(ROUND, "text-ink-secondary hover:bg-ink/[0.07] hover:text-ink")}>
          <Square size={12} className="fill-current" aria-hidden="true" />
        </button>
      )}
      <button
        type="button"
        data-composer-send
        onClick={onSend}
        disabled={!hasContent || attachmentPending}
        aria-label={busy && canSteer ? t("composer.send.steer") : queue ? t("composer.send.queue") : t("composer.send.message")}
        title={busy && canSteer ? t("composer.send.steer") : queue ? t("composer.send.queueHint") : `${t("chat.send")} (${sendLabel})`}
        className={cn(
          ROUND,
          "disabled:cursor-not-allowed",
          !hasContent ? "bg-ink/[0.07] text-ink-tertiary"
            : queue ? "bg-raised-hover text-ink hover:brightness-105"
            : "bg-accent text-accent-ink hover:brightness-110 disabled:opacity-60 disabled:hover:brightness-100",
        )}
      >
        {queue && hasContent ? <Clock size={15} aria-hidden="true" /> : <ArrowUp size={17} strokeWidth={2.25} aria-hidden="true" />}
      </button>
    </>
  );
}
