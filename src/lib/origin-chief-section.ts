import { setDesignViewOf } from "./origin-design-view";

/** Which page each project shows: its chat, or one of its sections. Messages count as read only while the chat is on screen. */
export type ShownSection = "chat" | "issues" | "team-chat" | "call" | "studio" | "design" | "broadcast" | "assets" | "vault" | "repo" | "feedback" | "settings";
/** A page that can be asked for: a shown section, or "draw", which opens Design on its design files. */
export type ChiefSection = ShownSection | "draw";

const chosen = new Map<string, ShownSection>();

export const chiefSectionOf = (botId: string): ShownSection => chosen.get(botId) ?? "chat";
const listeners = new Set<() => void>();
let version = 0;

export const setChiefSectionOf = (botId: string, requested: ChiefSection) => {
  if (requested === "draw") setDesignViewOf(botId, "design");
  const section = requested === "draw" ? "design" : requested;
  if (chosen.get(botId) === section) return;
  chosen.set(botId, section);
  version += 1;
  for (const listener of listeners) listener();
};
export const subscribeChiefSections = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const chiefSectionsVersion = () => version;
export const chatHiddenFor = (botId: string): boolean => chiefSectionOf(botId) !== "chat";
