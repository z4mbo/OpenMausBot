# Contributing

Small, focused pull requests are welcome. Open an issue before changing authentication, storage, deployment architecture, or the public integration contract.

1. Follow the local setup in the README using your own Convex development deployment.
2. Create a branch, make a focused change, and add tests for its behavior and permissions.
3. Run TypeScript, the build, and relevant regression tests. Verify user-facing changes on desktop and mobile.
4. Explain what changed, how you tested it, and any migration or environment requirements in your pull request.

Use synthetic users and projects. Never commit `.env` files, deploy keys, tokens, real workspace exports, local SQLite files, private screenshots, or generated build directories. Review your staged diff before committing.

Convex schema changes must remain compatible with existing records. Include authentication, workspace isolation, and viewer-role checks for every new operation. Read `AGENTS.md` and the generated Convex guidelines before editing backend code.

Keep Origin's compact, dark interface consistent. Use its existing controls, avatar components, skeletons, and icons. Avoid unnecessary page headings, card-heavy dashboards, and changes that hide completed work or restrict editable workflow columns.
