import type { Metadata } from "next";
import { siteIcons, siteViewport } from "@/lib/site";
import { AuthPage } from "@/components/auth-page";

export const metadata: Metadata = { title: "Join a workspace | Origin", robots: { index: false }, icons: siteIcons };
export const viewport = siteViewport;

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <AuthPage mode="signup" inviteToken={token} />;
}
