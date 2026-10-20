import { useState } from "react";
import { COPY_FEEDBACK_MS, copyText } from "@/lib/copy-text";

export type PublishedPage = {
  _id: string;
  canvasId: string;
  frameId: string;
  slug: string;
  title: string;
  description: string;
  url: string;
  views: number;
  leads: number;
  leadForms: number;
  publishedBy: string;
  updatedAt: number;
};

export type PagesList = { pages: PublishedPage[]; captureEnabled: boolean };

export const countLabel = (count: number, one: string, many: string) => `${count.toLocaleString()} ${count === 1 ? one : many}`;

export function useCopied(): [string | null, (text: string) => void] {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (text: string) => {
    void copyText(text).then((result) => {
      if (result !== "copied") return;
      setCopied(text);
      window.setTimeout(() => setCopied((current) => (current === text ? null : current)), COPY_FEEDBACK_MS);
    });
  };
  return [copied, copy];
}
