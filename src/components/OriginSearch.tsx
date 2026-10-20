import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { Archive, CheckCircle2, CircleDot, CornerDownLeft, FolderKanban, MessageSquare, Search, X } from "lucide-react";
import { api, useStore, type Bot } from "@/state/store";
import { openBot } from "@/state/thread-navigation";
import { useShowThreads } from "@/lib/thread-preferences";
import { cn } from "@/lib/cn";
import type { SearchHit } from "@/lib/search-hit";
import { landOnSearchHit } from "@/lib/focus-message";
import { useCloudLinks } from "@/lib/origin-cloud-links";
import { useCloudQuery } from "@/lib/origin-cloud";
import { setChiefSectionOf } from "@/lib/origin-chief-section";
import { requestIssueFocus } from "@/lib/origin-issue-focus";
import { openOriginPage, type OriginPage } from "@/lib/origin-pages";
import { useArchivedSections } from "@/lib/origin-archived";
import { activeWorkspace, inWorkspace, useWorkspaces, workspaceHeadsOf } from "@/lib/origin-workspaces";
import { isWorkspaceSection, STANDALONE_SECTION } from "../../shared/origin-workspaces";
import { BotAvatar } from "./Avatar";
import { ORIGIN_PAGES } from "./OriginPages";
import { taskKey } from "./origin-pages/repo-url";
import { CenteredDialog } from "./CenteredDialog";

interface Entry {
  key: string;
  depth: 0 | 1;
  last?: boolean;
  icon: ReactNode;
  label: string;
  hint?: string;
  badge?: ReactNode;
  open(): void;
  alternate?: { label: string; open(): void };
}

interface Section { title: string; entries: Entry[] }

type CloudIssueHit = { _id: string; projectId: string; title: string; done: boolean };

const PROJECT_LIMIT = 8;
const ISSUE_LIMIT = 8;
const MESSAGE_LIMIT = 8;

const matches = (text: string | undefined, q: string) => Boolean(q) && Boolean(text?.toLowerCase().includes(q));
const startsWith = (text: string, q: string) => text.toLowerCase().startsWith(q);

