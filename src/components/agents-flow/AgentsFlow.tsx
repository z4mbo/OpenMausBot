import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { Crown, Settings } from "lucide-react";
import { liveActivityPhrases, type LiveActivityPhrases } from "@/lib/live-activity";
import { liveFeedOf, stepsFromMessages, useLiveFeeds, type LiveFeed, type LiveStep } from "@/lib/agent-live-feed";
import { botThreadIds, flowLink, roomThreadsSpokenBy, type FlowLink } from "@/lib/agents-flow";
import { botShowsUnread } from "@/lib/bot-unread";
import { unreadReplies } from "@/lib/origin-unread";
import { EMPTY_TEAM_MAP_SNAPSHOT, type TeamMapSnapshot } from "@/lib/team-map";
import { api, useStore, visibleMessages, type Bot, type Group, type Message } from "@/state/store";
import { cn } from "@/lib/cn";
import { reducedMotion } from "../MenuMotion";
import { BotAvatar } from "../Avatar";
import { ToolActivity } from "../ToolActivity";
import { TurnPresence } from "../TurnPresence";
import { UnreadBadge } from "../UnreadBadge";

const STEPS_SHOWN = 4;
const LEAD_STEPS_SHOWN = 4;
const THOUGHT_SHOWN = 280;
const PHONE_COLUMN_MIN_PX = 168;
const LINE_HEIGHT = 48;

type Tone = "warning" | "success" | "idle";

const DOT: Record<Tone, string> = {
  warning: "bg-warning",
  success: "bg-success motion-safe:animate-pulse",
  idle: "bg-ink-tertiary/60",
};

interface BotLive {
  feed: LiveFeed | undefined;
  steps: LiveStep[];
  working: boolean;
  tone: Tone;
  status: string;
  phrases: LiveActivityPhrases;
}

function phrasesOf(feed: LiveFeed | undefined): LiveActivityPhrases {
  const running = feed?.phase === "tool" ? feed.steps.find((step) => step.ok === undefined) : undefined;
  if (feed?.phase === "approval") return { phase: "approval", phrases: ["Waiting for your approval"] };
  if (feed?.phase === "waiting") return { phase: "waiting", phrases: ["Waiting for a computer"] };
  return liveActivityPhrases(running ? ({ kind: "activity", tool: { name: running.name, spoken: running.spoken } } as Message) : undefined);
}

function botLive(bot: Bot, rooms: readonly Group[]): BotLive {
  const feed = liveFeedOf([...botThreadIds(bot), ...roomThreadsSpokenBy(rooms, bot.id)]);
  const steps = feed?.steps.length ? feed.steps : stepsFromMessages(visibleMessages(bot));
  const waiting = bot.activity === "waiting-on-you" || feed?.phase === "approval";
  const working = Boolean(feed?.active || bot.busy);
  const phrases = phrasesOf(feed);
  return {
    feed,
    steps,
    working,
    tone: waiting ? "warning" : working ? "success" : "idle",
    status: waiting ? "Needs you" : working ? phrases.phrases[0] : "Idle",
    phrases,
  };
}

function toolOf(step: LiveStep): NonNullable<Message["tool"]> {
  return { name: step.name, spoken: step.spoken, ok: step.ok, summary: step.detail, input: step.detail, output: step.output };
}

function tail(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `…${flat.slice(flat.length - max)}` : flat;
}

function useHandoffs(team: readonly Bot[]): TeamMapSnapshot {
  const [snapshot, setSnapshot] = useState<TeamMapSnapshot>(EMPTY_TEAM_MAP_SNAPSHOT);
  const signature = team.map((bot) => `${bot.id}:${bot.busy ? 1 : 0}:${bot.activity ?? ""}`).join("|");
  useEffect(() => {
    let alive = true;
    api("/api/team-map").then((next: TeamMapSnapshot) => { if (alive) setSnapshot(next); }).catch(() => {});
    return () => { alive = false; };
  }, [signature]);
  return snapshot;
}

