import { normalizeOriginBackendUrl, resolveOriginSiteAddress } from "../../../shared/origin-site-address";
import type { OriginInviteDeliveryStatus } from "../../../shared/origin-site-address";

export function invitationAddress() {
  const convexUrl = normalizeOriginBackendUrl(process.env.CONVEX_CLOUD_URL);
  return { convexUrl, origin: resolveOriginSiteAddress({ convexUrl, siteUrl: process.env.ORIGIN_SITE_URL, publicUrl: process.env.ORIGIN_PUBLIC_URL }) };
}

function brevoSender(from: string): { email: string; name?: string } | null {
  if (from.length > 320) return null;
  for (const character of from) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return null;
  }
  const named = /^(?:"([^"<>]+)"|([^"<>]+))\s*<([^<>]+)>$/.exec(from);
  const email = named ? named[3].trim() : from;
  const name = named ? (named[1] ?? named[2]).trim() : undefined;
  const [local, domain, extra] = email.split("@");
  if (extra !== undefined || !local || !domain || email.length > 254 || local.length > 64
    || !/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local) || local.startsWith(".") || local.endsWith(".") || local.includes("..")) return null;
  const labels = domain.split(".");
  if (labels.length < 2 || labels.some(label => label.length > 63 || !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(label))) return null;
  if (named && !name) return null;
  return name ? { email, name } : { email };
}

export async function deliverInvitation(mail: { email: string; teamName: string; inviteLink: string }): Promise<OriginInviteDeliveryStatus> {
  const provider = process.env.ORIGIN_INVITE_MAIL_PROVIDER?.trim() || "resend";
  const key = (provider === "resend" ? process.env.RESEND_API_KEY : provider === "brevo" ? process.env.BREVO_API_KEY : undefined)?.trim();
  const from = process.env.INVITE_FROM_EMAIL?.trim();
  if (!key || !from) return "not_configured";
  const sender = provider === "brevo" ? brevoSender(from) : null;
  if (provider === "brevo" && !sender) return "not_configured";
  const subject = `Join ${mail.teamName} on Origin`;
  const text = `You've been invited to ${mail.teamName}. Join your workspace: ${mail.inviteLink}\nThis invitation expires in 7 days.`;
  try {
    const response = await fetch(provider === "brevo" ? "https://api.brevo.com/v3/smtp/email" : "https://api.resend.com/emails", {
      method: "POST",
      headers: provider === "brevo" ? { "api-key": key, "Content-Type": "application/json" } : { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(provider === "brevo" ? { sender, to: [{ email: mail.email }], subject, textContent: text } : { from, to: mail.email, subject, text }),
      signal: AbortSignal.timeout(15_000),
    });
    return response.ok ? "accepted" : "failed";
  } catch {
    return "failed";
  }
}
