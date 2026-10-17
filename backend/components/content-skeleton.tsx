export function ContentSkeleton({ kind = "list", label = "Loading content", rows = 5 }: { kind?: "list" | "chat" | "board" | "canvas"; label?: string; rows?: number }) {
  return <div className={`content-skeleton skeleton-${kind}`} role="status" aria-label={label}>
    <span className="sr-only">{label}</span>
    <div aria-hidden="true" className="skeleton-content">{Array.from({ length: kind === "board" ? 3 : kind === "canvas" ? 1 : rows }, (_, index) => <div className="skeleton-row" key={index}>
      {kind === "chat" && <i className="skeleton-block skeleton-avatar" />}
      <div className="skeleton-lines"><i className="skeleton-block skeleton-short" /><i className="skeleton-block" />{kind !== "list" && <i className="skeleton-block skeleton-medium" />}</div>
    </div>)}</div>
  </div>;
}

export function WorkspaceSkeleton() {
  return <main className="workspace-skeleton" aria-busy="true"><aside><ContentSkeleton rows={8} label="Loading navigation" /></aside><ContentSkeleton kind="board" label="Loading workspace" /></main>;
}