export function AgentsFlow({ lead, agents, onOpen, onSettings }: {
  lead: Bot;
  agents: readonly Bot[];
  onOpen(bot: Bot, threadId?: string): void;
  onSettings(bot: Bot): void;
}) {
  useLiveFeeds();
  const { state } = useStore();
  const rooms = state.groups;
  const snapshot = useHandoffs(useMemo(() => [lead, ...agents], [lead, agents]));
  const leadLive = botLive(lead, rooms);
  const links = agents.map((agent) => flowLink(lead, agent, snapshot));
  const openLive = (bot: Bot, live: BotLive) => onOpen(bot, live.feed?.active ? live.feed.threadId : undefined);
  return (
    <div data-agents-flow className="max-md:-mx-4 max-md:overflow-x-auto max-md:px-4 max-md:pb-2">
      <div className="max-md:min-w-[var(--flow-min)]" style={{ "--flow-min": `${Math.max(1, agents.length) * PHONE_COLUMN_MIN_PX}px` } as CSSProperties}>
        <LeadCard lead={lead} live={leadLive} onOpen={() => openLive(lead, leadLive)} onSettings={() => onSettings(lead)} />
        {agents.length > 0 && <AgentRow agents={agents} rooms={rooms} links={links} onOpen={openLive} onSettings={onSettings} />}
      </div>
    </div>
  );
}

function Identity({ bot, live, size, lead = false }: { bot: Bot; live: BotLive; size: number; lead?: boolean }) {
  const unread = botShowsUnread(bot) ? unreadReplies(bot) : 0;
  return (
    <>
      <span className="pointer-events-none relative shrink-0">
        <BotAvatar bot={bot} size={size} animated={live.working} state={live.working ? "working" : undefined} />
        <span aria-hidden="true" className={cn("absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-panel", DOT[live.tone])} />
      </span>
      <span className="pointer-events-none min-w-0 flex-1 pr-6 @max-[8rem]:w-full @max-[8rem]:pr-0">
        <span className="flex min-w-0 items-center gap-1.5 @max-[8rem]:justify-center">
          <span className={cn("truncate font-semibold text-ink", lead ? "text-[15px]" : "text-[13.5px] @max-[8rem]:text-[12px]")}>{bot.name}</span>
          {lead && <Crown size={13} className="shrink-0 text-accent-text" aria-label="Project lead" />}
          <UnreadBadge count={unread} />
        </span>
        <span data-flow-status className={cn("block truncate text-[12px] @max-[8rem]:hidden", live.tone === "warning" ? "text-warning" : "text-ink-tertiary")}>{live.status}</span>
      </span>
    </>
  );
}

function LeadCard({ lead, live, onOpen, onSettings }: { lead: Bot; live: BotLive; onOpen(): void; onSettings(): void }) {
  return (
    <div data-flow-lead className="@container flex flex-col gap-3 rounded-2xl border border-hairline/40 bg-panel p-4">
      <div data-agent-card={lead.id} className="group relative -m-2 flex items-center gap-3 rounded-xl p-2 transition-colors duration-150 hover:bg-raised/40">
        <button type="button" onClick={onOpen} aria-label={`Open ${lead.name}`} className="absolute inset-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-accent/60" />
        <Identity bot={lead} live={live} size={40} lead />
        <SettingsButton bot={lead} onSettings={onSettings} />
      </div>
      <Live bot={lead} live={live} steps={LEAD_STEPS_SHOWN} row />
    </div>
  );
}

function AgentRow({ agents, rooms, links, onOpen, onSettings }: {
  agents: readonly Bot[];
  rooms: readonly Group[];
  links: FlowLink[];
  onOpen(bot: Bot, live: BotLive): void;
  onSettings(bot: Bot): void;
}) {
  const grid = useRef<HTMLDivElement>(null);
  const centers = useColumnCenters(grid, agents.length);
  return (
    <>
      <FlowLines layout={centers} links={links} />
      <div ref={grid} data-flow-agents className={cn("relative grid", agents.length > 8 ? "gap-1.5" : "gap-3")}
        style={{ gridTemplateColumns: `repeat(${agents.length}, minmax(0, 1fr))` }}>
        {agents.map((agent, index) => {
          const live = botLive(agent, rooms);
          return (
            <div key={agent.id} data-agent-column={agent.id} className="@container flex min-w-0 flex-col gap-2 motion-safe:animate-[rise_0.18s_cubic-bezier(0.22,1,0.36,1)_backwards]"
              style={{ animationDelay: `${Math.min(index, 12) * 15}ms` }}>
              <div data-agent-card={agent.id} className={cn("group relative flex min-w-0 items-center gap-2 rounded-xl border bg-panel p-2.5 transition-colors duration-150 hover:bg-raised/40 @max-[8rem]:flex-col @max-[8rem]:gap-1 @max-[8rem]:px-1 @max-[8rem]:text-center",
                links[index] === "running" ? "border-accent/50" : "border-hairline/40 hover:border-hairline")}>
                <button type="button" onClick={() => onOpen(agent, live)} aria-label={`Open ${agent.name}`} title={agent.name} className="absolute inset-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-accent/60" />
                <Identity bot={agent} live={live} size={28} />
                <SettingsButton bot={agent} onSettings={() => onSettings(agent)} compact />
              </div>
              <Live bot={agent} live={live} steps={STEPS_SHOWN} />
            </div>
          );
        })}
      </div>
    </>
  );
}

