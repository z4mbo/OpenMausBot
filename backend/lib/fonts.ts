import { Archivo, Inter, Martian_Mono } from "next/font/google";

// Archivo for display headings, Inter for the interface, Martian Mono for issue keys and counts.
export const displayFont = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-display", display: "swap" });
export const bodyFont = Inter({ subsets: ["latin"], variable: "--font-body", display: "swap" });
export const monoFont = Martian_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });
