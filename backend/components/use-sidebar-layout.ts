"use client";

import { useEffect, useState } from "react";
import { parseSidebarLayout } from "@/lib/sidebar-layout";

export function useSidebarLayout(userId: string) {
  const key = `origin.sidebar.${userId}`;
  const [layout, setLayout] = useState(() => parseSidebarLayout(null));
  const [loadedKey, setLoadedKey] = useState("");
  useEffect(() => {
    try { setLayout(parseSidebarLayout(localStorage.getItem(key))); }
    catch { setLayout(parseSidebarLayout(null)); }
    setLoadedKey(key);
  }, [key]);
  useEffect(() => {
    if (loadedKey !== key) return;
    try { localStorage.setItem(key, JSON.stringify(layout)); } catch { /* Keep the layout usable without storage. */ }
  }, [key, layout, loadedKey]);
  return [layout, setLayout] as const;
}
