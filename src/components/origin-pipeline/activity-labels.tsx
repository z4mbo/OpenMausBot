import type { ReactNode } from "react";
import { ArrowRight, AudioLines, CircleDollarSign, Inbox, Mail, MessageCircle, MessageSquareText, Phone, StickyNote, Upload } from "lucide-react";
import type { PipelineActivity, PipelineActivityKind } from "../../../shared/origin-pipeline";

export const KIND_ICON: Record<PipelineActivityKind, ReactNode> = {
  note: <StickyNote size={13} />, email: <Mail size={13} />, sms: <MessageSquareText size={13} />, whatsapp: <MessageCircle size={13} />, call: <Phone size={13} />,
  ai_call: <AudioLines size={13} />, stage: <ArrowRight size={13} />, capture: <Inbox size={13} />, import: <Upload size={13} />, deal: <CircleDollarSign size={13} />,
};

export const KIND_LABEL: Record<PipelineActivityKind, string> = {
  note: "Note", email: "Email", sms: "Text", whatsapp: "WhatsApp", call: "Call", ai_call: "AI call", stage: "Stage", capture: "Form", import: "Imported", deal: "Deal",
};

export const STATUS_LABEL: Partial<Record<PipelineActivity["status"], string>> = {
  pending: "Awaiting approval", approved: "Approved", sending: "Sending", sent: "Sent", in_progress: "In progress", failed: "Failed", discarded: "Discarded", received: "New",
};

export const statusTone = (status: PipelineActivity["status"]) =>
  status === "pending" ? "bg-accent/15 text-accent-text" : status === "failed" ? "bg-danger/10 text-danger" : status === "in_progress" ? "bg-warning/10 text-warning" : "bg-raised text-ink-secondary";

export const when = (at: number) => new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function ago(at: number, now = Date.now()): string {
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return days < 7 ? `${days}d` : new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function since(at: number, now = Date.now()): string {
  const value = ago(at, now);
  return value === "now" ? "just now" : /^\d+[mhd]$/.test(value) ? `${value} ago` : `on ${value}`;
}
