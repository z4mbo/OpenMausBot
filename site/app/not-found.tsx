import type { Metadata } from "next";
import { siteIcons, siteViewport } from "@/lib/site";
import { OriginSite } from "@/components/origin-site";

export const metadata: Metadata = { title: "Origin", robots: { index: false }, icons: siteIcons };
export const viewport = siteViewport;

export default function NotFound() {
  return <OriginSite />;
}
