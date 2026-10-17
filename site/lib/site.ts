import type { Metadata, Viewport } from "next";

export const siteUrl = "https://origin.imbored.fun";

export const siteViewport: Viewport = {
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#fbfaf8" }, { media: "(prefers-color-scheme: dark)", color: "#070707" }],
};

export const siteIcons: Metadata["icons"] = {
  icon: [{ url: "/origin.svg", type: "image/svg+xml" }],
  apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
};
