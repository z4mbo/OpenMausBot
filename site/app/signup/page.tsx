import type { Metadata } from "next";
import { siteIcons, siteViewport } from "@/lib/site";
import { AuthPage } from "@/components/auth-page";

export const metadata: Metadata = { title: "Create your account | Origin", icons: siteIcons };
export const viewport = siteViewport;

export default function SignupPage() {
  return <AuthPage mode="signup" />;
}
