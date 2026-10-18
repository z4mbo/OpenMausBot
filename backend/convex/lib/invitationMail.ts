import { normalizeOriginBackendUrl, resolveOriginSiteAddress } from "../../../shared/origin-site-address";
import type { OriginInviteDeliveryStatus } from "../../../shared/origin-site-address";

export function invitationAddress() {
  const convexUrl = normalizeOriginBackendUrl(process.env.CONVEX_CLOUD_URL);
  return { convexUrl, origin: resolveOriginSiteAddress({ convexUrl, siteUrl: process.env.ORIGIN_SITE_URL, publicUrl: process.env.ORIGIN_PUBLIC_URL }) };
}

export async function deliverInvitation(mail: { email: string; teamName: string; inviteLink: string }): Promise<OriginInviteDeliveryStatus> {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.INVITE_FROM_EMAIL?.trim();
  if (!key || !from) return "not_configured";
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: mail.email, subject: `Join ${mail.teamName} on Origin`, text: `You've been invited to ${mail.teamName}. Join your workspace: ${mail.inviteLink}\nThis invitation expires in 7 days.` }),
      signal: AbortSignal.timeout(15_000),
    });
    return response.ok ? "accepted" : "failed";
  } catch {
    return "failed";
  }
}
