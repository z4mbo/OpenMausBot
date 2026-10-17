"use client";
import { ContentSkeleton } from "./content-skeleton";

import dynamic from "next/dynamic";
import type { Id } from "@/convex/_generated/dataModel";
const Canvas = dynamic(() => {
  (window as Window & { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = "/excalidraw/";
  return import("./drawing-canvas");
}, { ssr: false, loading: () => <ContentSkeleton kind="canvas" label="Loading drawing" /> });

export function DrawView({ sessionToken, user, canvasId, readOnly, name }: { sessionToken: string; user: { _id: string; name: string }; canvasId?: Id<"canvases">; readOnly?: boolean; name?: string }) {
  return <section className="draw-view" aria-label="Draw"><Canvas key={canvasId || "workspace"} sessionToken={sessionToken} user={user} canvasId={canvasId} readOnly={readOnly} name={name} /></section>;
}
