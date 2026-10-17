# Publishing the Origin Plugin

Origin packages one workflow skill and the remote MCP endpoint of an Origin instance (placeholder `https://your-origin.example/api/mcp`; set your own host before publishing). The portable source is in `plugins/origin`; no credentials, account data or example customer issues belong in that directory.

## Package and Test

```sh
node scripts/test-plugin-package.mjs
tar -czf /tmp/origin-plugin.tar.gz -C plugins origin
```

Run the local OAuth/MCP suites described in [Testing](testing.md). Use synthetic accounts and a separate local backend. Then install the final package in the intended client, complete OAuth and verify actual prompts. Server tests alone do not validate model tool selection, client consent screens or UI behavior.

The plugin operates only within the workspace authorized by each user. Read/write grants and read-only grants must both be tested. The skill is guidance, not a replacement for server-side access checks. Creating a project can provision a private repository in the workspace's linked GitHub account. Completing or reopening an Origin issue does not implement code changes.

## Public Directory

Follow the [official submission guide](https://developers.openai.com/plugins/deploy/submission). A private hosted plugin is separate from a public directory listing.

1. Open the OpenAI Platform plugin submission portal in the intended publisher organization and project. Confirm the developer identity and submission permissions.
2. Create a **With MCP** draft. Use the production endpoint directly, not an existing private integration ID.
3. Supply accurate listing copy, a logo, a real support destination, and published privacy and terms pages. Do not submit placeholder routes that fall through to the workspace app.
4. Provide a dedicated, disposable review account with synthetic projects and no access to customer workspaces. Store review credentials only in the submission portal, never in this repository or archive.
5. Complete the portal's domain challenge without overwriting another integration's token. Scan tools and inspect their current annotations and schemas.
6. Add five positive and three negative test cases, verified in each supported client. Cover discovery, assigned work, issue creation/update and completion; reject chat contents, vault secrets and code execution.
7. Have the publisher review identity, availability, data disclosures and policy attestations before submission.
8. Submit for review. After approval, explicitly publish from the portal. Confirm the public listing before announcing it as available in the store.

## Pre-Submission Findings

The current MCP server has explicit read/write/destructive annotations, but its bounded write tools still declare `openWorldHint: true`. `get_inbox` also describes legacy paused/archived project states rather than the current inactive state. Correct and retest these descriptors before submitting; changes are pending publisher approval.

All 11 tools currently return JSON as text and omit `outputSchema`. Add accurate output schemas and matching structured results to improve model reliability, then validate every response against those schemas. This is separate from the functional tests, which parse and check the current JSON results.

The source package intentionally omits privacy/terms links until real policies exist. Disclose project and issue text, assignment names/emails, due dates, GitHub links and notification metadata that a connected AI client can receive. Chat contents, file contents, vault secrets and GitHub credentials are outside the connector's scope. Publisher identity, legal/support content, review-account access and directory approval must be verified independently; they cannot be inferred from a successful build.
