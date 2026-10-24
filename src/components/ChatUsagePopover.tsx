import { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, Gauge, X } from "lucide-react";
import { useStore, type Bot, type InstanceInfo, type Message } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { formatTokens, usageDetail } from "@/lib/usage";
import { compactedSinceReading } from "@/lib/context-warning";
import { setChatContextDetails, setChatUsageOpen, useChatContextDetails, useChatUsageOpen } from "@/lib/chat-usage-preferences";
import { PlanUsage } from "./PlanUsage";

export function chatUsagePosition(header: { bottom: number; right: number; left: number }, viewport: { width: number; height: number }) {
  const width = Math.max(0, Math.min(320, viewport.width - 16, header.right - header.left - 16));
  const left = Math.max(8, Math.min(header.right - width - 8, viewport.width - width - 8));
  const top = Math.max(8, Math.min(header.bottom + 8, viewport.height - 96));
  return { left, top, width, maxHeight: Math.max(80, viewport.height - top - 8) };
}

export function chatContextReading(bot: Bot, messages: readonly Message[], instances: readonly InstanceInfo[]) {
  const usage = bot.tasks?.find(task => task.threadId === bot.threadId)?.usage;
  const reading = usage?.context;
  const stale = compactedSinceReading(messages);
  const tokens = !stale && typeof reading?.tokens === "number" && Number.isFinite(reading.tokens) && reading.tokens >= 0 ? reading.tokens : undefined;
  const reportedWindow = !stale && typeof reading?.window === "number" && Number.isFinite(reading.window) && reading.window > 0 ? reading.window : undefined;
  const catalogWindow = instances.find(instance => instance.instanceId === bot.modelSelection.instanceId)?.models?.options.find(model => model.id === bot.modelSelection.model)?.contextWindow;
  const window = reportedWindow ?? (typeof catalogWindow === "number" && Number.isFinite(catalogWindow) && catalogWindow > 0 ? catalogWindow : undefined);
  const percent = tokens !== undefined && window ? Math.min(100, Math.round(tokens / window * 100)) : undefined;
  return { usage, stale, tokens, window, reported: reportedWindow !== undefined, percent };
}

function contextTone(percent: number): string {
  return percent >= 95 ? "text-danger" : percent >= 80 ? "text-warning" : "text-accent";
}

export function ContextRing({ percent }: { percent: number }) {
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  return <svg aria-hidden="true" width={18} height={18} viewBox="0 0 18 18" className="-rotate-90">
    <circle cx={9} cy={9} r={radius} fill="none" strokeWidth={2} stroke="currentColor" opacity={0.35} />
    <circle cx={9} cy={9} r={radius} fill="none" strokeWidth={2} strokeLinecap="round" stroke="currentColor"
      strokeDasharray={circumference} strokeDashoffset={circumference * (1 - Math.max(percent, 2) / 100)}
      className={cn("transition-[stroke-dashoffset] duration-500", contextTone(percent))} />
  </svg>;
}

