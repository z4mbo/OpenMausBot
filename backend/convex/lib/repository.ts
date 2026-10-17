export function repositoryUrl(value?: string) {
  if (!value?.trim()) return undefined;
  const match = value.trim().match(/^(?:(?:https?:\/\/github\.com\/|git@github\.com:))?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  if (!match || [".", ".."].includes(match[1]) || [".", ".."].includes(match[2])) throw new Error("Use a GitHub repository URL or owner/repository");
  return `https://github.com/${match[1]}/${match[2]}`;
}
