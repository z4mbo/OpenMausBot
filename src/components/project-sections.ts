import { Activity, Bot as BotIcon, Brush, CircleDot, FileText, GitBranch, Headset, Images, LockKeyhole, Megaphone, MessageCircle, MessagesSquare, Rocket, Send, Settings, Sparkles, Target, type LucideIcon } from "lucide-react";
import { botShowsUnread } from "@/lib/bot-unread";
import { unreadReplies } from "@/lib/origin-unread";
import type { ChiefSection } from "@/lib/origin-chief-section";
import type { Bot } from "@/state/store";
import { JOURNEY_PHASES, JOURNEY_PHASE_LABEL, type JourneyPhase } from "../../shared/origin-journey";

export type SectionPlace = "home" | JourneyPhase | "tool";

export interface ProjectSectionEntry { id: ChiefSection; label: string; icon: LucideIcon; blurb: string; place: SectionPlace }

export const CHIEF_SECTIONS = [
  { id: "pulse", label: "Pulse", icon: Activity, blurb: "The project at a glance, from idea to sale.", place: "home" },
  { id: "chat", label: "Chief", icon: MessageCircle, blurb: "Talk with the project's Chief and plan the work.", place: "plan" },
  { id: "team-chat", label: "Team", icon: MessagesSquare, blurb: "Talk with the people in this project.", place: "plan" },
  { id: "call", label: "Call", icon: Headset, blurb: "Voice and video calls with the people in this project.", place: "plan" },
  { id: "docs", label: "Docs", icon: FileText, blurb: "The project's Brief and specs, written by people and agents.", place: "plan" },
  { id: "draw", label: "Canvas", icon: Brush, blurb: "Shared design canvases the people and agents in this project build on.", place: "plan" },
  { id: "issues", label: "Issues", icon: CircleDot, blurb: "Track the project's bugs and tasks, and hand them to its agents.", place: "build" },
  { id: "agents", label: "Agents", icon: BotIcon, blurb: "", place: "build" },
  { id: "repo", label: "Repo", icon: GitBranch, blurb: "The project's code repository and its pull requests.", place: "build" },
  { id: "ship", label: "Ship", icon: Rocket, blurb: "Deploy the project and release what the team merged.", place: "build" },
  { id: "studio", label: "Studio", icon: Sparkles, blurb: "Generate images, video and audio for this project.", place: "launch" },
  { id: "broadcast", label: "Broadcast", icon: Send, blurb: "Plan and publish this project's posts on social channels.", place: "launch" },
  { id: "assets", label: "Assets", icon: Images, blurb: "Images, documents and files the team makes for this project.", place: "launch" },
  { id: "pipeline", label: "Sales", icon: Target, blurb: "Every contact, conversation and deal, from first message to payment.", place: "sell" },
  { id: "feedback", label: "Feedback", icon: Megaphone, blurb: "What users say about the project, collected in one place.", place: "sell" },
  { id: "vault", label: "Vault", icon: LockKeyhole, blurb: "Keys, logins and secrets this project's agents may use.", place: "tool" },
  { id: "settings", label: "Settings", icon: Settings, blurb: "Settings for the whole project: its name, members, integrations and defaults for its agents.", place: "tool" },
] as const satisfies readonly ProjectSectionEntry[];

export type ProjectPhase = JourneyPhase;
export const PROJECT_PHASES = JOURNEY_PHASES;
export const PHASE_LABEL = JOURNEY_PHASE_LABEL;

export const sectionEntry = (id: ChiefSection): ProjectSectionEntry => CHIEF_SECTIONS.find((item) => item.id === id) ?? CHIEF_SECTIONS[0];
export const phaseSections = (phase: ProjectPhase): ProjectSectionEntry[] => CHIEF_SECTIONS.filter((item) => item.place === phase);
export const toolSections = (): ProjectSectionEntry[] => CHIEF_SECTIONS.filter((item) => item.place === "tool");
export const phaseOf = (section: ChiefSection): ProjectPhase | null => {
  const place = sectionEntry(section).place;
  return place === "home" || place === "tool" ? null : place;
};

const lastInPhase = new Map<string, ChiefSection>();

/** Where a phase opens for a project: the section last seen in it, else its first. */
export function phaseLanding(botId: string, phase: ProjectPhase): ChiefSection {
  return lastInPhase.get(`${botId}:${phase}`) ?? phaseSections(phase)[0]!.id;
}

export function rememberSection(botId: string, section: ChiefSection): void {
  const phase = phaseOf(section);
  if (phase) lastInPhase.set(`${botId}:${phase}`, section);
}

export function teamAgents(bots: readonly Bot[], chief: Bot): Bot[] {
  const team = chief.section?.trim();
  return team ? bots.filter((bot) => !bot.hidden && bot.id !== chief.id && bot.section?.trim() === team) : [];
}

/** Unread replies across a project's agents, which the sidebar does not list one by one. */
export function teamUnread(bots: readonly Bot[], chief: Bot): number {
  return teamAgents(bots, chief).filter((agent) => botShowsUnread(agent)).reduce((sum, agent) => sum + unreadReplies(agent), 0);
}
