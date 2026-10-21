import { useEffect, useSyncExternalStore } from "react";
import { useStore } from "@/state/store";
import { openBot } from "@/state/thread-navigation";
import { useCloudLinks } from "./origin-cloud-links";
import { setChiefSectionOf, type ChiefSection } from "./origin-chief-section";
import { projectBotFor } from "./origin-issue-focus";
import { openOriginPage } from "./origin-pages";
import { useShowThreads } from "./thread-preferences";

export type OriginItemKind = "post" | "campaign" | "asset" | "vault" | "feedback" | "call" | "repo";

export const ITEM_SECTION: Record<OriginItemKind, Exclude<ChiefSection, "chat">> = {
  post: "broadcast", campaign: "broadcast",
  asset: "assets", vault: "vault", feedback: "feedback", call: "call", repo: "repo",
};

export interface ItemFocus {
  projectId: string;
  kind: OriginItemKind;
  itemId?: string;
}

const FOCUS_TTL_MS = 15_000;

let focus: (ItemFocus & { at: number }) | null = null;
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function requestItemFocus(next: ItemFocus): void {
  focus = { ...next, at: Date.now() };
  notify();
}

function consume(done: typeof focus): void {
  if (focus !== done) return;
  focus = null;
  notify();
}

export function useItemFocus(projectId: string | null, kinds: Partial<Record<OriginItemKind, (itemId: string) => boolean>>, ready = true): void {
  const current = useSyncExternalStore(subscribe, () => focus, () => null);
  useEffect(() => {
    if (!ready || !current || current.projectId !== projectId) return;
    if (Date.now() - current.at > FOCUS_TTL_MS) return consume(current);
    const open = kinds[current.kind];
    if (!open) return;
    if (!current.itemId || open(current.itemId)) consume(current);
  });
}

export function revealItem(itemId: string): boolean {
  const target = [...document.querySelectorAll<HTMLElement>("[data-origin-item]")].find((element) => element.dataset.originItem === itemId);
  if (!target) return false;
  if (!target.hasAttribute("tabindex") && !target.matches("button, a[href], input, select, textarea")) target.tabIndex = -1;
  target.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  target.focus({ preventScroll: true });
  target.dataset.originFocused = "";
  window.setTimeout(() => { delete target.dataset.originFocused; }, 1_600);
  return true;
}

export function useOpenOriginItem(): (target: ItemFocus) => boolean {
  const { state, dispatch } = useStore();
  const { projects } = useCloudLinks();
  const showThreads = useShowThreads();
  return (target) => {
    const botId = projectBotFor(projects, state.bots, target.projectId);
    const bot = botId ? state.bots.find((candidate) => candidate.id === botId) : undefined;
    if (!bot) return false;
    requestItemFocus(target);
    setChiefSectionOf(bot.id, ITEM_SECTION[target.kind]);
    openOriginPage(null);
    openBot(dispatch, bot, showThreads);
    return true;
  };
}
