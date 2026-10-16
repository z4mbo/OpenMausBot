import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { readPRSnapshot } from "../lib/github-prs";
import { githubRequest } from "../lib/github-workspace";

test("PG3 live disposable GitHub PR: production snapshot reader sees open then closed state", async () => {
  const fixture = JSON.parse(readFileSync("../.omb-scratch/pg3/sandbox.json", "utf8")) as { repo: string; branch: string; url: string };
  expect(fixture.repo).toBe("z4mbo/origin-pr-sandbox");
  expect(fixture.branch).toMatch(/^pg3\/parity-\d+$/);
  const number = Number(new URL(fixture.url).pathname.split("/").at(-1));
  expect(Number.isSafeInteger(number) && number > 0).toBe(true);
  const token = execFileSync("gh", ["auth", "token"], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
  const repoUrl = `https://github.com/${fixture.repo}`;
  const initial = await githubRequest<{ title: string; head: { ref: string }; user: { login: string }; state: string }>(`/repos/${fixture.repo}/pulls/${number}`, token);
  expect(initial.title).toBe("test: disposable PG3 parity acceptance");
  expect(initial.head.ref).toBe(fixture.branch);
  expect(initial.user.login).toBe("z4mbo");
  try {
    const open = await readPRSnapshot(repoUrl, number, token);
    expect(open).toMatchObject({ number, url: fixture.url, branch: fixture.branch, state: "open" });
    expect(open.headSha).toMatch(/^[a-f0-9]{40}$/);
    await githubRequest(`/repos/${fixture.repo}/pulls/${number}`, token, { method: "PATCH", body: JSON.stringify({ state: "closed" }) });
    const closed = await readPRSnapshot(repoUrl, number, token);
    expect(closed).toMatchObject({ number, branch: fixture.branch, headSha: open.headSha, state: "closed" });
    writeFileSync("../.omb-scratch/pg3/sandbox-result.json", JSON.stringify({ fixture, credential: "existing gh OAuth session; no App installation token", open, closed }, null, 2));
  } finally {
    await githubRequest(`/repos/${fixture.repo}/pulls/${number}`, token, { method: "PATCH", body: JSON.stringify({ state: "closed" }) });
  }
});
