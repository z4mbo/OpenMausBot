import { Inter } from "next/font/google";

// Inter is the only interface font; tokens.css reads it through --font-inter.
export const interFont = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
