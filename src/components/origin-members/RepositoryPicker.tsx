import { useEffect, useId, useState, type ReactNode } from "react";
import { Check, Clock3, FolderGit2, FolderPlus, Lock, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { originGitHub, type GitHubRepository } from "@/lib/origin-github";
import { isRepositoryName, repositoryNameFor } from "../../../shared/github-repo-name";
import type { RepositoryChoice } from "@/lib/origin-project-access";

const MODES: { id: RepositoryChoice["mode"]; title: string; body: string; icon: ReactNode }[] = [
  { id: "new", title: "Create new repo", body: "In the workspace's GitHub", icon: <FolderPlus size={15} /> },
  { id: "existing", title: "Use existing", body: "Pick or paste one", icon: <FolderGit2 size={15} /> },
  { id: "later", title: "Later", body: "Link one from Settings", icon: <Clock3 size={15} /> },
];

const GITHUB_REPO = /^(?:https:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i;

/** The repository URL a pasted `owner/repo` or GitHub link names, or null. */
export function pastedRepository(value: string): string | null {
  const match = GITHUB_REPO.exec(value.trim());
  return match ? `https://github.com/${match[1]}/${match[2]}` : null;
}

export function repositoryChoiceReady(choice: RepositoryChoice, projectName: string): boolean {
  return choice.mode === "later" || (choice.mode === "new" ? isRepositoryName(choice.name ?? repositoryNameFor(projectName)) : Boolean(choice.url));
}

export function RepositoryPicker({ teamId, projectName, value, onChange, disabled = false }: { teamId: string; projectName: string; value: RepositoryChoice; onChange(next: RepositoryChoice): void; disabled?: boolean }) {
  const name = useId();
  const [login, setLogin] = useState<string | null | undefined>(undefined);
  const [repositories, setRepositories] = useState<GitHubRepository[] | null>(null);
  const [listError, setListError] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let live = true;
    originGitHub.workspace(teamId).then((status) => { if (live) setLogin(status.login); }, () => { if (live) setLogin(null); });
    return () => { live = false; };
  }, [teamId]);

  useEffect(() => {
    if (value.mode !== "existing" || repositories || listError) return;
    let live = true;
    originGitHub.repositories(teamId).then(
      (result) => { if (live) setRepositories(result.repositories); },
      (error: unknown) => { if (live) setListError(error instanceof Error ? error.message : "Could not list repositories"); },
    );
    return () => { live = false; };
  }, [teamId, value.mode, repositories, listError]);

  const needle = query.trim().toLowerCase();
  const shown = (repositories ?? []).filter((repo) => !needle || repo.fullName.toLowerCase().includes(needle)).slice(0, 50);
  const pasted = value.mode === "existing" ? pastedRepository(query) : null;

  return (
    <div className="@container min-w-0"><fieldset disabled={disabled} className="min-w-0" data-project-repository>
      <legend className="mb-2 text-[13px] text-ink-secondary">GitHub repository</legend>
      <div role="radiogroup" aria-label="GitHub repository" className="grid grid-cols-1 gap-2 @[26rem]:grid-cols-3">
        {MODES.map((mode) => {
          const selected = value.mode === mode.id;
          return (
            <label key={mode.id}
              className={cn("group relative flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 transition-[border-color,background-color] duration-(--motion-fast) ease-out",
                selected ? "border-accent/70 bg-accent/[0.07]" : "border-hairline/60 hover:border-hairline hover:bg-raised/40",
                "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/60")}>
              <input type="radio" name={name} value={mode.id} aria-label={mode.title} checked={selected} className="sr-only"
                onChange={() => onChange(mode.id === "new" ? { mode: "new", name: value.mode === "new" ? value.name : null } : mode.id === "existing" ? { mode: "existing", url: pastedRepository(query) ?? "" } : { mode: "later" })} />
              <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors duration-(--motion-fast)", selected ? "bg-accent text-accent-ink" : "bg-raised text-ink-secondary group-hover:text-ink")} aria-hidden="true">{mode.icon}</span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-ink">{mode.title}</span>
                <span className="block text-[12px] leading-snug text-ink-tertiary">{mode.body}</span>
              </span>
            </label>
          );
        })}
      </div>

      {value.mode === "new" && (
        <div className="mt-2.5 origin-top motion-safe:animate-pop-in">
          <label className="flex min-w-0 items-center rounded-lg border border-hairline/60 bg-inset text-[13px] transition-colors focus-within:border-accent/70">
            <span className="shrink-0 truncate pl-2.5 text-ink-tertiary">{login ? `${login}/` : "github/"}</span>
            <input className="min-w-0 flex-1 bg-transparent py-1.5 pr-2.5 text-ink outline-none max-md:text-[16px]" aria-label="Repository name" maxLength={100}
              value={value.name ?? repositoryNameFor(projectName)} placeholder="repository-name" onChange={(event) => onChange({ mode: "new", name: event.target.value.trim() })} />
          </label>
          {value.name !== null && !isRepositoryName(value.name) && <p className="mt-1 text-[12px] text-danger" role="alert">Letters, digits, dots, dashes and underscores only.</p>}
          {login === null && <p className="mt-1 text-[12px] text-ink-tertiary">GitHub is not connected to this workspace yet; the repository is created once an admin connects it.</p>}
        </div>
      )}

      {value.mode === "existing" && (
        <div className="mt-2.5 origin-top overflow-hidden rounded-xl border border-hairline/50 bg-inset/40 motion-safe:animate-pop-in">
          <div className="flex items-center gap-2 border-b border-hairline/40 px-3 py-2">
            <Search size={13} className="shrink-0 text-ink-tertiary" aria-hidden="true" />
            <input value={query} onChange={(event) => { setQuery(event.target.value); const url = pastedRepository(event.target.value); if (url && url.toLowerCase() !== value.url.toLowerCase()) onChange({ mode: "existing", url }); }}
              placeholder="Search or paste owner/repo" aria-label="Search or paste a repository"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-tertiary max-md:text-[16px]" />
          </div>
          <ul className="max-h-48 overflow-y-auto py-1" aria-label="Repositories">
            {repositories === null && !listError && <li className="px-3 py-2 text-[12.5px] text-ink-tertiary">Loading repositories…</li>}
            {listError && <li className="px-3 py-2 text-[12.5px] text-ink-tertiary">{listError}</li>}
            {shown.map((repo) => {
              const on = repo.url.toLowerCase() === value.url.toLowerCase();
              return (
                <li key={repo.fullName}>
                  <button type="button" onClick={() => onChange({ mode: "existing", url: repo.url })} aria-pressed={on}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition-colors duration-(--motion-fast) hover:bg-raised/50">
                    <FolderGit2 size={13} className="shrink-0 text-ink-tertiary" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-ink">{repo.fullName}</span>
                    {repo.private && <Lock size={11} className="shrink-0 text-ink-tertiary" aria-label="Private" />}
                    <Check size={13} className={cn("shrink-0 text-accent-text transition-opacity duration-(--motion-fast)", on ? "opacity-100" : "opacity-0")} aria-hidden="true" />
                  </button>
                </li>
              );
            })}
            {repositories && !shown.length && !pasted && <li className="px-3 py-2 text-[12.5px] text-ink-tertiary">No repository matches.</li>}
            {pasted && !shown.some((repo) => repo.url.toLowerCase() === pasted.toLowerCase()) && (
              <li className="flex items-center gap-2 px-3 py-1.5 text-[13px] text-ink"><Check size={13} className="text-accent-text" aria-hidden="true" />{pasted.replace("https://github.com/", "")}</li>
            )}
          </ul>
        </div>
      )}
    </fieldset></div>
  );
}
