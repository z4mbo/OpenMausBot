import { useState } from "react";
import { Bug, FolderGit2, Image, KeyRound, MessageCircle, MessageSquareHeart, Settings, Users } from "lucide-react";
import { useStore, type Bot } from "@/state/store";
import { openBot } from "@/state/thread-navigation";
import { useShowThreads } from "@/lib/thread-preferences";
import { cn } from "@/lib/cn";
import { BotAvatar } from "./Avatar";

export const CHIEF_SECTIONS = [
  { id: "issues", label: "Issues", icon: Bug, blurb: "Track the project's bugs and tasks, and hand them to its agents." },
  { id: "agents", label: "Agents", icon: Users, blurb: "" },
  { id: "assets", label: "Assets", icon: Image, blurb: "Images, documents and files the team makes for this project." },
  { id: "vault", label: "Vault", icon: KeyRound, blurb: "Keys, logins and secrets this project's agents may use." },
  { id: "repo", label: "Repo", icon: FolderGit2, blurb: "The project's code repository and its pull requests." },
  { id: "feedback", label: "Feedback", icon: MessageSquareHeart, blurb: "What users say about the project, collected in one place." },
  { id: "settings", label: "Settings", icon: Settings, blurb: "" },
] as const;

export type ChiefSection = "chat" | (typeof CHIEF_SECTIONS)[number]["id"];

const chosen = new Map<string, ChiefSection>();

export function useChiefSection(botId: string): [ChiefSection, (section: ChiefSection) => void] {
  const [, render] = useState(0);
  return [chosen.get(botId) ?? "chat", (next) => { chosen.set(botId, next); render((n) => n + 1); }];
}

export function teamAgents(bots: readonly Bot[], chief: Bot): Bot[] {
  const team = chief.section?.trim();
  return team ? bots.filter((bot) => !bot.hidden && bot.id !== chief.id && bot.section?.trim() === team) : [];
}

export function ChiefSectionBar({ bot, section, onSection }: { bot: Bot; section: ChiefSection; onSection(section: ChiefSection): void }) {
  const { dispatch } = useStore();
  return (
    <nav aria-label={`${bot.name} sections`} data-chief-sections className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-hairline/40 px-4 py-2 pl-11 md:pl-4">
      <button type="button" onClick={() => onSection("chat")} aria-current={section === "chat" ? "page" : undefined}
        className={cn("mr-2 flex shrink-0 items-center gap-2 rounded-lg px-2 py-1 text-[14px] font-semibold text-ink hover:bg-raised", section === "chat" && "bg-raised")}>
        <BotAvatar bot={bot} size={22} />
        <span className="max-w-[160px] truncate">{bot.name}</span>
        <span aria-label={bot.busy ? "Working" : "Idle"} className={cn("size-2 rounded-full", bot.busy ? "animate-pulse bg-success" : "bg-ink-tertiary/60")} />
        {section !== "chat" && <MessageCircle size={13} className="text-ink-secondary" aria-hidden="true" />}
      </button>
      {CHIEF_SECTIONS.map(({ id, label, icon: Icon }) => (
        <button key={id} type="button" aria-current={section === id ? "page" : undefined}
          onClick={() => id === "settings" ? dispatch({ type: "toggleSettings", botId: bot.id, open: true }) : onSection(id)}
          className={cn("flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] text-ink-secondary hover:bg-raised hover:text-ink",
            section === id && "bg-raised text-ink")}>
          <Icon size={14} aria-hidden="true" />{label}
        </button>
      ))}
    </nav>
  );
}

export function ChiefSectionPanel({ bot, section }: { bot: Bot; section: Exclude<ChiefSection, "chat"> }) {
  const { state, dispatch } = useStore();
  const showThreads = useShowThreads();
  const entry = CHIEF_SECTIONS.find((item) => item.id === section)!;
  if (section === "agents") {
    const agents = teamAgents(state.bots, bot);
    return (
      <section className="flex-1 overflow-y-auto p-6" aria-label="Agents">
        <h2 className="mb-1 text-[17px] font-semibold text-ink">Agents</h2>
        <p className="mb-5 text-[13px] text-ink-secondary">{agents.length ? `${agents.length} agents work for ${bot.name}.` : `${bot.name} has no agents yet. Add them from the Team map.`}</p>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
          {agents.map((agent) => (
            <div key={agent.id} className="flex flex-col gap-3 rounded-xl border border-hairline/40 bg-panel p-4">
              <div className="flex items-center gap-3">
                <BotAvatar bot={agent} size={36} />
                <div className="min-w-0">
                  <div className="truncate text-[14px] font-semibold text-ink">{agent.name}</div>
                  <div className="truncate text-[12px] text-ink-secondary">{agent.title || "Agent"}</div>
                </div>
                <span aria-label={agent.busy ? "Working" : "Idle"} className={cn("ml-auto size-2 shrink-0 rounded-full", agent.busy ? "animate-pulse bg-success" : "bg-ink-tertiary/60")} />
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => openBot(dispatch, agent, showThreads)}
                  className="flex-1 rounded-lg bg-raised px-3 py-1.5 text-[12px] font-medium text-ink hover:bg-raised-hover">Open chat</button>
                <button type="button" onClick={() => dispatch({ type: "toggleSettings", botId: agent.id, open: true })}
                  className="rounded-lg px-3 py-1.5 text-[12px] text-ink-secondary hover:bg-raised hover:text-ink">Settings</button>
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }
  const Icon = entry.icon;
  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center" aria-label={entry.label}>
      <Icon size={28} className="text-ink-secondary" aria-hidden="true" />
      <h2 className="text-[17px] font-semibold text-ink">{entry.label}</h2>
      <p className="max-w-sm text-[13px] text-ink-secondary">{entry.blurb}</p>
      <span className="rounded-full bg-raised px-3 py-1 text-[12px] text-ink-secondary">Coming soon</span>
    </section>
  );
}
