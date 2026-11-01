const REPOSITORY_NAME_MAX = 100;

/** A GitHub repository name for a project name: GitHub allows letters, digits, `.`, `-` and `_`; `.` and `..` are reserved. */
export function repositoryNameFor(projectName: string): string {
  const name = projectName.normalize("NFKD").replace(/[̀-ͯ]/g, "").trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-{2,}/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, REPOSITORY_NAME_MAX).replace(/[-.]+$/, "");
  return name || "project";
}

export function isRepositoryName(name: string): boolean {
  return name.length <= REPOSITORY_NAME_MAX && /^[A-Za-z0-9._-]+$/.test(name) && name !== "." && name !== "..";
}
