import type { ComponentProps, ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

const VARIANTS = {
  field: "rounded-lg border border-hairline/40 bg-inset text-ink",
  pill: "h-8 rounded-full border border-hairline/40 bg-raised/60 font-medium text-ink hover:bg-raised",
  ghost: "rounded-lg bg-transparent font-medium text-ink-secondary hover:bg-control/70 hover:text-ink",
} as const;

// The 14px chevron draws its stroke ~3.5px inside its box, so the box sits that much nearer the edge than the text's padding.
const SIZES = {
  lg: { select: "py-2.5 pl-3 pr-9 text-[15px]", chevron: "right-2", withIcon: "pl-9", icon: "left-3" },
  md: { select: "py-2 pl-3 pr-9 text-[13px]", chevron: "right-2", withIcon: "pl-8", icon: "left-3" },
  sm: { select: "py-1.5 pl-2.5 pr-8 text-[12.5px]", chevron: "right-1.5", withIcon: "pl-7", icon: "left-2.5" },
} as const;

export function Select({
  className,
  variant = "field",
  size = "md",
  icon,
  ...props
}: Omit<ComponentProps<"select">, "size"> & {
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  icon?: ReactNode;
}) {
  return (
    <div className={cn("relative inline-flex min-w-0", className)}>
      {icon && (
        <span aria-hidden className={cn("pointer-events-none absolute top-1/2 z-[1] flex -translate-y-1/2 text-ink-secondary", SIZES[size].icon)}>
          {icon}
        </span>
      )}
      <select
        {...props}
        className={cn(
          "peer w-full min-w-0 cursor-pointer appearance-none truncate disabled:cursor-default disabled:opacity-50",
          VARIANTS[variant],
          SIZES[size].select,
          icon && SIZES[size].withIcon,
        )}
      />
      <ChevronDown
        size={14}
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-1/2 -translate-y-1/2 text-ink-secondary peer-disabled:opacity-50",
          SIZES[size].chevron,
        )}
      />
    </div>
  );
}
