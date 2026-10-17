"use client";

import { useEffect, useState } from "react";

export function useContentTransition(contentKey: string) {
  const [visibleKey, setVisibleKey] = useState<string | null>(null);
  useEffect(() => {
    // Hold a brief placeholder so partially loaded views never flash; the motion layer animates the reveal.
    const timer = window.setTimeout(() => setVisibleKey(contentKey), 90);
    return () => window.clearTimeout(timer);
  }, [contentKey]);
  return visibleKey !== contentKey;
}
