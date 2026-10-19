import { z } from "zod";
import { repositoryPath } from "./app.ts";
import { githubRequest, type GitHubService } from "./service.ts";

const issueReferences = z.object({
  nodes: z.array(z.object({ number: z.number().int().positive(), repository: z.object({ nameWithOwner: z.string() }) }).nullable()),
  pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
});
const pullReferences = z.object({ closingIssuesReferences: issueReferences }).nullable();
const closingReferencesReply = z.object({
  errors: z.array(z.unknown()).optional(),
  data: z.object({ repository: z.object({ pullRequest: pullReferences }).nullable() }).optional(),
});
const FIELDS = "nodes{number repository{nameWithOwner}} pageInfo{hasNextPage endCursor}";
const UNAVAILABLE = "GitHub closing issue references are unavailable; retry before merging";

function sameRepositoryNumbers(references: z.infer<typeof issueReferences>, repo: string): number[] {
  return references.nodes.flatMap((issue) => issue?.repository.nameWithOwner.toLowerCase() === repo.toLowerCase() ? [issue.number] : []);
}

/** GitHub's closing references include manual links and repository identity: https://docs.github.com/en/graphql/reference/pulls#pullrequest */
export async function readClosingIssueNumbers(service: Pick<GitHubService, "fetch">, repoUrl: string, number: number, token: string): Promise<number[]> {
  const repo = repositoryPath(repoUrl).slice("/repos/".length);
  const [owner, name] = repo.split("/");
  const found = new Set<number>();
  const cursors = new Set<string>();
  let cursor: string | null = null;
  for (;;) {
    const reply = closingReferencesReply.parse(await githubRequest(service, "/graphql", token, {
      method: "POST",
      body: JSON.stringify({
        query: `query($owner:String!,$name:String!,$number:Int!,$cursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){closingIssuesReferences(first:100,after:$cursor){${FIELDS}}}}}`,
        variables: { owner, name, number, cursor },
      }),
    }));
    const references = reply.data?.repository?.pullRequest?.closingIssuesReferences;
    if (reply.errors?.length || !references) throw new Error(UNAVAILABLE);
    for (const issue of sameRepositoryNumbers(references, repo)) found.add(issue);
    if (!references.pageInfo.hasNextPage) return [...found];
    cursor = references.pageInfo.endCursor;
    if (!cursor || cursors.has(cursor)) throw new Error("GitHub closing issue references could not be paginated");
    cursors.add(cursor);
  }
}

const closingReferencesBatchReply = z.object({
  errors: z.array(z.unknown()).optional(),
  data: z.object({ repository: z.record(z.string(), pullReferences).nullable() }).optional(),
});

export async function readClosingIssuesForPulls(service: Pick<GitHubService, "fetch">, repoUrl: string, numbers: readonly number[], token: string): Promise<Map<number, number[]>> {
  if (!numbers.length) return new Map();
  if (numbers.some((number) => !Number.isSafeInteger(number) || number < 1)) throw new Error("Invalid pull request number");
  const repo = repositoryPath(repoUrl).slice("/repos/".length);
  const [owner, name] = repo.split("/");
  const pulls = numbers.map((number, index) => `pull${index}:pullRequest(number:${number}){closingIssuesReferences(first:100){${FIELDS}}}`).join(" ");
  const reply = closingReferencesBatchReply.parse(await githubRequest(service, "/graphql", token, {
    method: "POST", body: JSON.stringify({ query: `query($owner:String!,$name:String!){repository(owner:$owner,name:$name){${pulls}}}`, variables: { owner, name } }),
  }));
  const repository = reply.data?.repository;
  if (reply.errors?.length || !repository) throw new Error(UNAVAILABLE);
  const entries = await Promise.all(numbers.map(async (number, index): Promise<[number, number[]]> => {
    const references = repository[`pull${index}`]?.closingIssuesReferences;
    if (!references) throw new Error(UNAVAILABLE);
    return [number, references.pageInfo.hasNextPage ? await readClosingIssueNumbers(service, repoUrl, number, token) : [...new Set(sameRepositoryNumbers(references, repo))]];
  }));
  return new Map(entries);
}
