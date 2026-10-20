import { Facebook, Instagram, Linkedin, Music2 } from "lucide-react";
import type { BroadcastChannel } from "../../../shared/broadcast";

function XMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.41l-5.8-7.58-6.64 7.58H.47l8.6-9.83L0 1.15h7.59l5.24 6.93zm-1.29 19.5h2.04L6.49 3.24H4.3z" />
    </svg>
  );
}

function BlueskyMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" aria-hidden="true">
      <path d="M12 11c-1.6-3.2-5.2-6.6-7.7-6.6C2.6 4.4 3 8 3.6 10c.6 2 2.4 2.7 4.4 2.5-2.6.6-3.4 2.3-1.9 3.9 2.6 2.8 4.4.4 5.9-2.7 1.5 3.1 3.3 5.5 5.9 2.7 1.5-1.6.7-3.3-1.9-3.9 2 .2 3.8-.5 4.4-2.5.6-2 1-5.6-.7-5.6-2.5 0-6.1 3.4-7.7 6.6z" />
    </svg>
  );
}

export function ChannelMark({ channel, size = 14 }: { channel: BroadcastChannel; size?: number }) {
  if (channel === "x") return <XMark size={size} />;
  if (channel === "bluesky") return <BlueskyMark size={size} />;
  const Icon = channel === "linkedin" ? Linkedin : channel === "facebook" ? Facebook : channel === "instagram" ? Instagram : Music2;
  return <Icon size={size} aria-hidden="true" />;
}
