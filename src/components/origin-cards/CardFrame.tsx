import type { ReactNode } from "react";
import { ArrowUpRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { useCanOpenOriginProject } from "@/lib/origin-issue-focus";
import { useOpenOriginItem, type ItemFocus } from "@/lib/origin-item-focus";

export const cardText = { title: "truncate text-[13px] font-semibold text-ink", meta: "truncate text-[12px] text-ink-tertiary" } as const;
export const rowButton = "flex w-full min-w-0 items-center gap-2.5 rounded-xl px-2 py-1.5 text-left outline-none transition-colors duration-(--motion-fast) hover:bg-raised/60 focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-default disabled:hover:bg-transparent";
export const smallButton = "inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium outline-none transition-[background-color,color,opacity] duration-(--motion-fast) focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-50";
export const quietButton = cn(smallButton, "border border-hairline/60 text-ink-secondary hover:bg-raised hover:text-ink");
export const solidButton = cn(smallButton, "bg-accent text-accent-ink hover:opacity-90");

export const UNLINKED = "No project in this app is linked to this Origin project";

export function useItemOpener(projectId: string): { openable: boolean; title?: string; open(target: Omit<ItemFocus, "projectId">): void } {
  const openable = useCanOpenOriginProject(projectId);
  const openItem = useOpenOriginItem();
  return { openable, ...(openable ? {} : { title: UNLINKED }), open: (target) => { if (openable) openItem({ projectId, ...target }); } };
}

export function CardFrame({ kind, label, icon: Icon, iconClassName, title, titleHint, meta, openLabel, onOpen, openIcon: OpenIcon = ArrowUpRight, openable = true, wide, data, children }: {
  kind: string;
  label: string;
  icon: LucideIcon;
  iconClassName?: string;
  title: ReactNode;
  titleHint?: string;
  meta?: ReactNode;
  openLabel?: string;
  onOpen?(): void;
  openIcon?: LucideIcon;
  openable?: boolean;
  wide?: boolean;
  data?: Record<`data-${string}`, string | undefined>;
  children?: ReactNode;
}) {
  return (
    <section data-origin-card={kind} {...data} aria-label={label} className={cn("w-full rounded-2xl bg-inset/50 p-3 motion-safe:animate-pop-in", wide ? "max-w-[30rem]" : "max-w-[26rem]")}>
      <header className="flex items-start gap-2.5">
        <Icon size={16} className={cn("mt-0.5 shrink-0", iconClassName ?? "text-accent-text")} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className={cardText.title} title={titleHint}>{title}</div>
          {meta ? <div className={cardText.meta}>{meta}</div> : null}
        </div>
        {onOpen && openLabel ? (
          <button type="button" onClick={onOpen} disabled={!openable} aria-label={openLabel} title={openable ? openLabel : UNLINKED}
            className="shrink-0 rounded-md p-1 text-ink-tertiary outline-none transition-colors duration-(--motion-fast) hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-40 disabled:hover:bg-transparent">
            <OpenIcon size={14} aria-hidden="true" />
          </button>
        ) : null}
      </header>
      {children}
    </section>
  );
}

export function More({ count, where }: { count?: number; where: string }) {
  return count ? <p className="pt-1.5 text-[12px] text-ink-tertiary">{count} more in {where}</p> : null;
}

export const dateTime = (at: number) => new Date(at).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
