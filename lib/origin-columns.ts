export const DRAFT_COLUMN_TITLE = "Draft";
export const DEFAULT_WORKFLOW_COLUMNS = [DRAFT_COLUMN_TITLE, "Todo", "In progress"] as const;

export const normalizedColumnTitle = (title: unknown): string => (typeof title === "string" ? title.trim().toLowerCase().replace(/[\s_-]+/g, "") : "");

/**
 * Issues in the draft column stay in Origin: they get no GitHub issue until they move to another column. A column
 * keeps `isDraft` once flagged, even when renamed; without the flag the title "Draft" decides.
 */
export function isDraftColumn(column: { title?: unknown; isDraft?: unknown }): boolean {
  return typeof column.isDraft === "boolean" ? column.isDraft : normalizedColumnTitle(column.title) === "draft";
}

/** The first column of boards created before drafts, which becomes the draft column. */
export const isLegacyIdeaColumn = (column: { title?: unknown; isDraft?: unknown }): boolean =>
  column.isDraft === undefined && normalizedColumnTitle(column.title) === "idea";

export function compareWorkflowColumns(a: { title?: unknown; isDraft?: unknown; order: number }, b: { title?: unknown; isDraft?: unknown; order: number }): number {
  return Number(isDraftColumn(b)) - Number(isDraftColumn(a)) || a.order - b.order;
}
