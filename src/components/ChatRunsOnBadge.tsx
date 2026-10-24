import { Cloud } from "lucide-react";
import { t } from "@/lib/i18n";

/** Whose machine or cloud runs this agent, shown in the chat header beside the computer button. */
export interface ChatRunsOn {
  name: string;
  avatarUrl?: string | null;
  via: "subscription" | "cloud";
  /** The subscription's plan name, such as "Claude Max"; shown instead of the generic label when present. */
  plan?: string | null;
}

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

export function ChatRunsOnBadge({ runsOn }: { runsOn?: ChatRunsOn | null }) {
  if (!runsOn?.name.trim()) return null;
  const via = runsOn.via === "cloud" ? t("chat.runsOn.cloud") : runsOn.plan?.trim() || t("chat.runsOn.subscription");
  const label = t("chat.runsOn.label", { name: runsOn.name, via });
  return (
    <span
      data-chathead-runs-on
      title={label}
      className="flex h-8 min-w-0 max-w-[14rem] items-center gap-2 rounded-full border border-hairline/50 bg-control/40 pl-1 pr-3 text-[12.5px] text-ink @max-4xl/chathead:size-8 @max-4xl/chathead:justify-center @max-4xl/chathead:p-0"
    >
      {runsOn.avatarUrl ? (
        <img src={runsOn.avatarUrl} alt="" className="size-6 shrink-0 rounded-full object-cover" />
      ) : runsOn.via === "cloud" ? (
        <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-full bg-inset text-ink-secondary"><Cloud size={13} /></span>
      ) : (
        <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-full bg-inset text-[10px] font-semibold text-ink-secondary">{initials(runsOn.name)}</span>
      )}
      <span className="sr-only">{label}</span>
      <span aria-hidden="true" className="flex min-w-0 items-baseline gap-1.5 @max-4xl/chathead:hidden">
        <span className="min-w-0 truncate font-medium">{runsOn.name}</span>
        <span className="shrink-0 text-[11.5px] text-ink-secondary">{via}</span>
      </span>
    </span>
  );
}
