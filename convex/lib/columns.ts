export function normalizeColumnTitle(title: string) {
  return title.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

/** Issues in the draft column stay in Origin: they get no GitHub issue until they move to another column. */
export function isDraftColumn(column: { title: string; isDraft?: boolean }) {
  return column.isDraft ?? normalizeColumnTitle(column.title) === "draft";
}
