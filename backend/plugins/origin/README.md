# Origin Plugin

Your projects, issues and inbox in ChatGPT and Codex, with workspace-scoped OAuth. The same remote MCP server works with compatible Claude connectors.

## Connect

Origin is self-hosted, so the endpoint is your own instance: `https://YOUR-ORIGIN-HOST/api/mcp`. The package ships with the placeholder `https://your-origin.example/api/mcp`; replace it with your host in `mcp.json` and `.mcp.json` before installing.

For Codex CLI:

```sh
codex mcp add origin --url https://YOUR-ORIGIN-HOST/api/mcp
codex mcp login origin
```

Sign in to Origin, select your workspace and approve read-only or read/write access. Start a new Codex conversation after adding the connector. Adding the URL does not grant access by itself.

This folder is a portable Agent Plugins 1.0 package: `plugin.json`, `mcp.json`, and the `origin` workflow skill. The hidden Codex manifest and `.mcp.json` remain for existing older-client installations; their identity and presentation match the portable manifest. No credentials or workspace data belong in the package.

Installing a private plugin does not publish it in the public directory. Public distribution requires submission, review and publication through the [OpenAI plugin submission portal](https://platform.openai.com/plugins). Do not claim a store listing until publication is confirmed.

For ChatGPT or Claude, install the hosted plugin when available or add a custom remote MCP connector with the same endpoint and complete OAuth. Availability depends on your client's plan and organization settings.

## Tools

| Tool | Purpose |
| --- | --- |
| `list_projects`, `get_project` | Projects, state and workflow columns |
| `list_members` | Workspace members or eligible assignees for a project |
| `get_inbox` | Assigned work or notification events |
| `list_issues`, `get_issue` | Active and completed issues |
| `create_project`, `update_project` | Project creation and metadata |
| `create_issue`, `update_issue` | Create, edit, complete and reopen work |
| `delete_issue` | Explicit permanent deletion after confirmation |

Write tools require write consent. Project membership applies to every operation. Grants expire after 90 days and can be revoked in Settings > Integrations. The connector does not expose chat contents, file contents, vault secrets, GitHub tokens or code execution. Deleting an Origin issue does not close or delete its GitHub issue.

Member names and email addresses are returned to resolve eligible assignees. Creating a project can also provision a private repository on the workspace's connected GitHub account. Reopening an Origin issue does not revert code or reopen the linked GitHub issue; a still-closed GitHub issue can complete it again on synchronization.

## A Prompt to Try

> Connect to my Origin workspace. Show my assigned active issues and unread notification events. Group the work by project and priority. Before changing anything, show me the proposed edits. For new issues, use eligible project members and ask me for missing due dates. Never mark an issue complete without verifying the result, and ask before deleting anything.
