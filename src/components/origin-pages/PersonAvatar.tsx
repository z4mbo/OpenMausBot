import { useState } from "react";

export type AvatarPerson = { name?: string; username?: string; email: string; avatarUrl?: string | null };

export function PersonAvatar({ person, size = 28 }: { person: AvatarPerson; size?: number }) {
  const [broken, setBroken] = useState(false);
  const label = person.username || person.name || person.email;
  if (person.avatarUrl && !broken) {
    return <img src={person.avatarUrl} alt="" onError={() => setBroken(true)} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <span aria-hidden="true" className="flex shrink-0 items-center justify-center rounded-full bg-raised font-semibold text-ink-secondary"
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.4)) }}>
      {label.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}