function Live({ bot, live, steps, row = false }: { bot: Bot; live: BotLive; steps: number; row?: boolean }) {
  const thought = live.feed?.active && live.feed.thought ? tail(live.feed.thought, THOUGHT_SHOWN) : "";
  const shown = live.steps.slice(0, steps);
  if (!live.working && !shown.length) return null;
  return (
    <div aria-label={`${bot.name} activity`} className="flex min-w-0 flex-col gap-2 overflow-hidden">
      <TurnPresence
        visible={live.working}
        avatar={<BotAvatar bot={bot} size={row ? 28 : 22} state={live.feed?.phase === "tool" ? "working" : "thinking"} forward={false} lookAround={1} trackPointer={false} />}
        phrases={live.phrases.phrases}
        phase={live.phrases.phase}
        seed={`${bot.id}:${live.feed?.threadId ?? ""}`}
        since={bot.turnStartedAt ?? null}
      />
      {thought && <p data-flow-thought className="line-clamp-3 text-[12.5px] leading-snug text-ink-tertiary @max-[8rem]:hidden">{thought}</p>}
      {shown.length > 0 && (
        <div className={cn("flex min-w-0 gap-1.5", row ? "flex-wrap" : "flex-col")}>
          {shown.map((step) => (
            <div key={step.id} data-flow-step={step.ok === undefined ? "running" : step.ok ? "done" : "failed"} className="min-w-0 max-w-full motion-safe:animate-[rise_0.16s_ease-out_backwards]">
              <ToolActivity tool={toolOf(step)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function useColumnCenters(grid: RefObject<HTMLDivElement | null>, count: number) {
  const [layout, setLayout] = useState<{ width: number; centers: number[] }>({ width: 0, centers: [] });
  useLayoutEffect(() => {
    const root = grid.current;
    if (!root) return;
    const measure = () => {
      const columns = Array.from(root.children) as HTMLElement[];
      const next = { width: root.clientWidth, centers: columns.map((column) => column.offsetLeft + column.offsetWidth / 2) };
      setLayout((current) => current.width === next.width && current.centers.join() === next.centers.join() ? current : next);
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(root);
    return () => resize.disconnect();
  }, [grid, count]);
  return layout;
}

const STROKE: Record<FlowLink, string> = {
  running: "stroke-accent",
  queued: "stroke-warning",
  busy: "stroke-success/70",
  idle: "stroke-hairline",
};

function FlowLines({ layout, links }: { layout: { width: number; centers: number[] }; links: FlowLink[] }) {
  const { width } = layout;
  const still = reducedMotion();
  if (!width) return <div style={{ height: LINE_HEIGHT }} aria-hidden="true" />;
  const from = width / 2;
  const mid = LINE_HEIGHT / 2;
  return (
    <svg aria-hidden="true" data-flow-lines width={width} height={LINE_HEIGHT} viewBox={`0 0 ${width} ${LINE_HEIGHT}`} className="block overflow-visible">
      {layout.centers.map((x, index) => {
        const link = links[index] ?? "idle";
        const path = `M ${from} 0 C ${from} ${mid}, ${x} ${mid}, ${x} ${LINE_HEIGHT}`;
        const live = link === "running";
        return (
          <g key={index} data-flow-link={link}>
            <path d={path} fill="none" strokeWidth={live ? 1.75 : 1.25} strokeLinecap="round"
              strokeDasharray={live || link === "queued" ? "4 5" : undefined}
              className={cn("transition-[stroke] duration-200", STROKE[link])}>
              {live && !still && <animate attributeName="stroke-dashoffset" from="18" to="0" dur="0.7s" repeatCount="indefinite" />}
            </path>
            {live && !still && (
              <circle r={2.5} className="fill-accent">
                <animateMotion path={path} dur="1.1s" repeatCount="indefinite" />
              </circle>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function SettingsButton({ bot, onSettings, compact = false }: { bot: Bot; onSettings(): void; compact?: boolean }) {
  return (
    <button type="button" onClick={onSettings} aria-label={`${bot.name} settings`} title="Settings"
      className={cn("absolute flex items-center justify-center rounded-md text-ink-secondary opacity-0 transition-opacity duration-150 hover:bg-raised hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 touch:opacity-100",
        compact ? "right-1 top-1 size-6 @max-[8rem]:hidden" : "right-2 top-1/2 size-8 -translate-y-1/2")}>
      <Settings size={compact ? 13 : 15} />
    </button>
  );
}
