import { FoldVertical, Loader2 } from "lucide-react";
import { useStore, type Bot, type Message } from "@/state/store";
import { cn } from "@/lib/cn";
import { COMPOSER_TOOL_SHAPE } from "@/lib/composer-tool";
import { t } from "@/lib/i18n";
import { useThreadCompaction } from "@/hooks/use-thread-compaction";
import { ChatUsagePopover, chatContextReading, contextTone } from "./ChatUsagePopover";

export const COMPACT_CHIP_PERCENT = 90;

export function ComposerCompactChip({ bot, messages }: { bot: Bot; messages: readonly Message[] }) {
  const { state } = useStore();
  const { percent } = chatContextReading(bot, messages, state.instances);
  const { compacting, blocked, compact } = useThreadCompaction(bot);
  if (percent === undefined || percent < COMPACT_CHIP_PERCENT) return null;
  return <button type="button" data-compact-chip onClick={compact} disabled={blocked || compacting} aria-busy={compacting}
    aria-label={compacting ? t("composer.compact.running") : t("composer.compact.aria", { percent })}
    title={blocked ? t("contextWarning.busy") : t("composer.compact.hint")}
    className={cn(COMPOSER_TOOL_SHAPE, "h-7 gap-1.5 border border-hairline/70 bg-ink/[0.05] px-2.5 text-[12px] font-medium text-ink disabled:cursor-not-allowed",
      blocked && "opacity-60", "@max-[24rem]/composer:w-7 @max-[24rem]/composer:px-0")}>
    {compacting
      ? <Loader2 size={14} aria-hidden="true" className="shrink-0 animate-spin text-ink-secondary" />
      : <FoldVertical size={14} aria-hidden="true" className={cn("shrink-0", contextTone(percent))} />}
    <span className="@max-[24rem]/composer:hidden">{compacting ? t("contextWarning.compacting") : t("composer.compact.chip")}</span>
  </button>;
}

export function ComposerContextTools({ bot, messages }: { bot: Bot; messages: readonly Message[] }) {
  return <>
    <ComposerCompactChip bot={bot} messages={messages} />
    <ChatUsagePopover bot={bot} messages={messages} />
  </>;
}
