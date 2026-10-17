import type { ReactNode } from "react";
import { ConvexProvider } from "convex/react";
import { cloudClient } from "./client";
import { useCloudUrl } from "./hooks";

export function CloudProvider({ children }: { children?: ReactNode }) {
  const url = useCloudUrl();
  const client = url ? cloudClient() : null;
  if (!client) return <>{children}</>;
  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
