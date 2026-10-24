import type { ReactNode, RefObject } from "react";
import { BookOpen, Sparkles, Target, Users } from "lucide-react";
import type { Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { normalizeState } from "@/lib/mascot";
import { mentionRowDescription } from "@/lib/mentions";
import type { ComposerSlashCommand } from "@/lib/composer-commands";
import type { MenuMotion } from "./MenuMotion";
import { BotAvatar } from "./Avatar";
import { ComposerMenuRow } from "./ComposerMenuRow";

export type MentionTeammate = { id: string; name: string; avatar: ReactNode; kind: string; description?: string };

export type MentionChoice = { id: string; name: string; bot?: Bot; teammate?: MentionTeammate };

const MENU = "absolute bottom-full z-20 mb-2 overflow-x-hidden overflow-y-auto overscroll-contain rounded-2xl border border-hairline/50 bg-menu py-1 origin-bottom-left";

export function ComposerCommandList({ listRef, motion, commands, highlight, onPick, onHighlight }: {
  listRef: RefObject<HTMLDivElement | null>;
  motion: MenuMotion;
  commands: readonly ComposerSlashCommand[];
  highlight: number;
  onPick: (command: ComposerSlashCommand) => void;
  onHighlight: (index: number) => void;
}) {
  if (!motion.shown) return null;
  return (
    <div ref={listRef} role="listbox" aria-label={t("composer.commands.aria")}
      className={cn(MENU, "left-0 max-h-80 w-80 max-w-full", motion.className)} {...motion.exitProps}>
      <div className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-tertiary">
        {t("composer.commands.title")}
      </div>
      {commands.map((command, index) => (
        <button
          key={`${command.kind}:${command.id}`}
          data-command-index={index}
          type="button"
          role="option"
          aria-selected={index === highlight}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPick(command)}
          onMouseEnter={() => onHighlight(index)}
          className={cn("mx-1 flex w-[calc(100%-0.5rem)] items-center gap-3 rounded-xl px-2.5 py-2 text-left", index === highlight && "bg-raised-hover")}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent-text">
            {command.kind === "skill" ? <Sparkles size={15} aria-hidden="true" />
              : command.id === "goal" ? <Target size={15} aria-hidden="true" />
              : <BookOpen size={15} aria-hidden="true" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-[14px] font-medium text-ink">{command.label}</span>
              {command.kind === "skill" && (
                <span className="shrink-0 rounded-full bg-accent/10 px-1.5 text-[11px] font-medium leading-4 text-accent-text">{t("composer.command.skillTag")}</span>
              )}
            </span>
            <span className="block truncate text-xs text-ink-secondary">{command.description}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

export function ComposerMentionList({ listRef, motion, candidates, highlight, everyoneCount, onPick, onHighlight }: {
  listRef: RefObject<HTMLDivElement | null>;
  motion: MenuMotion;
  candidates: readonly MentionChoice[];
  highlight: number;
  everyoneCount: number;
  onPick: (peer: MentionChoice) => void;
  onHighlight: (index: number) => void;
}) {
  if (!motion.shown) return null;
  return (
    <div ref={listRef} role="listbox" aria-label={t("composer.mention.aria")}
      className={cn(MENU, "start-0 max-h-72 w-72 max-w-full", motion.className)} {...motion.exitProps}>
      {candidates.map((peer, index) => {
        const description = peer.teammate ? peer.teammate.description : mentionRowDescription(peer.bot
          ? { kind: "bot", title: peer.bot.title }
          : { kind: "everyone", count: everyoneCount });
        return (
          <ComposerMenuRow
            key={peer.id}
            id={`composer-mention-${peer.id}`}
            data-mention-index={index}
            role="option"
            aria-selected={index === highlight}
            onClick={() => onPick(peer)}
            onMouseEnter={() => onHighlight(index)}
            selected={index === highlight}
            className="mx-1 w-[calc(100%-0.5rem)] rounded-xl px-2.5"
            icon={peer.teammate ? peer.teammate.avatar : peer.bot ? (
              <BotAvatar bot={peer.bot} state={normalizeState(peer.bot.mascotExpression) ?? "happy"} size={24} />
            ) : (
              <span className="flex size-6 items-center justify-center rounded-full bg-raised text-ink-secondary">
                <Users size={14} aria-hidden="true" />
              </span>
            )}
            name={peer.name}
            description={description || undefined}
            kind={peer.teammate ? peer.teammate.kind : peer.bot ? t("composer.mention.agent") : t("composer.mention.channel")}
          />
        );
      })}
    </div>
  );
}
