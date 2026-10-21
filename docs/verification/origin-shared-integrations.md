# Workspace integrations every member can use

GitHub and the integration keys an owner sets up once now live in the Origin
backend, sealed with the deployment's `ORIGIN_SEALING_KEY`, so an invited
member's computer works through them without the owner's GitHub account, the
integration secret or a copy of any key.

Run the whole flow, end to end, with one command:

```sh
node --experimental-strip-types scripts/verify-origin-shared-integrations.ts
```

It starts the real Convex functions of `backend/convex` in memory
(`scripts/testing/origin-campaigns-backend.ts`), a loopback GitHub
(`scripts/testing/fake-github.ts`, one App, user and installation tokens with
GitHub's per-repository scoping) and two isolated Origin servers through the
`control-omb` launcher, each with its own data folder: the owner, whose folder
holds a GitHub connection and a fal.ai key as if they had connected them on
their desktop, and a member who joined through a workspace invitation and whose
folder holds nothing. The launcher passes only a loopback `OMB_GITHUB_API_URL`
into the servers, so no request reaches GitHub. It prints one JSON report and
exits non-zero on the first failed check:

- before anything is shared, the member's `GET /api/github/workspace` says
  GitHub is not set up, with no integration-secret error;
- the owner opening the same status shares their connection; the member then
  sees the workspace's account and who shared it;
- the member, a plain member and no admin, creates the project's repository
  with `POST /api/github/repo`, public as chosen when creating the project, and
  Origin protects its default branch: one approving review, no force-push or
  deletion;
- the member's issue becomes a GitHub issue, which the backend links only after
  reading it back from GitHub, and the member reads the repository;
- `git credential fill` through the member's credential helper gets a token
  scoped to contents of that one repository, and nothing for a repository no
  linked project uses, and that token cannot write the default branch;
- the owner shares their fal.ai key; the member's server uses it, says who
  shared it, and never hands its value to the client;
- the member hands their agents only the vault item marked for them;
- the member links their own GitHub through device sign-in and is invited to
  push to the workspace's repositories;
- the member's draft pull request opens under their own GitHub account, its plan
  commit names them as co-author, the Chief's App approval counts on it and the
  person-confirmed merge goes through the protected branch;
- the owner, who linked no GitHub, gets a pull request the App opens with a
  `Co-authored-by` trailer; the App cannot approve its own pull request, so the
  merge is refused with a reason until someone else approves it;
- a repository linked before Origin protected branches is offered protection,
  which a project admin applies;
- making the member a viewer takes back the push access Origin gave their
  GitHub;
- reconnecting GitHub keeps the organization the workspace works in.

The rules behind each step have their own tests: `backend/convex/teamGitHub.test.ts`
(sharing, role-scoped tokens, approval of linked repositories, read-back of
issues and merges, organization repositories, device sign-in),
`backend/convex/githubMemberAccess.test.ts` (branch protection, pull requests
under the member's own account, push access following roles, the organization
kept on reconnect),
`backend/convex/sharedKeys.test.ts`, `server/github/project-git.test.ts` (a real
`git credential fill` through the helper, and the person's git identity in the
project folder), `server/shared-integration-keys.test.ts`
and `server/origin-vault-agent.test.ts`.

The Settings, project Settings, Repo and Vault screens are not driven by this
check; open Settings > Integrations as an owner and as a member against a
fixture to see them. The Repo tab offers a project admin to protect the default
branch of a repository that is not protected yet, and says why when GitHub
refuses (private repositories need a paid plan).
