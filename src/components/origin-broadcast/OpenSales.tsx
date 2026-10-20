import { useEffect } from "react";
import { openSales } from "@/lib/origin-publish-mode";

/** The old Sales section, which now lives in Publish. */
export function OpenSales({ botId }: { botId: string }) {
  useEffect(() => openSales(botId), [botId]);
  return null;
}
