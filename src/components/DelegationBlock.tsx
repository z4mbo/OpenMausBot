import { useState, type ReactNode } from "react";
import { ChevronRight, Square } from "lucide-react";
import { useStore, type Bot, type Message } from "@/state/store";
import { cn } from "@/lib/cn";
import { delegationBrief, delegationSegment, delegationStatus, type DelegationStatus } from "@/lib/delegation";
import { liveFeedOf, useLiveFeeds } from "@/lib/agent-live-feed";
import { liveActivityPhrases } from "@/lib/live-activity";
import { useThreadTranscript } from "@/lib/thread-transcript";
import { BotAvatar } from "./Avatar";
import { PendingApprovalActions, PendingApprovalPanel, pendingApprovals } from "./PendingApproval";
import { TurnPresence } from "./TurnPresence";

const STATUS: Record<DelegationStatus, { label: string; dot: string; text: string }> = {
  queued: { label: "Queued", dot: "bg-ink-tertiary/60", text: "text-ink-secondary" },
  working: { label: "Working on", dot: "bg-success motion-safe:animate-pulse", text: "text-ink-secondary" },
  approval: { label: "Needs your approval", dot: "bg-warning", text: "text-warning" },
  done: { label: "Done", dot: "bg-success", text: "text-ink-secondary" },
  failed: { label: "Stopped", dot: "bg-danger", text: "text-danger" },
};

const THOUGHT_SHOWN = 240;

function tail(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `…${flat.slice(flat.length - max)}` : flat;
}

export function DelegationBlock({ sent, agent, failed, renderTranscript }: {
  sent: Message;
  agent: Bot;
  failed: boolean;
  renderTranscript(messages: Message[], threadId: string): ReactNode;
}) {
  const { dispatch } = useStore();
  useLiveFeeds();
  const threadId = sent.threadRef!.threadId;
  const requestId = sent.roomRequest!.id;
  const thread = useThreadTranscript(threadId);
  const segment = thread ? delegationSegment(thread, requestId) : [];
  const [request, ...rows] = segment;
  const work = rows.filter((message) => message.kind !== "digest");
  const task = agent.tasks?.find((candidate) => candidate.threadId === threadId);
  const approvals = pendingApprovals(work);
  const approval = approvals[0];
  const settled = segment.some((message) => message.turnTerminal);
  const running = Boolean(task?.busy || task?.activity === "working" || task?.activity === "waiting-on-you") && Boolean(request) && !settled;
  const status = delegationStatus(segment, { working: running, pendingApproval: Boolean(approval), failed });
  const live = status === "working" || status === "approval" || status === "queued";
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = chosen ?? live;
  const brief = delegationBrief(request, agent.name);
  const feed = running ? liveFeedOf([threadId]) : undefined;
  const thought = feed?.active && feed.thought ? tail(feed.thought, THOUGHT_SHOWN) : "";
  const phrases = liveActivityPhrases(work.at(-1));
  const style = STATUS[status];
  const bodyId = `delegation-${requestId}`;
  return (
    <section data-delegation={requestId} data-delegation-status={status} aria-label={`${agent.name}: ${style.label}${brief ? ` ${brief}` : ""}`}
      className="w-full max-w-[var(--chat-bubble-max)] rounded-2xl border border-hairline/40 bg-panel">
      <div className="flex min-h-11 items-center gap-1 pr-2">
        <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={() => setChosen(!open)}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-2xl py-2 pl-3 pr-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
          <span className="relative shrink-0">
            <BotAvatar bot={agent} size={24} animated={running} state={running ? "working" : undefined} />
            <span aria-hidden="true" className={cn("absolute -bottom-0.5 -right-0.5 size-2 rounded-full ring-2 ring-panel", style.dot)} />
          </span>
          <span className="flex min-w-0 flex-1 items-baseline gap-1.5 text-[13.5px] leading-5">
            <span className="shrink-0 font-semibold text-ink">{agent.name}</span>
            <span className={cn("shrink-0", style.text)}>{status === "working" ? `${style.label}:` : `· ${style.label}`}</span>
            {brief && <span className="min-w-0 truncate text-ink-secondary" title={brief}>{status === "working" ? brief : `· ${brief}`}</span>}
          </span>
          <ChevronRight size={14} aria-hidden="true" className={cn("shrink-0 text-ink-tertiary transition-transform duration-150 motion-reduce:transition-none", open && "rotate-90")} />
        </button>
        {running && (
          <button type="button" onClick={() => dispatch({ type: "interrupt", botId: agent.id, threadId })}
            aria-label={`Stop ${agent.name}`} title={`Stop ${agent.name}`}
            className="flex size-7 shrink-0 items-center justify-center rounded-full text-ink-secondary transition-colors duration-150 hover:bg-raised hover:text-ink">
            <Square size={11} className="fill-current" />
          </button>
        )}
      </div>
      <div id={bodyId} inert={!open || undefined}
        className={cn("grid transition-[grid-template-rows] duration-150 ease-out motion-reduce:transition-none", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
        <div className="min-h-0 overflow-hidden">
          <div className="flex flex-col gap-3 border-t border-hairline/40 px-3 py-3">
            {thread === null && <p className="text-[13px] text-ink-tertiary">Loading…</p>}
            {thread !== null && !request && <p className="text-[13px] text-ink-secondary">{failed ? "This work did not start." : `Waiting for ${agent.name} to start.`}</p>}
            {work.length > 0 && renderTranscript(work, threadId)}
            {thought && <p data-delegation-thought className="line-clamp-3 text-[12.5px] italic leading-snug text-ink-tertiary">{thought}</p>}
            <TurnPresence
              visible={running && !approval}
              avatar={<BotAvatar bot={agent} size={28} state={phrases.phase === "chat.activity.thinking" ? "thinking" : "working"} forward={false} lookAround={1} trackPointer={false} />}
              phrases={phrases.phrases}
              phase={phrases.phase}
              seed={`${agent.id}:${threadId}:${requestId}`}
              since={task?.turnStartedAt ?? null}
            />
            {approval && (
              <div className="overflow-hidden rounded-2xl bg-composer ring-1 ring-composer-ring">
                <PendingApprovalPanel
                  key={approval.requestId}
                  pending={approval}
                  botName={agent.name}
                  count={approvals.length}
                  index={0}
                  actions={<PendingApprovalActions part="primary" pending={approval} threadId={threadId} bot={agent} onCancelTurn={() => dispatch({ type: "interrupt", botId: agent.id, threadId })} />}
                  more={<PendingApprovalActions part="more" pending={approval} threadId={threadId} bot={agent} onCancelTurn={() => dispatch({ type: "interrupt", botId: agent.id, threadId })} />}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
