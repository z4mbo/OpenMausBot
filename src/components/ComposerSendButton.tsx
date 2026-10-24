import { ArrowUp, Clock } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

export function ComposerSendButton({ busy, canSteer, attachmentPending, sendLabel, onSend }: {
  busy: boolean;
  canSteer: boolean;
  attachmentPending: boolean;
  sendLabel: string;
  onSend: () => void;
}) {
  return (
    <button
      onClick={onSend}
      disabled={attachmentPending}
      aria-label={
        busy && canSteer
          ? t("composer.send.steer")
          : busy
            ? t("composer.send.queue")
            : t("composer.send.message")
      }
      title={
        busy && canSteer
          ? t("composer.send.steer")
          : busy
            ? t("composer.send.queueHint")
            : `${t("chat.send")} (${sendLabel})`
      }
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full transition-[filter,background-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-composer",
        busy && !canSteer
          ? "bg-raised text-ink-secondary hover:bg-raised-hover"
          : "bg-accent text-accent-ink hover:brightness-110",
      )}
    >
      {busy && !canSteer ? <Clock size={15} /> : <ArrowUp size={17} />}
    </button>
  );
}
