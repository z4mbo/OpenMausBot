/** Signal bars for issue priority: one, two or three filled bars. */
export function PriorityIcon({ priority }: { priority?: string }) {
  const level = priority === "high" ? 3 : priority === "medium" ? 2 : priority === "low" ? 1 : 0;
  return <svg className={`priority-icon ${priority || ""}`} width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">{[0, 1, 2].map(bar => <rect key={bar} x={1 + bar * 4} y={8 - bar * 3} width="2.5" height={3 + bar * 3} rx="0.75" fill="currentColor" opacity={bar < level ? 1 : 0.28} />)}</svg>;
}

/** Workflow lane tone from a column title; drives lane and status colors. */
export function laneTone(title: string) {
  const normalized = title.trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (normalized === "idea") return "idea";
  if (normalized === "todo") return "todo";
  if (normalized === "done") return "done";
  if (normalized === "inprogress" || normalized === "doing") return "progress";
  if (normalized === "inreview" || normalized === "review") return "review";
  return "custom";
}

/** Status ring tinted with the lane color. */
export function StatusIcon({ title }: { title: string }) {
  return <svg className={`status-icon ${laneTone(title)}`} width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="5.25" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>;
}
