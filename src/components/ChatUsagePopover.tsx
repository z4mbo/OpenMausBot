import { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Gauge, X } from "lucide-react";
import { useStore, type Bot, type Message } from "@/state/store";
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

export function ChatContextDetails({ bot, messages }: { bot: Bot; messages: readonly Message[] }) {
  const { state } = useStore();
  const expanded = useChatContextDetails();
  const usage = bot.tasks?.find(task => task.threadId === bot.threadId)?.usage;
  const reading = usage?.context;
  const stale = compactedSinceReading(messages);
  const tokens = !stale && typeof reading?.tokens === "number" && Number.isFinite(reading.tokens) && reading.tokens >= 0 ? reading.tokens : undefined;
  const reportedWindow = !stale && typeof reading?.window === "number" && Number.isFinite(reading.window) && reading.window > 0 ? reading.window : undefined;
  const catalogWindow = state.instances.find(instance => instance.instanceId === bot.modelSelection.instanceId)?.models.options.find(model => model.id === bot.modelSelection.model)?.contextWindow;
  const window = reportedWindow ?? (typeof catalogWindow === "number" && Number.isFinite(catalogWindow) && catalogWindow > 0 ? catalogWindow : undefined);
  return <details open={expanded} onToggle={event => setChatContextDetails(event.currentTarget.open)} className="border-t border-hairline/40 pt-2.5">
    <summary className="cursor-pointer rounded text-[12px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"><span>{t("chatUsage.context")}</span><span className="float-right ml-2 tabular-nums text-ink-secondary">{tokens === undefined ? t("chatUsage.notReported") : window ? `${formatTokens(tokens)} / ${formatTokens(window)} · ${Math.round(tokens / window * 100)}%` : formatTokens(tokens)}</span></summary>
    <dl className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-[12px] text-ink-secondary">
      <dt>{t("chatUsage.contextUsed")}</dt><dd className="tabular-nums">{tokens === undefined ? t("chatUsage.notReported") : formatTokens(tokens)}</dd>
      <dt>{t(reportedWindow ? "chatUsage.reportedWindow" : "chatUsage.catalogWindow")}</dt><dd className="tabular-nums">{window === undefined ? t("chatUsage.notReported") : formatTokens(window)}</dd>
    </dl>
    <p className="mt-2 text-[12px] leading-relaxed text-ink-secondary">{t(stale ? "chatUsage.afterCompaction" : "chatUsage.readingHelp")}</p>
    {usage && <p className="mt-1 text-[12px] leading-relaxed text-ink-secondary">{usageDetail(usage)}</p>}
  </details>;
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
  const close = () => { setChatUsageOpen(false); trigger.current?.focus(); };
  return <>
    <button ref={trigger} type="button" aria-label={t("chatUsage.toggle")} aria-expanded={open} aria-controls={id} aria-haspopup="dialog" onClick={() => setChatUsageOpen(!open)} onKeyDown={event => { if (open && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } }}
      className={cn("rounded-md p-1.5 hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus", open ? "text-accent" : "text-ink-secondary hover:text-ink")}><Gauge size={18} /></button>
    {open && position && createPortal(<aside id={id} role="dialog" aria-label={t("chatUsage.title")} aria-modal="false" onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } }}
      data-chat-usage-popover style={position} className="fixed z-[45] flex min-w-0 flex-col gap-2 overflow-y-auto rounded-xl border border-hairline/60 bg-menu p-3">
      <div className="flex min-w-0 items-center justify-between gap-2"><span className="min-w-0 truncate text-[12px] font-medium text-ink" title={bot.modelSelection.model}>{bot.modelSelection.model}</span><button type="button" aria-label={t("common.close")} onClick={close} className="shrink-0 rounded p-1 text-ink-secondary hover:bg-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"><X size={13} /></button></div>
      <PlanUsage key={bot.modelSelection.instanceId} providerId={bot.modelSelection.instanceId} compact />
      <ChatContextDetails bot={bot} messages={messages} />
    </aside>, document.body)}
  </>;
}
