import { setStudioViewOf } from "./origin-studio-view";

/** Which page each project shows: its chat, or one of its sections. Messages count as read only while the chat is on screen. */
export type ChiefSection = "chat" | "issues" | "agents" | "team-chat" | "call" | "draw" | "studio" | "broadcast" | "pipeline" | "assets" | "vault" | "repo" | "feedback" | "settings";

const chosen = new Map<string, ChiefSection>();

export const chiefSectionOf = (botId: string): ChiefSection => chosen.get(botId) ?? "chat";
const listeners = new Set<() => void>();
let version = 0;

export const setChiefSectionOf = (botId: string, requested: ChiefSection) => {
  if (requested === "draw") setStudioViewOf(botId, "design");
  const section = requested === "draw" ? "studio" : requested;
  if (chosen.get(botId) === section) return;
  chosen.set(botId, section);
  version += 1;
  for (const listener of listeners) listener();
};
export const subscribeChiefSections = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const chiefSectionsVersion = () => version;
export const chatHiddenFor = (botId: string): boolean => chiefSectionOf(botId) !== "chat";
