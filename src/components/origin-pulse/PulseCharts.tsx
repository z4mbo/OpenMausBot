import { useId, useState, type CSSProperties } from "react";
import { cn } from "@/lib/cn";
import { dayLabel } from "./pulse-model";

const STEP = 10;
const HEIGHT = 40;

/** Daily bars with a readout of the day under the pointer or focus, and the same numbers as a table for screen readers. */
export function DayBars({ values, days, label, format = (value) => value.toLocaleString(), color, height = 44, compact = false, className }: {
  values: readonly number[]; days: readonly string[]; label: string; format?(value: number): string; color?: string; height?: number; compact?: boolean; className?: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const table = useId();
  const max = Math.max(...values, 0);
  const total = values.reduce((sum, value) => sum + value, 0);
  const shown = active ?? values.length - 1;
  const bar = values.length > 10 ? 7 : 4;
  const fill: CSSProperties = { fill: color ?? "var(--color-accent)" };
  return (
    <figure className={cn("m-0 flex min-w-0 flex-col gap-1", className)}>
      <figcaption className={cn("flex items-baseline justify-between gap-2 text-[11.5px] text-ink-tertiary", compact && "sr-only")}>
        <span className="truncate">{label}</span>
        <span className="shrink-0 tabular-nums" aria-live="polite">{dayLabel(days[shown] ?? "")} · <span className="text-ink-secondary">{format(values[shown] ?? 0)}</span></span>
      </figcaption>
      <svg viewBox={`0 0 ${values.length * STEP} ${HEIGHT}`} preserveAspectRatio="none" role="img" aria-describedby={table}
        aria-label={`${label}: ${format(total)} over ${values.length} days`} className="block w-full touch-manipulation" style={{ height }}
        onMouseLeave={() => setActive(null)}>
        <line x1={0} x2={values.length * STEP} y1={HEIGHT - 0.5} y2={HEIGHT - 0.5} className="stroke-hairline" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {values.map((value, index) => {
          const h = max ? Math.max(value > 0 ? 2 : 0, (value / max) * (HEIGHT - 2)) : 0;
          return (
            <g key={days[index] ?? index} onMouseEnter={() => setActive(index)} onClick={() => setActive(index)}>
              <title>{`${dayLabel(days[index] ?? "")}: ${format(value)}`}</title>
              <rect x={index * STEP} y={0} width={STEP} height={HEIGHT} fill="transparent" />
              <rect x={index * STEP + (STEP - bar) / 2} y={HEIGHT - h} width={bar} height={h} style={fill}
                className={cn("transition-opacity duration-(--motion-fast) motion-reduce:transition-none", active !== null && active !== index && "opacity-45")} />
            </g>
          );
        })}
      </svg>
      <table id={table} className="sr-only">
        <caption>{label}</caption>
        <tbody>{values.map((value, index) => <tr key={days[index] ?? index}><th scope="row">{dayLabel(days[index] ?? "")}</th><td>{format(value)}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}

/** A count per stage as labelled horizontal bars, longest stage full width. */
export function StageBars({ rows, format, color }: { rows: readonly { stage: string; count: number; value: number }[]; format(value: number): string; color?: string }) {
  const max = Math.max(...rows.map((row) => row.count), 0);
  return (
    <ul className="flex flex-col gap-1.5" aria-label="Leads by stage">
      {rows.map((row) => (
        <li key={row.stage} className="grid grid-cols-[minmax(64px,88px)_1fr_auto] items-center gap-2 text-[12px]">
          <span className="truncate text-ink-secondary">{row.stage}</span>
          <svg viewBox="0 0 100 8" preserveAspectRatio="none" className="block h-2 w-full" aria-hidden="true">
            <rect x={0} y={0} width={100} height={8} rx={2} className="fill-inset" />
            {row.count > 0 && <rect x={0} y={0} width={Math.max(2, (row.count / (max || 1)) * 100)} height={8} rx={2} style={{ fill: color ?? "var(--color-accent)" }} />}
          </svg>
          <span className="text-right tabular-nums text-ink">{row.count.toLocaleString()}{row.value ? <span className="ml-1.5 text-ink-tertiary">{format(row.value)}</span> : null}</span>
        </li>
      ))}
    </ul>
  );
}

/** Spend against a monthly budget; past 80% it turns warning and at 100% danger, always with the numbers as text. */
export function BudgetMeter({ spent, budget, level, format }: { spent: number; budget: number; level: "ok" | "warn" | "over"; format(usd: number): string }) {
  const ratio = Math.min(1, budget ? spent / budget : 0);
  const tone = level === "over" ? "fill-danger" : level === "warn" ? "fill-warning" : "";
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between text-[11.5px] text-ink-tertiary">
        <span>Spend this month</span>
        <span className="tabular-nums"><span className="text-ink">{format(spent)}</span> of {format(budget)}{level === "over" ? " · reached" : level === "warn" ? " · over 80%" : ""}</span>
      </div>
      <svg viewBox="0 0 100 6" preserveAspectRatio="none" className="block h-1.5 w-full" role="img" aria-label={`${format(spent)} of a ${format(budget)} monthly budget`}>
        <rect x={0} y={0} width={100} height={6} rx={2} className="fill-inset" />
        <rect x={0} y={0} width={ratio * 100} height={6} rx={2} className={tone} style={tone ? undefined : { fill: "var(--color-accent)" }} />
        <line x1={80} x2={80} y1={0} y2={6} className="stroke-ink-tertiary" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}
