import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { ChevronRight, Gauge, X } from "lucide-react";
import { useStore, type Bot, type InstanceInfo, type Message } from "@/state/store";
import { cn } from "@/lib/cn";
import { COMPOSER_TOOL_ACTIVE, COMPOSER_TOOL_SHAPE } from "@/lib/composer-tool";
import { t } from "@/lib/i18n";
import { formatTokens, usageDetail } from "@/lib/usage";
import { compactedSinceReading, threadContextWarning } from "@/lib/context-warning";
import { setChatContextDetails, setChatUsageOpen, useChatContextDetails, useChatUsageOpen } from "@/lib/chat-usage-preferences";
import { useSpaceAbove } from "@/hooks/use-space-above";
import { useCompact } from "./ContextWarning";
import { PlanUsage } from "./PlanUsage";

const PEEK_OPEN_MS = 280;
const PEEK_CLOSE_MS = 180;

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

export function contextTone(percent: number): string {
  return percent >= 95 ? "text-danger" : percent >= 80 ? "text-warning" : "text-accent";
}

export function ContextRing({ percent, size = 18 }: { percent: number; size?: number }) {
  const center = size / 2;
  const wedge = size / 2 - 3.5;
  const circumference = 2 * Math.PI * (wedge / 2);
  return <svg aria-hidden="true" width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={cn("-rotate-90", percent >= 80 ? contextTone(percent) : "text-ink-secondary")}>
    <circle cx={center} cy={center} r={center - 0.75} fill="none" strokeWidth={1.5} stroke="currentColor" opacity={0.45} />
    <circle cx={center} cy={center} r={wedge / 2} fill="none" strokeWidth={wedge} stroke="currentColor"
      strokeDasharray={`${circumference * Math.max(percent, 4) / 100} ${circumference}`}
      className="transition-[stroke-dasharray] duration-500" />
  </svg>;
}

