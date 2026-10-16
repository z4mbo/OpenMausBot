import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

export function UnreadBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span aria-label={`${count} ${t("task.unreadMany")}`} data-unread-badge={count}
      className={cn("inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-accent px-1 text-[10.5px] font-semibold leading-none text-white tabular-nums", className)}>
      {count > 99 ? "99+" : count}
    </span>
  );
}
