"use client";
import { useDeferredValue, useState } from "react";
import { useQuery } from "convex/react";
import { Check, Search } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "./workspace-context";
import { ContentSkeleton } from "./content-skeleton";

export function FeatureIssuePicker({ sessionToken, projectId, done, selected, onSelect }: { sessionToken: string; projectId?: Id<"projects">; done?: boolean; selected: string[]; onSelect: (taskId: Id<"tasks">, title: string) => void }) {
  const workspace = useWorkspace();
  const [search, setSearch] = useState("");
  const text = useDeferredValue(search);
  const rows = useQuery(api.workspaceSearch.issues, { sessionToken, teamId: workspace._id, projectId, done, text });
  return <div className="feature-issue-picker"><label className="feature-search"><Search size={15} /><input aria-label="Find issues" placeholder="Find an issue..." value={search} onChange={event => setSearch(event.target.value)} /></label><div className="feature-picker-results">{rows === undefined ? <ContentSkeleton rows={3} /> : rows.length ? rows.map(row => <button key={row._id} type="button" aria-pressed={selected.includes(row._id)} onClick={() => onSelect(row._id, row.title)}><span className="feature-picker-check">{selected.includes(row._id) && <Check size={13} />}</span><span>{row.title}</span></button>) : <p className="muted">No matching issues</p>}</div></div>;
}
