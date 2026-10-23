import { cn } from "@/lib/cn";
import { CAMPAIGN_STATUS_LABEL, type CampaignStatus } from "../../../shared/origin-campaigns";

const STATUS_TONE: Record<CampaignStatus, string> = { planning: "bg-raised text-ink-secondary", running: "bg-accent/15 text-accent-text", done: "bg-success/15 text-success" };

export function CampaignStatusPill({ status, className }: { status: CampaignStatus; className?: string }) {
  return <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", STATUS_TONE[status], className)}>{CAMPAIGN_STATUS_LABEL[status]}</span>;
}

/** Published posts out of all linked posts, as a thin bar with its count. */
export function CampaignProgress({ published, posts, className }: { published: number; posts: number; className?: string }) {
  const share = posts ? Math.min(1, published / posts) : 0;
  return (
    <span className={cn("flex min-w-0 items-center gap-2", className)}>
      <span className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-raised" role="progressbar" aria-label="Posts published" aria-valuemin={0} aria-valuemax={posts} aria-valuenow={published}>
        <span className="block h-full rounded-full bg-success transition-[width] duration-(--motion-base)" style={{ width: `${share * 100}%` }} />
      </span>
      <span className="shrink-0 text-[11.5px] tabular-nums text-ink-tertiary">{posts ? `${published}/${posts} published` : "No posts yet"}</span>
    </span>
  );
}
