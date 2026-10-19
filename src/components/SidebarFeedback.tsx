import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

export function SidebarFeedback({ feedback, onUndo }: {
  feedback: { error: boolean; text: string };
  onUndo?: () => void;
}) {
  return createPortal(
    <div
      role="status"
      className={cn(
        "fixed bottom-4 left-4 z-[60] max-w-[300px] rounded-xl border px-3.5 py-2.5 text-[13px] shadow-xl",
        feedback.error
          ? "border-danger/30 bg-card text-danger"
          : "border-hairline/50 bg-card text-ink",
      )}
    >
      <div className="flex items-center gap-3">
        <span>{feedback.text}</span>
        {onUndo && (
          <button
            onClick={onUndo}
            className="rounded-md px-1.5 py-0.5 font-medium text-accent hover:bg-raised"
          >
            {t("common.undo")}
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
