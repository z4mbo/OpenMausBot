/** Signal bars for issue priority: one, two or three filled bars. */
export function PriorityIcon({ priority }: { priority?: string }) {
  const level = priority === "high" ? 3 : priority === "medium" ? 2 : priority === "low" ? 1 : 0;
  return <svg className="priority-icon" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">{[0, 1, 2].map(bar => <rect key={bar} x={1 + bar * 4} y={8 - bar * 3} width="2.5" height={3 + bar * 3} rx="0.75" fill="currentColor" opacity={bar < level ? 1 : 0.28} />)}</svg>;
}
