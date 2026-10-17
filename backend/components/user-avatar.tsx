"use client";

import { useState, type CSSProperties } from "react";

export type AvatarIdentity = { name?: string; username?: string; email?: string; avatarUrl?: string | null };
export const memberName = (user: AvatarIdentity) => user.username || user.email?.split("@")[0] || user.name || "Member";

// Soft, dark-theme friendly tones. Each person keeps the same tone everywhere.
const avatarTones = ["#b5e853", "#7fd6e4", "#c9b3ff", "#f7cf7a", "#ff9a91", "#8ff0c2", "#9ec5ff", "#f5a8d4"];
export function avatarTone(user: AvatarIdentity) {
  const seed = (user.email || user.username || user.name || "origin").toLowerCase();
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return avatarTones[hash % avatarTones.length];
}

export function UserAvatar({ user, size = "normal", className = "" }: { user: AvatarIdentity; size?: "normal" | "small"; className?: string }) {
  const [failedUrl, setFailedUrl] = useState<string>();
  const label = user.username || user.name || user.email || "O";
  const letters = label.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join("").toUpperCase();
  const classes = `avatar origin-user-avatar ${size === "small" ? "small" : ""} ${className}`;
  return user.avatarUrl && failedUrl !== user.avatarUrl
    ? <img className={`${classes} image`} src={user.avatarUrl} onError={() => setFailedUrl(user.avatarUrl || "")} alt="" />
    : <span className={classes} style={{ "--avatar-tone": avatarTone(user) } as CSSProperties} aria-hidden="true">{letters || "O"}</span>;
}
