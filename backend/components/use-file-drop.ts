"use client";
import { useRef, useState, type DragEvent } from "react";
import { droppedLink } from "@/lib/dropped-content";

export function useFileDrop({ disabled, onFiles, onLink }: { disabled?: boolean; onFiles: (files: File[]) => void; onLink: (url: string) => void }) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const accepts = (event: DragEvent) => Array.from(event.dataTransfer.types).some(type => ["Files", "text/uri-list", "text/plain"].includes(type));
  return { dragging, handlers: {
    onDragEnter(event: DragEvent) { if (!accepts(event)) return; event.preventDefault(); event.stopPropagation(); if (!disabled) { depth.current++; setDragging(true); } },
    onDragOver(event: DragEvent) { if (!accepts(event)) return; event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = disabled ? "none" : "copy"; },
    onDragLeave(event: DragEvent) { if (!accepts(event)) return; event.preventDefault(); event.stopPropagation(); if (--depth.current <= 0) { depth.current = 0; setDragging(false); } },
    onDrop(event: DragEvent) {
      if (!accepts(event)) return;
      event.preventDefault(); event.stopPropagation(); depth.current = 0; setDragging(false);
      if (disabled) return;
      const files = Array.from(event.dataTransfer.files);
      if (files.length) onFiles(files);
      else { const url = droppedLink(event.dataTransfer.getData("text/uri-list"), event.dataTransfer.getData("text/plain")); if (url) onLink(url); }
    },
  } };
}
