type Column = Record<string, unknown>;
const title = (column: Column): string => typeof column.title === "string" ? column.title : "";

export const normalizedTitle = (value: string): string => value.trim().toLowerCase().replace(/[\s_-]+/g, "");

export function findColumn(columns: Column[], wanted: string): Column | undefined {
  const key = normalizedTitle(wanted);
  return columns.find((column) => column._id === wanted) ?? columns.find((column) => normalizedTitle(title(column)) === key);
}

export function columnNames(columns: Column[]): string {
  return columns.map((column) => `"${title(column)}"`).join(", ");
}
