import { Bot as BotIcon, CircleDot, GitBranch, Headset, Images, LockKeyhole, Megaphone, MessageCircle, MessagesSquare, Palette, Send, Settings, type LucideIcon } from "lucide-react";
import { botShowsUnread } from "@/lib/bot-unread";
import { unreadReplies } from "@/lib/origin-unread";
import type { ShownSection } from "@/lib/origin-chief-section";
import type { Bot } from "@/state/store";

/** `lead` is the Chief button, `tab` the project bar, `tool` the icons on its right. */
export type SectionPlace = "lead" | "tab" | "tool";

export interface ProjectSectionEntry { id: ShownSection; label: string; icon: LucideIcon; place: SectionPlace }

export const CHIEF_SECTIONS = [
  { id: "chat", label: "Chief", icon: MessageCircle, place: "lead" },
  { id: "agents", label: "Agents", icon: BotIcon, place: "tab" },
  { id: "issues", label: "Issues", icon: CircleDot, place: "tab" },
  { id: "team-chat", label: "Chat", icon: MessagesSquare, place: "tab" },
  { id: "call", label: "Call", icon: Headset, place: "tab" },
  { id: "studio", label: "Studio", icon: Palette, place: "tab" },
  { id: "broadcast", label: "Publish", icon: Send, place: "tab" },
  { id: "assets", label: "Assets", icon: Images, place: "tool" },
  { id: "vault", label: "Vault", icon: LockKeyhole, place: "tool" },
  { id: "repo", label: "Repo", icon: GitBranch, place: "tool" },
  { id: "feedback", label: "Feedback", icon: Megaphone, place: "tool" },
  { id: "settings", label: "Settings", icon: Settings, place: "tool" },
] as const satisfies readonly ProjectSectionEntry[];

export const tabSections = (): ProjectSectionEntry[] => CHIEF_SECTIONS.filter((item) => item.place === "tab");
export const toolSections = (): ProjectSectionEntry[] => CHIEF_SECTIONS.filter((item) => item.place === "tool");

export function teamAgents(bots: readonly Bot[], chief: Bot): Bot[] {
  const team = chief.section?.trim();
  return team ? bots.filter((bot) => !bot.hidden && !bot.chiefOfStaff && bot.id !== chief.id && bot.section?.trim() === team) : [];
}

/** Unread replies across a project's agents, which the sidebar does not list one by one. */
export function teamUnread(bots: readonly Bot[], chief: Bot): number {
  return teamAgents(bots, chief).filter((agent) => botShowsUnread(agent)).reduce((sum, agent) => sum + unreadReplies(agent), 0);
}