export function ChatContextDetails({ bot, messages }: { bot: Bot; messages: readonly Message[] }) {
  const { state } = useStore();
  const expanded = useChatContextDetails();
  const { usage, stale, tokens, window, reported, percent } = chatContextReading(bot, messages, state.instances);
  const warning = threadContextWarning(usage, messages);
  const { pending, run } = useCompact();
  return <section aria-label={t("chatUsage.context")} className="grid gap-2">
    <div className="flex min-w-0 items-baseline justify-between gap-3">
      <h3 className="text-[12.5px] font-medium text-ink">{t("chatUsage.context")}</h3>
      <span className={cn("whitespace-nowrap text-[13px] font-semibold tabular-nums", percent === undefined ? "font-normal text-ink-tertiary" : percent >= 80 ? contextTone(percent) : "text-ink")}>
        {percent === undefined ? t("chatUsage.notReported") : `${percent}%`}
      </span>
    </div>
    {percent !== undefined && <div role="meter" aria-label={t("chatUsage.context")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-1.5 overflow-hidden rounded-full bg-inset">
      <div className={cn("h-full rounded-full bg-current transition-[width] duration-500", contextTone(percent))} style={{ width: `${Math.max(percent, 1.5)}%` }} />
    </div>}
    <div className="flex min-w-0 items-baseline justify-between gap-3 text-[11.5px]">
      <span className="whitespace-nowrap tabular-nums text-ink-secondary">
        {tokens === undefined ? (stale ? t("chatUsage.afterCompaction") : t("chatUsage.notReported"))
          : window ? t("chatUsage.tokensOf", { used: formatTokens(tokens), limit: formatTokens(window) }) : t("chatUsage.tokens", { used: formatTokens(tokens) })}
      </span>
      <span className="min-w-0 truncate font-mono text-[11px] text-ink-tertiary" title={bot.modelSelection.model}>{bot.modelSelection.model}</span>
    </div>
    {warning && <div role="status" className="mt-1 flex items-start gap-3 rounded-xl bg-warning/10 px-3 py-2.5">
      <p className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-ink-secondary">{t("contextWarning.threadHint", { name: bot.name, percent: warning.percent })}</p>
      <button type="button" disabled={Boolean(bot.busy) || pending} onClick={() => run(`/api/bots/${bot.id}/compact`, { threadId: bot.threadId })}
        title={bot.busy ? t("contextWarning.busy") : undefined}
        className="ui-button ui-button-sm shrink-0 rounded-full">
        {pending ? t("contextWarning.compacting") : t("contextWarning.compactNow")}
      </button>
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

function useShown(trigger: RefObject<HTMLElement | null>, active: boolean) {
  const [shown, setShown] = useState(false);
  useLayoutEffect(() => {
    const element = trigger.current;
    if (!active || !element) { setShown(false); return; }
    const update = () => {
      const visibility = window.getComputedStyle(element).visibility;
      setShown(element.isConnected && element.getClientRects().length > 0 && visibility !== "hidden" && visibility !== "collapse");
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(element);
    window.addEventListener("resize", update);
    return () => { observer?.disconnect(); window.removeEventListener("resize", update); };
  }, [trigger, active]);
  return shown;
}

export function ChatUsagePopover({ bot, messages }: { bot: Bot; messages: readonly Message[] }) {
  const pinned = useChatUsageOpen();
  const [peek, setPeek] = useState(false);
  const open = pinned || peek;
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const shown = useShown(trigger, open);
  const space = useSpaceAbove(open && shown, trigger, 560);
  const { state } = useStore();
  const { percent, stale } = chatContextReading(bot, messages, state.instances);
  const alert = percent !== undefined && percent >= 80 && !stale;
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const hover = (next: boolean) => (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    window.clearTimeout(timer.current);
    if (next === peek) return;
    timer.current = window.setTimeout(() => setPeek(next), next ? PEEK_OPEN_MS : PEEK_CLOSE_MS);
  };
  const close = () => { window.clearTimeout(timer.current); setPeek(false); setChatUsageOpen(false); trigger.current?.focus(); };
  const closeOnEscape = (event: KeyboardEvent) => {
    if (!open || event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };
  return <div className="flex shrink-0" onPointerEnter={hover(true)} onPointerLeave={hover(false)}>
    <button ref={trigger} type="button" aria-label={t("chatUsage.toggle")} aria-expanded={open && shown} aria-controls={id} aria-haspopup="dialog"
      onClick={() => { window.clearTimeout(timer.current); setPeek(false); setChatUsageOpen(!pinned); }} onKeyDown={closeOnEscape}
      title={percent === undefined ? t("chatUsage.toggle") : t("chatUsage.contextPercent", { percent })} data-context-percent={percent}
      className={cn(COMPOSER_TOOL_SHAPE, "min-w-8 gap-1", alert ? "pl-1.5 pr-2" : "w-8", open && COMPOSER_TOOL_ACTIVE)}>
      {percent === undefined ? <Gauge size={16} aria-hidden="true" /> : <ContextRing percent={percent} />}
      {alert && <span aria-hidden="true" className={cn("text-[12px] font-semibold tabular-nums", contextTone(percent))}>{percent}%</span>}
    </button>
    {open && shown && <aside id={id} role="dialog" aria-label={t("chatUsage.title")} aria-modal="false" onKeyDown={closeOnEscape}
      data-chat-usage-popover style={{ maxHeight: space }}
      className="animate-pop-in absolute bottom-full right-0 z-30 mb-2 flex w-[min(21rem,100%)] origin-bottom-right flex-col gap-4 overflow-y-auto overscroll-contain rounded-2xl border border-hairline/60 bg-menu p-4">
      <div className="-mb-1 flex min-w-0 items-center justify-between gap-2">
        <h2 className="text-[13px] font-semibold text-ink">{t("chatUsage.title")}</h2>
        <button type="button" aria-label={t("common.close")} onClick={close} className="-mr-1.5 shrink-0 rounded-full p-1.5 text-ink-secondary hover:bg-control hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"><X size={13} aria-hidden="true" /></button>
      </div>
      <ChatContextDetails bot={bot} messages={messages} />
      <div className="border-t border-hairline/40 pt-4"><PlanUsage key={bot.modelSelection.instanceId} providerId={bot.modelSelection.instanceId} compact /></div>
    </aside>}
  </div>;
}
