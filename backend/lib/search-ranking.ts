export function searchScore(label: string, query: string) {
  const text = label.trim().toLocaleLowerCase();
  const value = query.trim().toLocaleLowerCase();
  if (!value) return 0;
  if (text === value) return 4;
  if (text.startsWith(value)) return 3;
  if (text.split(/\s+/).some(word => word.startsWith(value))) return 2;
  if (text.includes(value)) return 1;
  return 0;
}

export function rankSearchResults<T extends { label: string }>(results: T[], query: string) {
  return [...results].sort((a, b) => searchScore(b.label, query) - searchScore(a.label, query));
}
