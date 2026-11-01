"use client";

import { useState, type CSSProperties } from "react";
import { displayName } from "@/lib/format";

export type AvatarIdentity = { name?: string; username?: string; email?: string; avatarUrl?: string | null };
/** The name people see everywhere: full name, then username, then the email's local part. */
export const memberName = (user: AvatarIdentity) => displayName(user) || "Member";

/** Up to two initials from the full name ("Alex Morgan" -> "AM"); one letter for single-word names. */
export function initials(user: AvatarIdentity) {
  const words = displayName(user).split(/[\s._-]+/).filter(Boolean);
  const letters = (words.length > 1 ? [words[0], words.at(-1)!] : words.slice(0, 1)).map(word => Array.from(word)[0]).join("");
  return letters.toUpperCase() || "O";
}

// Soft, dark-theme friendly tones. Each person keeps the same tone everywhere (avatars, Draw cursors).
const avatarTones = ["#b5e853", "#7fd6e4", "#c9b3ff", "#f7cf7a", "#ff9a91", "#8ff0c2", "#9ec5ff", "#f5a8d4"];
export function avatarTone(user: AvatarIdentity) {
  const seed = (user.email || user.username || user.name || "origin").toLowerCase();
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return avatarTones[hash % avatarTones.length];
}

export function UserAvatar({ user, size = "normal", className = "" }: { user: AvatarIdentity; size?: "normal" | "small"; className?: string }) {
  const [failedUrl, setFailedUrl] = useState<string>();
  const classes = `avatar origin-user-avatar ${size === "small" ? "small" : ""} ${className}`;
  const letters = initials(user);
  return user.avatarUrl && failedUrl !== user.avatarUrl
    ? <img className={`${classes} image`} src={user.avatarUrl} onError={() => setFailedUrl(user.avatarUrl || "")} alt="" />
    : <span className={classes} style={{ "--avatar-tone": avatarTone(user) } as CSSProperties} aria-hidden="true" data-initials={letters.length}>{letters}</span>;
}
