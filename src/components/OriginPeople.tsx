import { useState, type CSSProperties } from "react";
import { cn } from "@/lib/cn";
import type { ProjectViewer } from "@/lib/origin-project-state";

export type Person = { name?: string; username?: string; email?: string; avatarUrl?: string | null };

export const memberName = (person: Person) => person.username || person.email?.split("@")[0] || person.name || "Member";

const TONES = ["#b5e853", "#7fd6e4", "#c9b3ff", "#f7cf7a", "#ff9a91", "#8ff0c2", "#9ec5ff", "#f5a8d4"];

export function personTone(person: Person): string {
  const seed = (person.email || person.username || person.name || "origin").toLowerCase();
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return TONES[hash % TONES.length]!;
}

function initials(person: Person): string {
  const label = (person.username || person.name || person.email || "O").trim();
  return label.split(/\s+/).slice(0, 2).map((part) => Array.from(part)[0] ?? "").join("").toUpperCase() || "O";
}

export function MemberAvatar({ person, size = 22, shape = "square", className }: { person: Person; size?: number; shape?: "round" | "square"; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const radius = shape === "square" ? Math.round(size * 0.28) : size;
  const style: CSSProperties = { width: size, height: size, borderRadius: radius };
  if (person.avatarUrl && failed !== person.avatarUrl) {
    return <img src={person.avatarUrl} alt="" draggable={false} onError={() => setFailed(person.avatarUrl ?? null)} style={style} className={cn("shrink-0 border border-hairline/70 object-cover", className)} />;
  }
  return (
    <span aria-hidden="true" style={{ ...style, background: personTone(person), fontSize: Math.max(8, Math.round(size * 0.42)) }}
      className={cn("inline-flex shrink-0 select-none items-center justify-center border border-hairline/70 font-semibold leading-none text-[#101214]", className)}>
      {initials(person).slice(0, size < 20 ? 1 : 2)}
    </span>
  );
}

/** Teammates who have this project open: small overlapping avatars, the person's own first. */
export function PresenceStack({ viewers, max = 2, className }: { viewers: readonly ProjectViewer[]; max?: number; className?: string }) {
  if (!viewers.length) return null;
  const names = viewers.map((viewer) => viewer.self ? "You" : memberName(viewer));
  const label = `${names.join(", ")} ${viewers.length === 1 && !viewers[0]!.self ? "is" : "are"} here`;
  return (
    <span role="img" aria-label={label} title={label} data-presence-stack className={cn("flex items-center", className)}>
      {viewers.slice(0, max).map((viewer, index) => (
        <span key={viewer.userId} style={{ zIndex: max - index }}
          className={cn("relative flex rounded-[6px] animate-pop-in", index > 0 && "-ml-[5px]", !viewer.self && "after:absolute after:-bottom-px after:-right-px after:size-[6px] after:rounded-full after:bg-success after:ring-1 after:ring-panel")}>
          <MemberAvatar person={viewer} size={18} />
        </span>
      ))}
      {viewers.length > max && (
        <span className="-ml-[5px] flex h-[18px] min-w-[18px] items-center justify-center rounded-[6px] border border-hairline/70 bg-raised px-1 text-[9px] font-semibold text-ink-secondary">+{viewers.length - max}</span>
      )}
    </span>
  );
}
