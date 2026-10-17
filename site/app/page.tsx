import type { Metadata } from "next";
import { siteIcons, siteViewport } from "@/lib/site";
import { OriginSite } from "@/components/origin-site";

const description = "Origin is a desktop app where people and AI agents work together. Every project gets a Chief and a team of agents that pick up issues and open pull requests, running on your machine.";

export const metadata: Metadata = {
  title: "Origin | Agent teams that ship your projects",
  description,
  openGraph: { title: "Origin", description, images: [{ url: "/og.png", width: 1200, height: 630, alt: "The Origin logo and the line: every project gets a team of agents that ships." }] },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
  icons: siteIcons,
};

export const viewport = siteViewport;

export default function Page() {
  return <OriginSite />;
}