/** Marks every occurrence of the query in a label. */
export function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase();
  if (!q) return <>{text}</>;
  const parts: ReactNode[] = [];
  const lower = text.toLowerCase();
  let at = 0;
  for (let found = lower.indexOf(q); found !== -1; found = lower.indexOf(q, at)) {
    if (found > at) parts.push(text.slice(at, found));
    parts.push(<mark key={found} className="rounded-[3px] bg-accent/25 px-px text-ink">{text.slice(found, found + q.length)}</mark>);
    at = found + q.length;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/** Origin's workspace search, with each project's Chief and, under it, the project's agents. */
export function OriginSearch({ onClose }: { onClose(): void }) {
  const { state, dispatch } = useStore();
  const showThreads = useShowThreads();
  const links = useCloudLinks();
  const view = useWorkspaces();
  const archived = useArchivedSections();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [messages, setMessages] = useState<SearchHit[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const q = query.trim().toLowerCase();
  const slow = useDebounced(q, 180);

  const heads = workspaceHeadsOf(state.bots);
  const headId = activeWorkspace(view, heads);
  const head = heads.find((bot) => bot.id === headId);
  const teamId = (headId && links.workspaces[headId]) || null;
  const issueHits = useCloudQuery<CloudIssueHit[]>("workspaceSearch:issues", teamId && slow ? { teamId, text: slow } : "skip");

  useEffect(() => {
    if (!slow) { setMessages([]); return; }
    let alive = true;
    api(`/api/search?q=${encodeURIComponent(slow)}&limit=${MESSAGE_LIMIT}`)
      .then((result: { hits?: SearchHit[] }) => { if (alive) setMessages(result.hits ?? []); })
      .catch(() => { if (alive) setMessages([]); });
    return () => { alive = false; };
  }, [slow]);

  useEffect(() => setCursor(0), [q]);

  const go = (bot: Bot, section: "chat" | "issues" = "chat") => {
    if (bot.chiefOfStaff) setChiefSectionOf(bot.id, section);
    openOriginPage(null);
    openBot(dispatch, bot, showThreads);
    onClose();
  };

  const sections: Section[] = (() => {
    const live = state.bots.filter((bot) => !bot.hidden);
    const chiefs = live.filter((bot) => bot.chiefOfStaff && !isWorkspaceSection(bot.section) && bot.section?.trim() !== STANDALONE_SECTION
      && inWorkspace(head, bot));
    const agentsOf = (chief: Bot) => live.filter((bot) => bot.id !== chief.id && bot.section?.trim() === chief.section?.trim());
    const shelved = (bot: Bot) => archived.has(bot.section?.trim() ?? "");
    const agentEntry = (agent: Bot, last: boolean): Entry => ({
      key: `agent:${agent.id}`, depth: 1, last, label: agent.name, hint: agent.title?.trim() && agent.title.trim() !== agent.name ? agent.title.trim() : "Agent",
      icon: <BotAvatar bot={agent} size={22} animated={false} />, open: () => go(agent),
    });
    const projectEntry = (chief: Bot): Entry => ({
      key: `project:${chief.id}`, depth: 0, label: chief.name, hint: "Project",
      icon: <BotAvatar bot={chief} size={26} animated={false} />,
      badge: shelved(chief) ? <span className="flex items-center gap-1 rounded-full bg-raised px-1.5 text-[10.5px] text-ink-tertiary"><Archive size={10} />Archived</span> : undefined,
      open: () => go(chief), alternate: { label: "Issues", open: () => go(chief, "issues") },
    });

    const projectHits = chiefs.flatMap((chief) => {
      const agents = agentsOf(chief);
      const named = !q || matches(chief.name, q);
      const agentHits = q ? agents.filter((agent) => matches(agent.name, q) || matches(agent.title, q)) : [];
      if (!named && !agentHits.length) return [];
      const shown = named && q ? agents : agentHits;
      const rank = !q ? (shelved(chief) ? 3 : 0) : startsWith(chief.name, q) ? 0 : named ? 1 : 2;
      return [{ chief, shown, rank: rank + (shelved(chief) && q ? 0.5 : 0) }];
    }).sort((a, b) => a.rank - b.rank || a.chief.name.localeCompare(b.chief.name)).slice(0, q ? PROJECT_LIMIT : 6);

    const projects: Entry[] = projectHits.flatMap(({ chief, shown }) => [
      projectEntry(chief),
      ...shown.map((agent, index) => agentEntry(agent, index === shown.length - 1)),
    ]);

    const loose = q ? live.filter((bot) => bot.section?.trim() === STANDALONE_SECTION && (matches(bot.name, q) || matches(bot.title, q))) : [];
    const workspace = head && q && matches(head.name, q) ? [head] : [];
    const people: Entry[] = [...workspace, ...loose].map((bot) => ({
      key: `bot:${bot.id}`, depth: 0, label: bot.name, hint: bot === head ? "Workspace chief" : bot.title?.trim() || "Agent",
      icon: <BotAvatar bot={bot} size={26} animated={false} />, open: () => go(bot),
    }));

    const pages: Entry[] = ORIGIN_PAGES.filter((page) => !q || matches(page.label, q) || matches(page.contents, q)).map(({ id, label, contents, icon: Icon }) => ({
      key: `page:${id}`, depth: 0, label, hint: contents,
      icon: <span className="flex size-[26px] items-center justify-center rounded-lg bg-raised text-ink-secondary"><Icon size={14} /></span>,
      open: () => { openOriginPage(id as OriginPage); onClose(); },
    }));

    const chiefByCloud = new Map(Object.entries(links.projects).map(([botId, cloudId]) => [cloudId, state.bots.find((bot) => bot.id === botId)]));
    const issues: Entry[] = q ? (issueHits ?? []).slice(0, ISSUE_LIMIT).flatMap((issue) => {
      const chief = chiefByCloud.get(issue.projectId);
      if (!chief) return [];
      return [{
        key: `issue:${issue._id}`, depth: 0 as const, label: issue.title, hint: `${taskKey(issue._id)} · ${chief.name}`,
        icon: <span className={cn("flex size-[26px] items-center justify-center rounded-lg bg-raised", issue.done ? "text-success" : "text-accent")}>{issue.done ? <CheckCircle2 size={14} /> : <CircleDot size={14} />}</span>,
        open: () => { requestIssueFocus({ projectId: issue.projectId, issueId: issue._id }); go(chief, "issues"); },
      }];
    }) : [];

    const chats: Entry[] = q ? messages.map((hit) => {
      const bot = hit.botId ? state.bots.find((item) => item.id === hit.botId) : undefined;
      const before = hit.snippet.slice(Math.max(0, hit.matchStart - 40), hit.matchStart);
      return {
        key: `msg:${hit.threadId}:${hit.messageId}`, depth: 0 as const,
        label: `${hit.matchStart > 40 ? "…" : ""}${before}${hit.snippet.slice(hit.matchStart)}`, hint: `${hit.from ?? hit.name}${hit.task ? ` · ${hit.task}` : ""}`,
        icon: bot ? <BotAvatar bot={bot} size={26} animated={false} /> : <span className="flex size-[26px] items-center justify-center rounded-lg bg-raised text-ink-secondary"><MessageSquare size={14} /></span>,
        open: () => {
          onClose();
          landOnSearchHit(hit, state, dispatch, showThreads).catch((error: unknown) => dispatch({ type: "error", message: error instanceof Error ? error.message : String(error) }));
        },
      };
    }) : [];

    return [
      { title: "Projects and agents", entries: projects },
      { title: q ? "Agents" : "", entries: people },
      { title: "Issues", entries: issues },
      { title: "Go to", entries: pages },
      { title: "Messages", entries: chats },
    ].filter((section) => section.entries.length);
  })();

  const flat = sections.flatMap((section) => section.entries);
  const selected = flat.length ? Math.min(cursor, flat.length - 1) : 0;
  const active = flat[selected];

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.nativeEvent.isComposing) return;
    const step = (to: number) => { event.preventDefault(); setCursor(flat.length ? (to + flat.length) % flat.length : 0); };
    if (event.key === "ArrowDown" || (event.key === "Tab" && !event.shiftKey) || (event.ctrlKey && event.key === "n")) step(selected + 1);
    else if (event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey) || (event.ctrlKey && event.key === "p")) step(selected - 1);
    else if (event.key === "Home" && event.ctrlKey) step(0);
    else if (event.key === "End" && event.ctrlKey) step(flat.length - 1);
    else if (event.key === "PageDown") step(Math.min(selected + 5, flat.length - 1));
    else if (event.key === "PageUp") step(Math.max(selected - 5, 0));
    else if (event.key === "Enter" && active) {
      event.preventDefault();
      if (event.shiftKey && active.alternate) active.alternate.open();
      else active.open();
    }
  };

  const loading = Boolean(q) && (q !== slow || (teamId !== null && issueHits === undefined));
  let index = -1;
  return (
    <CenteredDialog label="Search" onClose={onClose} className="flex h-[min(620px,85dvh)] flex-col overflow-hidden sm:max-w-[720px]">
      {(dismiss) => <div className="flex min-h-0 flex-1 flex-col"
        onKeyDown={(event) => {
          if (event.key !== "Escape") { onKeyDown(event); return; }
          event.preventDefault();
          event.stopPropagation();
          dismiss();
        }}>
        <div className="flex items-center gap-3 border-b border-hairline/40 px-5 py-3.5">
          <Search size={18} className={cn("shrink-0 transition-colors", q ? "text-accent" : "text-ink-secondary")} aria-hidden="true" />
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} maxLength={160}
            role="combobox" aria-expanded="true" aria-controls="origin-search-results" aria-activedescendant={active ? `origin-search-${selected}` : undefined}
            aria-label="Search projects, agents, issues and messages" placeholder="Search projects, agents, issues, messages…"
            className="w-full bg-transparent text-[16px] text-ink outline-none placeholder:text-ink-tertiary" />
          {loading && <span className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-ink-tertiary/40 border-t-ink-secondary" aria-hidden="true" />}
          {query ? (
            <button type="button" aria-label="Clear search" onClick={() => setQuery("")} className="flex size-6 shrink-0 items-center justify-center rounded-md text-ink-tertiary hover:bg-raised hover:text-ink"><X size={14} /></button>
          ) : <kbd className="shrink-0 rounded-md border border-hairline/40 px-1.5 py-0.5 text-[11px] text-ink-tertiary">esc</kbd>}
        </div>
        <div ref={listRef} id="origin-search-results" role="listbox" aria-label="Search results" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
          {!flat.length && (
            <div className="flex flex-col items-center gap-2 px-3 py-10 text-center">
              <FolderKanban size={22} className="text-ink-tertiary" aria-hidden="true" />
              <p className="text-[13.5px] text-ink-secondary">{q ? loading ? "Searching…" : `Nothing matches “${query.trim()}”` : "Nothing to search yet"}</p>
            </div>
          )}
          {sections.map((section) => (
            <Fragment key={section.title || "agents"}>
              {section.title && <div role="presentation" className="px-3 pb-1 pt-2.5 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-tertiary">{section.title}</div>}
              {section.entries.map((entry) => {
                index += 1;
                const at = index;
                const current = at === selected;
                return (
                  <div key={entry.key} id={`origin-search-${at}`} data-index={at} role="option" aria-selected={current}
                    onMouseMove={() => { if (!current) setCursor(at); }} onClick={() => entry.open()}
                    className={cn("group/result relative flex cursor-pointer items-center gap-2.5 rounded-xl py-1.5 pr-2 transition-colors duration-(--motion-fast)",
                      entry.depth ? "pl-11" : "pl-2.5", current ? "bg-raised" : "hover:bg-raised/50")}>
                    {entry.depth === 1 && (
                      <span aria-hidden="true" className={cn("absolute left-[22px] top-0 w-3 border-l border-hairline/70", entry.last ? "h-1/2 rounded-bl-md border-b" : "h-full")}>
                        {!entry.last && <span className="absolute left-0 top-1/2 w-3 border-t border-hairline/70" />}
                      </span>
                    )}
                    <span className="flex shrink-0">{entry.icon}</span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className={cn("truncate text-ink", entry.depth ? "text-[13.5px]" : "text-[14px] font-medium")}><Highlight text={entry.label} query={q} /></span>
                      {entry.hint && <span className="truncate text-[12px] text-ink-tertiary"><Highlight text={entry.hint} query={q} /></span>}
                    </span>
                    {entry.badge}
                    {entry.alternate && (
                      <button type="button" tabIndex={-1} onClick={(event) => { event.stopPropagation(); entry.alternate!.open(); }}
                        className={cn("shrink-0 rounded-md border border-hairline/50 px-1.5 py-0.5 text-[11px] text-ink-secondary transition-opacity hover:bg-raised hover:text-ink",
                          current ? "opacity-100" : "opacity-0 group-hover/result:opacity-100 focus-visible:opacity-100 touch:opacity-100")}>
                        {entry.alternate.label}{current && <span className="ml-1 text-ink-tertiary">⇧↵</span>}
                      </button>
                    )}
                    {current && <CornerDownLeft size={13} className="shrink-0 text-ink-tertiary" aria-hidden="true" />}
                  </div>
                );
              })}
            </Fragment>
          ))}
        </div>
        <div className="hidden items-center gap-4 border-t border-hairline/40 px-5 py-2.5 text-[11.5px] text-ink-tertiary sm:flex">
          <span><kbd className="font-sans">↑↓</kbd> to move</span>
          <span><kbd className="font-sans">↵</kbd> to open</span>
          <span><kbd className="font-sans">⇧↵</kbd> project issues</span>
          <span className="ml-auto"><kbd className="font-sans">esc</kbd> to close</span>
        </div>
      </div>}
    </CenteredDialog>
  );
}
