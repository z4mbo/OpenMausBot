import { cn } from "@/lib/cn";

function initials(name: string, email: string): string {
  const words = (name || email).trim().split(/[\s@._-]+/).filter(Boolean);
  return (words.length > 1 ? words[0]![0]! + words[1]![0]! : (words[0] ?? "?").slice(0, 2)).toUpperCase();
}

export function MemberAvatar({ person, className }: { person: { name: string; email: string; avatarUrl?: string | null }; className?: string }) {
  if (person.avatarUrl) return <img src={person.avatarUrl} alt="" className={cn("size-8 shrink-0 rounded-full object-cover", className)} />;
  return (
    <span aria-hidden="true" className={cn("flex size-8 shrink-0 items-center justify-center rounded-full bg-raised text-[12px] font-semibold text-ink-secondary", className)}>
      {initials(person.name, person.email)}
    </span>
  );
}
