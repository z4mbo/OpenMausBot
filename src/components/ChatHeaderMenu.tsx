import { useState } from "react";
import { Bug, Copy, Download, Gauge, ListChecks, MoreHorizontal, Search } from "lucide-react";
import { useAdvancedMode } from "@/lib/interface-mode";
import { usageSummary } from "@/lib/chat-usage-summary";
import { useStore, type Bot, type Message } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { copyTranscriptToClipboard, downloadMarkdownTranscript, formatTranscriptMarkdown, slugifyTranscriptFilename } from "@/lib/export-transcript";
import { SidebarPopoverMenu, type SidebarMenuItem } from "./SidebarPopoverMenu";
import { ShortcutHint } from "./ShortcutHint";

export function ChatHeaderMenu({ bot, messages, findOpen, onFind }: {
  bot: Bot;
  messages: readonly Message[];
  findOpen: boolean;
  onFind: () => void;
}) {
  const { state, dispatch } = useStore();
  const remoteClient = window.ogb?.remoteClient?.active === true;
  const usage = usageSummary(bot, state.instances);
  const advanced = useAdvancedMode();
  const advancedOnly = advanced ? undefined : t("chat.advancedOnly");
  const [copyStatus, setCopyStatus] = useState<"copied" | "failed" | null>(null);
  const hasMessages = messages.length > 0;
  const transcript = () => formatTranscriptMarkdown({ title: bot.name, messages, botName: bot.name, isGroup: false });
  const items: SidebarMenuItem[] = [
    {
      key: "find",
      label: t("chat.find"),
      icon: <Search size={16} />,
      active: findOpen,
      trailing: <ShortcutHint id="find-conversation" />,
      onSelect: onFind,
    },
    {
      key: "copy",
      heading: t("chat.export.heading"),
      separatorBefore: true,
      label: t("chat.export.copy"),
      icon: <Copy size={16} />,
      disabled: !hasMessages,
      keepOpen: true,
      trailing: copyStatus && <span role="status" className="text-[11px] text-ink-secondary">{t(copyStatus === "copied" ? "chat.export.copied" : "chat.export.copyFailed")}</span>,
      onSelect: () => { void copyTranscriptToClipboard(transcript()).then((ok) => setCopyStatus(ok ? "copied" : "failed")); },
    },
    {
      key: "download",
      label: t("chat.export.download"),
      icon: <Download size={16} />,
      disabled: !hasMessages,
      onSelect: () => downloadMarkdownTranscript(slugifyTranscriptFilename(bot.name), transcript()),
    },
    ...(usage ? [{
      key: "usage",
      label: t("chat.usage.menu"),
      icon: <Gauge size={16} />,
      separatorBefore: true,
      heading: advancedOnly,
      disabled: !advanced,
      trailing: <span title={usage.detail} data-testid="usage-chip" className={cn("tabular-nums text-[12px]", usage.tone === "danger" ? "text-danger" : usage.tone === "warning" ? "text-warning" : "text-ink-secondary")}>{usage.short}</span>,
      onSelect: () => dispatch({ type: "toggleSettings", open: true, section: "usage" }),
    } satisfies SidebarMenuItem] : []),
    ...(remoteClient ? [] : [{
      key: "activity",
      label: "Activity",
      icon: <ListChecks size={16} />,
      active: state.activityOpen,
      separatorBefore: !usage,
      onSelect: () => dispatch({ type: "toggleActivity" }),
    } satisfies SidebarMenuItem, {
      key: "inspector",
      label: t("chat.inspector"),
      icon: <Bug size={16} />,
      active: advanced && state.inspectorOpen,
      separatorBefore: true,
      heading: usage ? undefined : advancedOnly,
      disabled: !advanced,
      onSelect: () => dispatch({ type: "toggleInspector" }),
    } satisfies SidebarMenuItem]),
  ];
  return (
    <SidebarPopoverMenu
      items={items}
      ariaLabel={t("chat.more")}
      openOnHover
      placement="below"
      renderTrigger={({ open }) => (
        <span
          data-testid="chat-more"
          className={cn(
            "flex rounded-md p-1.5 hover:bg-raised",
            open || findOpen || state.inspectorOpen || state.activityOpen ? "text-accent" : "text-ink-secondary hover:text-ink",
          )}
          title={t("chat.more")}
        >
          <MoreHorizontal size={18} />
        </span>
      )}
    />
  );
}
