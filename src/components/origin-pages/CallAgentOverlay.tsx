import { Bookmark, BookmarkCheck, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import type { CallAgentControls } from "@/lib/call-agent";

/** Everyone in the call sees this while the agent is in it: it hears and transcribes the call. */
export function CallAgentBadge({ name, call }: { name: string; call: CallAgentControls }) {
  const session = call.session;
  if (!session) return null;
  return (
    <span className="flex min-w-0 items-center gap-1 rounded-full bg-accent/12 py-0.5 pl-2 pr-0.5 text-[12px] text-accent-text origin-pop-badge" role="status"
      title={`${name} was added by ${session.addedBy}. It transcribes the call; no audio is kept.`}>
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-accent animate-status-pulse" />
      <span className="truncate">{name} is listening</span>
      <button type="button" aria-pressed={session.keepTranscript} onClick={() => call.setKeep(!session.keepTranscript)}
        title={session.keepTranscript ? "The transcript is kept in the chief's chat after the summary" : "The transcript is deleted after the summary"}
        className="flex h-5 items-center gap-1 rounded-full px-1.5 text-[11.5px] outline-none transition-colors duration-(--motion-fast) hover:bg-accent/15 focus-visible:ring-1 focus-visible:ring-accent/60">
        {session.keepTranscript ? <BookmarkCheck size={12} aria-hidden="true" /> : <Bookmark size={12} aria-hidden="true" />}
        {session.keepTranscript ? "Keeping transcript" : "Keep transcript"}
      </button>
    </span>
  );
}

const line = "max-w-full rounded-lg bg-black/60 px-2.5 py-1 text-[13px] leading-snug text-white backdrop-blur-sm origin-sheet-in";

/** Live captions, the agent's answers among them, above the call controls. */
export function CallAgentCaptions({ name, call }: { name: string; call: CallAgentControls }) {
  const session = call.session;
  const state = call.participant?.state;
  const ended = !session && call.ended;
  if (!session && !ended) return null;
  return (
    <div className="pointer-events-none absolute inset-x-4 bottom-24 z-20 flex flex-col items-center gap-1" aria-live="polite" aria-label="Captions">
      {call.captions.map((caption) => (
        <p key={caption.id} className={cn(line, caption.agent && "bg-accent/85 text-accent-ink")}>
          <strong className="font-semibold">{caption.speaker}:</strong> {caption.text}
        </p>
      ))}
      {call.interim && <p className={cn(line, "italic text-white/75")}>{call.interim}</p>}
      {state === "thinking" && <p className={cn(line, "flex items-center gap-1.5")}><Loader2 size={12} className="animate-spin" aria-hidden="true" />{name} is thinking</p>}
      {session?.awaiting && state !== "thinking" && <p className={line}>{name} is waiting for {session.awaiting}'s question</p>}
      {session && call.notice && <p className={cn(line, "bg-danger/85")}>{call.notice}</p>}
      {ended && (
        <p className={line}>
          {ended.status === "summarizing" ? `${ended.name} is writing the call summary`
            : ended.status === "posted" ? `${ended.name} posted the call summary in its chat`
            : `The call summary failed: ${ended.error ?? "unknown error"}`}
        </p>
      )}
    </div>
  );
}
