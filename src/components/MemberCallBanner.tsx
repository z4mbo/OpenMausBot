import { Mic, MicOff, PhoneOff, Video, VideoOff } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatElapsed } from "@/lib/member-call";
import { useMemberCallState, useVisibleCallPage } from "@/lib/member-call-session";
import type { MemberCallState } from "./origin-pages/CallPage";
import { PersonAvatar } from "./origin-pages/PersonAvatar";
import { BotAvatar } from "./Avatar";

const SHOWN = 4;

/** The call the person is in while its page is elsewhere: who is there, quick controls, and the way back. */
export function MemberCallBanner({ iconOnly = false }: { iconOnly?: boolean }) {
  const call = useMemberCallState<MemberCallState>();
  const visible = useVisibleCallPage();
  if (!call?.inCall || visible === call.key) return null;
  const people = [call.self, ...call.others];
  const agentSpeaking = call.callAgent.participant?.state === "speaking";
  const listening = Boolean(call.callAgent.session || call.callAgent.participant);
  const speakers = people.filter((person) => call.speaking.has(person.userId)).map((person) => (person.userId === call.self.userId ? "You" : person.username || person.name));
  const control = "flex size-7 shrink-0 items-center justify-center rounded-lg outline-none transition-colors duration-100 focus-visible:ring-2 focus-visible:ring-accent/60";
  const back = `Back to the ${call.name} call`;

  if (iconOnly) {
    return (
      <div className="mx-auto mb-1 flex flex-col items-center gap-1 rounded-xl border border-hairline/50 bg-raised/60 p-1 origin-sheet-in" data-member-call-banner>
        <button type="button" onClick={call.open} title={back} aria-label={back}
          className="flex size-9 items-center justify-center rounded-lg outline-none hover:bg-raised focus-visible:ring-2 focus-visible:ring-accent/60">
          <span className="relative"><PersonAvatar person={call.self} size={24} /><span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-success ring-2 ring-panel" /></span>
        </button>
        <button type="button" className={cn(control, "bg-danger text-white hover:brightness-110")} aria-label="Leave call" title="Leave call" onClick={() => void call.leaveCall()}><PhoneOff size={14} /></button>
      </div>
    );
  }

  return (
    <div data-member-call-banner className="mx-3 mb-1.5 rounded-xl border border-hairline/50 bg-raised/50 origin-sheet-in">
      <button type="button" onClick={call.open} title={back} aria-label={back}
        className="flex w-full min-w-0 items-center gap-2 rounded-t-xl px-2.5 pb-1 pt-2 text-left outline-none hover:bg-raised/60 focus-visible:ring-2 focus-visible:ring-accent/60">
        <span className="size-2 shrink-0 rounded-full bg-success" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">{call.name}</span>
        <time className="shrink-0 font-mono text-[11px] tabular-nums text-ink-tertiary" aria-label="Time in call">{formatElapsed(call.elapsed)}</time>
      </button>
      <div className="flex items-center gap-1.5 px-2.5 pb-2 pt-1">
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="flex shrink-0 items-center" aria-hidden="true">
            {people.slice(0, SHOWN).map((person, index) => (
              <span key={person.userId} style={{ zIndex: SHOWN - index }}
                className={cn("rounded-[7px] ring-2 transition-shadow duration-100", index > 0 && "-ml-1.5", call.speaking.has(person.userId) ? "ring-success" : "ring-panel")}>
                <PersonAvatar person={person} size={20} />
              </span>
            ))}
            {call.agent && listening && (
              <span className={cn("-ml-1.5 rounded-full ring-2", agentSpeaking ? "ring-success" : "ring-panel")}><BotAvatar bot={call.agent} size={20} animated={false} /></span>
            )}
          </span>
          <span className="min-w-0 truncate text-[11.5px] text-ink-tertiary" aria-live="polite">
            {agentSpeaking && call.agent ? call.agent.name : speakers.length ? speakers.join(", ") : listening && call.agent ? `${call.agent.name} listening` : `${people.length} in call`}
          </span>
        </span>
        <button type="button" className={cn(control, call.audioEnabled ? "text-ink-secondary hover:bg-raised hover:text-ink" : "bg-danger/90 text-white")}
          aria-label={call.audioEnabled ? "Mute microphone" : "Unmute microphone"} title={call.audioEnabled ? "Mute" : "Unmute"} onClick={() => void call.toggle("audio")}>
          {call.audioEnabled ? <Mic size={14} /> : <MicOff size={14} />}
        </button>
        <button type="button" className={cn(control, call.videoEnabled ? "text-ink-secondary hover:bg-raised hover:text-ink" : "bg-danger/90 text-white")}
          aria-label={call.videoEnabled ? "Turn camera off" : "Turn camera on"} title={call.videoEnabled ? "Camera off" : "Camera on"} onClick={() => void call.toggle("video")}>
          {call.videoEnabled ? <Video size={14} /> : <VideoOff size={14} />}
        </button>
        <button type="button" className={cn(control, "bg-danger text-white hover:brightness-110")} aria-label="Leave call" title="Leave call" onClick={() => void call.leaveCall()}>
          <PhoneOff size={14} />
        </button>
      </div>
    </div>
  );
}
