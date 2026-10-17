export type ParsedGitHubRepo = { owner: string; repo: string };

export function parseGitHubRepo(repoUrl?: string): ParsedGitHubRepo | null {
  if (!repoUrl) return null;
  const value = repoUrl.trim();
  const shorthand = value.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (shorthand) return { owner: shorthand[1], repo: shorthand[2].replace(/\.git$/i, "") };
  const match = value.match(/^(?:https?:\/\/github\.com\/|git@github\.com:)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  if (!match) return null;
  return { owner: match[1], repo: match[2].replace(/\.git$/i, "") };
}

export function githubHeaders(token?: string) {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "origin-dashboard",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export function githubRepoUrl(repo: ParsedGitHubRepo) {
  return `https://github.com/${repo.owner}/${repo.repo}`;
}

export function manualIssueUrl(repo: ParsedGitHubRepo, title: string, body: string) {
  const params = new URLSearchParams();
  if (title.trim()) params.set("title", title.trim());
  if (body.trim()) params.set("body", body.trim());
  return `${githubRepoUrl(repo)}/issues/new?${params.toString()}`;
}
