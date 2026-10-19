# Provider-error handoff CI isolation

The remaining failure in [CI 39166463163, Windows shard 3](https://github.com/z4mbo/Origin/actions/runs/39166463163/job/117790908479)
was the comms case that expects a teammate's provider rate-limit message. The
requester instead received `MCP request timed out; execution outcome may be
uncertain`. The other 4,664 tests in that shard passed. This is separate from the
earlier fixture HTTP connection-reset failure.

That helper permitted every tool, so the Chat Completions runtime initialized its
required agents MCP process before contacting the fake provider. A required MCP
startup failure ends the turn before a provider request. The provider-error case
does not need tools; separate comms cases exercise the delegated tool surface.

The [report](evidence/origin-ci-provider-error-034/report.json) and
[manifest](evidence/origin-ci-provider-error-034/manifest.json) retain a controlled
reproduction through the real OpenAI-compatible runtime and a loopback HTTP
provider. A synthetic agents process intentionally stays silent. With the
unrestricted helper, the existing eight-second startup deadline produces the
exact CI error and the provider receives zero completion requests. With an empty
tool scope, no MCP process starts, the provider receives one request, and the
runtime reports its HTTP 429 message. Both controlled assertions passed.

Fix `38af1b862342e2c1d6867635031f884b33779881` gives only that test's LimitHelper
an explicit empty tool scope. The case also verifies that the fake provider's
rate-limited request counter increases. Its original failure-chip wording,
requester resumption and assignment-result assertions remain intact. No runtime
timeout, retry policy, required-MCP behavior or product setting changed.

The unchanged focused case passed locally before this change; the GitHub runner's
specific reason for delayed startup remains unproven. The controlled scenario
reproduces the failure class and proves the fixture dependency. It does not
reconstruct that runner's operating-system state or establish that a new final
CI run passed. The final comms file passed all 32 cases, and touched-file lint
and diff checks passed. Tests used disposable homes, a fake ACP fleet and the
loopback provider; no production data was accessed.

To rerun the comms file, use Node 24 to execute Vitest against
`server/comms.test.ts`. The [controlled diagnostic source](evidence/origin-ci-provider-error-034/controlled-runtime-source.txt)
is retained as text rather than adding another slow startup case to every CI
shard. To repeat it, copy the text into the server's testing directory as a
temporary TypeScript test file and run that file with the same Vitest setup,
which supplies an isolated home. Remove only that temporary source afterward.
The collection binds the frozen CI source,
local baseline, fix and relevant runtime module hashes.
