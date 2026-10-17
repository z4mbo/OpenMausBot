import { describe, expect, it } from "vitest";
import { readClosingIssueNumbers, readClosingIssuesForPulls } from "./closing-issues.ts";

const page = (issues: { number: number; repo: string }[], hasNextPage = false, endCursor: string | null = null) => ({
  data: { repository: { pullRequest: { closingIssuesReferences: {
    nodes: issues.map(({ number, repo }) => ({ number, repository: { nameWithOwner: repo } })), pageInfo: { hasNextPage, endCursor },
  } } } },
});

function network(pages: unknown[]) {
  const variables: unknown[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    expect(String(input)).toBe("https://api.github.com/graphql");
    expect(init?.method).toBe("POST");
    variables.push(JSON.parse(String(init?.body)).variables);
    return Response.json(pages.shift() ?? {});
  }) as typeof fetch;
  return { service: { fetch: fetcher }, variables };
}

describe("GitHub closing references", () => {
  it("uses manual or keyword links returned by GitHub and filters other repositories", async () => {
    const { service } = network([page([{ number: 5, repo: "acme/widgets" }, { number: 6, repo: "ACME/Widgets" }, { number: 5, repo: "acme/other" }, { number: 7, repo: "acme/other" }])]);
    await expect(readClosingIssueNumbers(service, "https://github.com/acme/widgets", 8, "fixture-token")).resolves.toEqual([5, 6]);
  });

  it("paginates and deduplicates references", async () => {
    const { service, variables } = network([page([{ number: 5, repo: "acme/widgets" }], true, "next"), page([{ number: 5, repo: "acme/widgets" }, { number: 6, repo: "acme/widgets" }])]);
    await expect(readClosingIssueNumbers(service, "https://github.com/acme/widgets", 8, "fixture-token")).resolves.toEqual([5, 6]);
    expect(variables).toEqual([{ owner: "acme", name: "widgets", number: 8, cursor: null }, { owner: "acme", name: "widgets", number: 8, cursor: "next" }]);
  });

  it("rejects partial GraphQL errors instead of inferring links from the PR body", async () => {
    const { service } = network([{ ...page([{ number: 5, repo: "acme/widgets" }]), errors: [{ message: "Forbidden" }] }]);
    await expect(readClosingIssueNumbers(service, "https://github.com/acme/widgets", 8, "fixture-token")).rejects.toThrow("unavailable");
  });

  it("rejects missing and repeated pagination cursors", async () => {
    const missing = network([page([], true)]);
    await expect(readClosingIssueNumbers(missing.service, "https://github.com/acme/widgets", 8, "fixture-token")).rejects.toThrow("paginated");
    const repeated = network([page([], true, "next"), page([], true, "next")]);
    await expect(readClosingIssueNumbers(repeated.service, "https://github.com/acme/widgets", 8, "fixture-token")).rejects.toThrow("paginated");
    expect(repeated.variables).toHaveLength(2);
  });

  it("batches a list's references into one GitHub request", async () => {
    const first = page([{ number: 5, repo: "acme/widgets" }]).data.repository.pullRequest;
    const second = page([{ number: 5, repo: "acme/other" }, { number: 6, repo: "acme/widgets" }]).data.repository.pullRequest;
    const { service, variables } = network([{ data: { repository: { pull0: first, pull1: second } } }]);
    await expect(readClosingIssuesForPulls(service, "https://github.com/acme/widgets", [8, 9], "fixture-token")).resolves.toEqual(new Map([[8, [5]], [9, [6]]]));
    expect(variables).toEqual([{ owner: "acme", name: "widgets" }]);
  });
});
