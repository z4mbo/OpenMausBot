import { Crown } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

/** The mark beside a project's name: a crown for now, the project's own favicon once Origin supplies one. */
export function ProjectMark({ iconUrl, size = 13, className }: { iconUrl?: string; size?: number; className?: string }) {
  const label = t("sidebar.bot.chiefOfStaff");
  if (iconUrl) return <img src={iconUrl} alt={label} width={size} height={size} className={cn("shrink-0 rounded-sm", className)} />;
  return (
    <Crown size={size} strokeWidth={2.25} className={cn("shrink-0 text-accent", className)} role="img" aria-label={label} data-testid="chief-crown">
      <title>{label}</title>
    </Crown>
  );
}