export function ChatContextDetails({ bot, messages }: { bot: Bot; messages: readonly Message[] }) {
  const { state } = useStore();
  const expanded = useChatContextDetails();
  const { usage, stale, tokens, window, reported, percent } = chatContextReading(bot, messages, state.instances);
  return <section aria-label={t("chatUsage.context")} className="grid gap-2">
    <div className="flex min-w-0 items-baseline justify-between gap-3">
      <span className="text-[12px] font-medium text-ink">{t("chatUsage.context")}</span>
      <span className="whitespace-nowrap text-[11.5px] tabular-nums text-ink-secondary">{tokens === undefined ? t("chatUsage.notReported") : window ? `${formatTokens(tokens)} / ${formatTokens(window)} · ${percent}%` : formatTokens(tokens)}</span>
    </div>
    {percent !== undefined && <div role="meter" aria-label={t("chatUsage.context")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-1.5 overflow-hidden rounded-full bg-inset">
      <div className={cn("h-full rounded-full bg-current transition-[width] duration-500", contextTone(percent))} style={{ width: `${Math.max(percent, 1)}%` }} />
    </div>}
    <details open={expanded} onToggle={event => setChatContextDetails(event.currentTarget.open)} className="group/context">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded text-[11.5px] text-ink-secondary hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus [&::-webkit-details-marker]:hidden"><ChevronRight size={12} aria-hidden="true" className="transition-transform group-open/context:rotate-90" />{t("chatUsage.contextDetails")}</summary>
      <dl className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-[12px] text-ink-secondary">
        <dt>{t("chatUsage.contextUsed")}</dt><dd className="tabular-nums">{tokens === undefined ? t("chatUsage.notReported") : formatTokens(tokens)}</dd>
        <dt>{t(reported ? "chatUsage.reportedWindow" : "chatUsage.catalogWindow")}</dt><dd className="tabular-nums">{window === undefined ? t("chatUsage.notReported") : formatTokens(window)}</dd>
      </dl>
      <p className="mt-2 text-[11.5px] leading-relaxed text-ink-secondary">{t(stale ? "chatUsage.afterCompaction" : "chatUsage.readingHelp")}</p>
      {usage && <p className="mt-1 text-[11.5px] leading-relaxed text-ink-secondary">{usageDetail(usage)}</p>}
    </details>
  </section>;
}

export function ChatUsagePopover({ bot, messages }: { bot: Bot; messages: readonly Message[] }) {
  const open = useChatUsageOpen();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<ReturnType<typeof chatUsagePosition> | null>(null);
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const button = trigger.current;
    const header = button.closest<HTMLElement>('[data-glass-bar="top"]') ?? button;
    const update = () => {
      const triggerBounds = button.getBoundingClientRect();
      const visibility = window.getComputedStyle(button).visibility;
      if (!button.isConnected || !button.getClientRects().length || triggerBounds.width <= 0 || triggerBounds.height <= 0 || visibility === "hidden" || visibility === "collapse") {
        setPosition(null);
        return;
      }
      const bounds = header.getBoundingClientRect();
      const main = button.closest("main")?.getBoundingClientRect() ?? bounds;
      const next = chatUsagePosition({ bottom: bounds.bottom, left: main.left, right: main.right }, { width: window.innerWidth, height: window.innerHeight });
      setPosition(current => current && Object.keys(next).every(key => current[key as keyof typeof next] === next[key as keyof typeof next]) ? current : next);
    };
    update();
    const observer = new ResizeObserver(update); observer.observe(header); observer.observe(button);
    window.addEventListener("resize", update); window.addEventListener("scroll", update, true);
    return () => { observer.disconnect(); window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [open, bot.id, bot.threadId]);
  const { state } = useStore();
  const { percent } = chatContextReading(bot, messages, state.instances);
  const close = () => { setChatUsageOpen(false); trigger.current?.focus(); };
  return <>
    <button ref={trigger} type="button" aria-label={t("chatUsage.toggle")} aria-expanded={open} aria-controls={id} aria-haspopup="dialog" onClick={() => setChatUsageOpen(!open)} onKeyDown={event => { if (open && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } }}
      title={percent === undefined ? t("chatUsage.toggle") : t("chatUsage.contextPercent", { percent })} data-context-percent={percent}
      className={cn("flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-full transition-colors hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus", percent !== undefined && "px-2 @max-4xl/chathead:px-0", open ? "bg-raised text-accent" : "text-ink-secondary hover:text-ink")}>
      {percent === undefined ? <Gauge size={17} /> : <><ContextRing percent={percent} /><span aria-hidden="true" className="text-[12px] font-medium tabular-nums @max-4xl/chathead:hidden">{percent}%</span></>}
    </button>
    {open && position && createPortal(<aside id={id} role="dialog" aria-label={t("chatUsage.title")} aria-modal="false" onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } }}
      data-chat-usage-popover style={position} className="animate-pop-in fixed z-[45] flex min-w-0 flex-col gap-3.5 overflow-y-auto rounded-2xl border border-hairline/50 bg-menu p-4">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold text-ink">{t("chatUsage.title")}</h2>
          <p className="mt-0.5 truncate font-mono text-[11px] text-ink-secondary" title={bot.modelSelection.model}>{bot.modelSelection.model}</p>
        </div>
        <button type="button" aria-label={t("common.close")} onClick={close} className="-mr-1 -mt-1 shrink-0 rounded-full p-1.5 text-ink-secondary hover:bg-control hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"><X size={13} /></button>
      </div>
      <ChatContextDetails bot={bot} messages={messages} />
      <div className="border-t border-hairline/40 pt-3.5"><PlanUsage key={bot.modelSelection.instanceId} providerId={bot.modelSelection.instanceId} compact /></div>
    </aside>, document.body)}
  </>;
}
