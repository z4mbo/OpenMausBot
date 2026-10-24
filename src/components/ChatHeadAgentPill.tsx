import { Crown } from "lucide-react";
import { api, useStore, type AppState, type Bot, type Message } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { stateForBot } from "@/lib/mascot";
import { HEADER_RENAME, SHOWS_CHIEF_LABEL } from "@/lib/origin-teams";
import { isWorkspaceSection } from "../../shared/origin-workspaces";
import { BotAvatar } from "./Avatar";
import { ProjectMark } from "./ProjectMark";
import { RenameTitle } from "./RenameTitle";

const CHATHEAD_PILL = "flex h-9 min-w-0 items-center gap-2.5 rounded-full border border-hairline/50 bg-control/50 pl-1.5 text-ink transition-colors @max-[30rem]/chathead:shrink-0 @max-[30rem]/chathead:gap-0 @max-[30rem]/chathead:pr-1.5 @min-[30rem]/chathead:min-w-[8rem]";
const WIDE_ONLY = "@max-[30rem]/chathead:hidden";

function ChiefOfStaffBadge({ bot }: { bot: Bot }) {
  if (!bot.chiefOfStaff || isWorkspaceSection(bot.section)) return null;
  if (!SHOWS_CHIEF_LABEL) return <span className={cn("flex shrink-0", WIDE_ONLY)}><ProjectMark botId={bot.id} size={13} /></span>;
  return (
    <span title={t("chat.chiefOfStaff")} className={cn("flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-accent/12 px-2 py-0.5 text-[11px] font-medium text-accent @max-4xl/chathead:px-1.5", WIDE_ONLY)}>
      <Crown size={11} aria-hidden="true" /> <span className="@max-4xl/chathead:sr-only">{t("chat.chiefOfStaff")}</span>
    </span>
  );
}

export function ChatHeadAgentPill({ bot, messages, advanced, embedded, motion, animated }: {
  bot: Bot;
  messages: Message[];
  advanced: boolean;
  embedded: boolean;
  motion: AppState["mascotMotion"];
  animated: boolean;
}) {
  const { dispatch } = useStore();
  const openProfile = () => dispatch({ type: "toggleSettings", open: true, ...(embedded ? { botId: bot.id } : {}) });
  const rename = (name: string) => {
    if (window.ogb?.remoteClient?.active) {
      void api(`/api/bots/${bot.id}/profile`, { method: "PATCH", body: JSON.stringify({ name }) })
        .then(({ bot: updated }) => dispatch({ type: "botPatched", bot: updated }))
        .catch((cause) => dispatch({ type: "error", message: cause instanceof Error ? cause.message : String(cause) }));
    } else {
      dispatch({ type: "updateBot", botId: bot.id, patch: { name } });
    }
  };
  const label = t("chat.openProfileAria", { name: bot.name });
  const avatar = <BotAvatar bot={bot} state={stateForBot({ ...bot, messages })} size={26}
    motion={motion?.kind ?? "none"} motionKey={motion?.nonce ?? 0} animated={animated} />;
  if (advanced) {
    return (
      <div data-chathead-pill className={cn(CHATHEAD_PILL, "pr-2")}>
        <button type="button" onClick={openProfile} className="flex shrink-0 items-center justify-center rounded-full" title={label} aria-label={label}>
          {avatar}
        </button>
        <span className={cn("flex min-w-0", WIDE_ONLY)}>
          <RenameTitle
            value={bot.name}
            onCommit={rename}
            onActivate={openProfile}
            showEditButton={HEADER_RENAME}
            className="truncate text-[14px] font-semibold text-ink"
            editButtonClassName="size-6 rounded-full"
            inputClassName="max-w-[220px] rounded-full bg-inset px-2 py-0.5 text-[14px] font-semibold"
          />
        </span>
        <ChiefOfStaffBadge bot={bot} />
      </div>
    );
  }
  return (
    <button type="button" data-chathead-pill onClick={openProfile} title={label} aria-label={label}
      className={cn(CHATHEAD_PILL, "pr-5 hover:bg-raised-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus")}>
      {avatar}
      <span className={cn("min-w-0 truncate text-[14px] font-semibold text-ink", WIDE_ONLY)}>{bot.name}</span>
      <ChiefOfStaffBadge bot={bot} />
    </button>
  );
}
