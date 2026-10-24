import { useEffect, useState } from "react";
import { ChevronRight, Check } from "lucide-react";
import type { Message } from "@/state/store";
import { cn } from "@/lib/cn";
import { describeRun } from "@/lib/activity-runs";
import { t } from "@/lib/i18n";
import { useAdvancedMode } from "@/lib/interface-mode";
import { toolStepLabel } from "@/lib/tool-step-label";

const RUN_TOGGLE =
  "flex min-w-0 max-w-full items-center gap-2 rounded-lg border border-hairline/40 bg-panel/70 px-2.5 py-1 text-[12.5px] text-ink-secondary transition-colors hover:bg-control/60 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

export function ActivityRun({
  messages,
  forceOpen = false,
  children,
}: {
  messages: Message[];
  forceOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(forceOpen);
  const advanced = useAdvancedMode();
  const summary = advanced ? describeRun(messages) : describeRun(messages, toolStepLabel);
  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);
  if (open) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex min-w-0 justify-start">
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-expanded
            className={cn(RUN_TOGGLE, "text-ink")}
          >
            <ChevronRight size={13} className="shrink-0 rotate-90 transition-transform" />
            <span className="min-w-0 truncate font-medium leading-5">{summary}</span>
          </button>
        </div>
        <div data-activity-run-steps className="ml-[13px] flex flex-col gap-1.5 border-l border-hairline/50 pl-3">
          {children}
        </div>
      </div>
    );
  }
  return (
    <div className="flex min-w-0 justify-start">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={false}
        title={t("chat.run.showSteps")}
        className={RUN_TOGGLE}
      >
        <Check size={13} className="shrink-0 text-success" />
        <span className="min-w-0 max-w-[480px] truncate font-medium leading-5">{summary}</span>
        <ChevronRight size={13} className="shrink-0 opacity-70" />
      </button>
    </div>
  );
}
