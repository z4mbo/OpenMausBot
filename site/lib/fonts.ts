import { Archivo, Inter, Martian_Mono } from "next/font/google";

export const displayFont = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-display", display: "swap" });
export const bodyFont = Inter({ subsets: ["latin"], variable: "--font-body", display: "swap" });
export const monoFont = Martian_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });
