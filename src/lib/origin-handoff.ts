import type { Action, Bot } from "@/state/store";
import { botOpensTo, openBot } from "@/state/thread-navigation";
import { setChiefSectionOf } from "./origin-chief-section";
import { openOriginPage } from "./origin-pages";

/** Sends `text` to the conversation `agent` opens to, then shows that conversation. */
export function handOff(dispatch: (action: Action) => void, agent: Bot, text: string, threadsShown: boolean): void {
  dispatch({ type: "send", botId: agent.id, threadId: botOpensTo(agent, threadsShown), text });
  if (agent.chiefOfStaff) setChiefSectionOf(agent.id, "chat");
  openOriginPage(null);
  openBot(dispatch, agent, threadsShown);
}
