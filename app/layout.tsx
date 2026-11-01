import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./product.css";
import "./interaction.css";
import "./features.css";
import "./project-workflow.css";
import "./experience.css";
import "./workspace-refinement.css";
// Loaded globally: CSS imported only inside the dynamically loaded workspace chunk is never attached in dev.
import "@/components/project-issues.css";
import "@/components/agent-settings.css";
import { Providers } from "./providers";
import { bodyFont, displayFont, monoFont } from "@/lib/fonts";
import { siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Origin | A workspace for your team",
  description: "A shared space for your projects, conversations, and ideas. Plan the work, sketch together, and keep your team connected with Origin.",
  openGraph: { title: "Origin", description: "One workspace for issues, chat, calls, and a shared canvas.", images: [{ url: "/og.png", width: 1200, height: 630, alt: "The Origin workspace" }] },
  icons: [{ rel: "icon", url: "/origin.svg" }],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#070708",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${displayFont.variable} ${bodyFont.variable} ${monoFont.variable}`} suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
