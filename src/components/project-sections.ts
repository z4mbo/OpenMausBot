import { Bot as BotIcon, Brush, CircleDot, GitBranch, Headset, Images, LockKeyhole, Megaphone, MessageCircle, MessagesSquare, Palette, Send, Settings, Target, type LucideIcon } from "lucide-react";
import { botShowsUnread } from "@/lib/bot-unread";
import { unreadReplies } from "@/lib/origin-unread";
import type { ChiefSection } from "@/lib/origin-chief-section";
import type { Bot } from "@/state/store";

/** `lead` is the Chief button, `tab` the project bar, `tool` the icons on its right, `nested` a page reached from inside another. */
export type SectionPlace = "lead" | "tab" | "tool" | "nested";

export interface ProjectSectionEntry { id: ChiefSection; label: string; icon: LucideIcon; blurb: string; place: SectionPlace }

export const CHIEF_SECTIONS = [
  { id: "chat", label: "Chief", icon: MessageCircle, blurb: "Talk with the project's Chief and plan the work.", place: "lead" },
  { id: "agents", label: "Agents", icon: BotIcon, blurb: "", place: "tab" },
  { id: "issues", label: "Issues", icon: CircleDot, blurb: "Track the project's bugs and tasks, and hand them to its agents.", place: "tab" },
  { id: "team-chat", label: "Chat", icon: MessagesSquare, blurb: "Talk with the people in this project.", place: "tab" },
  { id: "call", label: "Call", icon: Headset, blurb: "Voice and video calls with the people in this project.", place: "tab" },
  { id: "studio", label: "Studio", icon: Palette, blurb: "Generate images, video and audio for this project.", place: "tab" },
  { id: "broadcast", label: "Publish", icon: Send, blurb: "Plan and publish this project's posts on social channels.", place: "tab" },
  { id: "assets", label: "Assets", icon: Images, blurb: "Images, documents and files the team makes for this project.", place: "tool" },
  { id: "vault", label: "Vault", icon: LockKeyhole, blurb: "Keys, logins and secrets this project's agents may use.", place: "tool" },
  { id: "repo", label: "Repo", icon: GitBranch, blurb: "The project's code repository and its pull requests.", place: "tool" },
  { id: "feedback", label: "Feedback", icon: Megaphone, blurb: "What users say about the project, collected in one place.", place: "tool" },
  { id: "settings", label: "Settings", icon: Settings, blurb: "Settings for the whole project: its name, members, integrations and defaults for its agents.", place: "tool" },
  { id: "draw", label: "Canvas", icon: Brush, blurb: "Shared design canvases the people and agents in this project build on.", place: "nested" },
  { id: "pipeline", label: "Sales", icon: Target, blurb: "Every contact, conversation and deal, from first message to payment.", place: "nested" },
] as const satisfies readonly ProjectSectionEntry[];

export const sectionEntry = (id: ChiefSection): ProjectSectionEntry => CHIEF_SECTIONS.find((item) => item.id === id) ?? CHIEF_SECTIONS[0];
export const tabSections = (): ProjectSectionEntry[] => CHIEF_SECTIONS.filter((item) => item.place === "tab");
export const toolSections = (): ProjectSectionEntry[] => CHIEF_SECTIONS.filter((item) => item.place === "tool");

export function teamAgents(bots: readonly Bot[], chief: Bot): Bot[] {
  const team = chief.section?.trim();
  return team ? bots.filter((bot) => !bot.hidden && bot.id !== chief.id && bot.section?.trim() === team) : [];
}

/** Unread replies across a project's agents, which the sidebar does not list one by one. */
export function teamUnread(bots: readonly Bot[], chief: Bot): number {
  return teamAgents(bots, chief).filter((agent) => botShowsUnread(agent)).reduce((sum, agent) => sum + unreadReplies(agent), 0);
}
