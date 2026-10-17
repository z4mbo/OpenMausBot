export type ProjectSort = "manual" | "recent" | "oldest" | "name";
export const projectSortOptions: { value: ProjectSort; label: string }[] = [
  { value: "manual", label: "Custom order" },
  { value: "recent", label: "Recently updated" },
  { value: "oldest", label: "Least recently updated" },
  { value: "name", label: "Name A to Z" },
];
export function sortProjects<T extends { name: string; updatedAt: number; _id: string }>(projects: T[], sort: ProjectSort): T[] {
  if (sort === "manual") return projects;
  return [...projects].sort((a, b) => {
    const byName = a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }) || a._id.localeCompare(b._id);
    return sort === "name" ? byName : (sort === "recent" ? b.updatedAt - a.updatedAt : a.updatedAt - b.updatedAt) || byName;
  });
}
