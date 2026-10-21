# Host/backend reconciliation 050

Main source: fa83fb6b9e7e6e7e8195e93405a975007917872a (0.7.1). Audit parent: bdea56e9ed6bc0882fa8173465bcb735d4fe3f66. Common ancestor: f76cbe9b8019b648bb08f9125daefe35e6625185. Both checkouts were clean at the initial read. Root then began the no-commit merge and authorized the files listed below. Main checkout and live processes were never edited or used for verification.

## Resolutions

- projects.ts keeps both repoVisibility and compareProjectOrder/reorderWorkspaceProjects imports: newer GitHub visibility support and stale-order protection both survive.
- Broadcast channel publishing keeps credential-error scrubbing and newer Instagram/TikTok publish options. Scheduler tests keep account selection and redaction cases; its new account-selector expected password was aligned with the retained explicit synthetic credential.
- index.ts keeps the extracted project-tools host, static responder, hosted model executor, shared-agent/requester hooks and new agent public routes/GitHub connection. Sales/Pipeline runtime dependencies were removed only in owned files, matching the explicit main removal.
- Studio keeps the newer extracted routes/tools, workflows, project-scoped keys, media chunk uploads, cancellation, voice caching, brand/library features and queue fixture origin. Mandatory pre-spend guards survive before workflow admission, every generation/submission and quick paid calls. Tool/workflow agent identity comes from the trusted caller; HTTP-supplied bot/agent fields do not select the charged agent. Host composition maps manual project work to its unique linked Chief, refusing ambiguous links.
- Fal error redaction uses the project key and Origin session; same-origin storage path/redirect guards remain. Budget errors return explicit HTTP409 or tool isError responses. No provider keys or production data were read.

## Security preservation

The audit budget ACL auto-merged unchanged: budgets.forAgent requires requireMember for project agents and checks project.teamId before budgetChecks. This closes the known workspace-member/private-agent-ID read scenario. The modelHosts module, request/executor leases, sender-write fences, monthly cap checks and spend accounting are retained from the audit side. Main did not contain these modules; replacing the audit backend wholesale would have lost them. This is source inspection plus local regression coverage, not a production-function claim.

Main adds Ship, Brand, Draw collaboration, Pulse and GitHub/shared-key integration schema/modules alongside Studio/library/workflow and project docs/milestones features. Their table definitions remain present. Main deliberately removed Sales/Pipeline runtime routes/functions and kept legacy tables for existing rows; those deletions must not be reverted just to resolve modify/delete conflicts. Root owns deleted Pipeline paths and remaining UI/version/ratchet resolution.

## Verification

- Focused server unit run: five files,101 tests PASS. Studio includes new daily-cap, agent-attribution, delayed cap-change and account/project-admission refusal cases. HTTP workflow/campaign/enhance/voice routes refuse before cloud/provider work under a cap; forged agent arguments do not bypass it. Account/project refusal controls use a synthetic RPC boundary; they do not claim live backend authorization acceptance.
- First server run:100 passed/one scheduler fixture expectation failed; aligned its synthetic password expectation, then reran all101 successfully.
- Backend subset: budgets.access, projectOrdering and projectWorkflow; three files/24 tests PASS.
- No isolated app/browser/native fixture was launched by this lane. No claim of complete server or conversation acceptance is made. Root owns coordinated global typechecks and later acceptance. Root found only an unused OriginCloudClient import in this lane; it was removed after the tests (no behavior change).
- One attempted ESLint invocation did not run because the repository uses oxlint rather than ESLint; no lint success is claimed. Root requested no further global lint/typecheck from this lane. Owned-file diff whitespace check reported no errors (only Git CRLF notices).

## Compiled schema compatibility

Actual frozen main schema and current merged schema were bundled/evaluated locally in memory. No backend process, target or rows were accessed. The existing validator/index comparison checks old values remain accepted and existing indexes remain present. This is a working-source compatibility proof, not proof of the deployed backend identity or a frozen release.

```json
{
  "mainSource": "fa83fb6b9e7e6e7e8195e93405a975007917872a",
  "auditParent": "bdea56e9ed6bc0882fa8173465bcb735d4fe3f66",
  "mergedSource": "working merge, not immutable candidate",
  "currentMainTables": 94,
  "mergedTables": 96,
  "currentMainCompiledSchemaSha256": "67ba494c0488b0159d320ae68b9484ac8f7a584462827ea879e9002200c0a705",
  "mergedCompiledSchemaSha256": "88f2a5316f23e674c9daa4442e914aeacba5719107d977503ee7f063ea44a9f8",
  "removedTables": [],
  "narrowedValidators": [],
  "removedIndexes": [],
  "addedTables": [
    "modelHostSources",
    "modelHostExecutions"
  ],
  "addedFields": [
    {
      "field": "agentHosts.deviceId",
      "optional": true
    },
    {
      "field": "agentHosts.credentialHash",
      "optional": true
    },
    {
      "field": "workspaceAgentRuns.executedByUserId",
      "optional": true
    },
    {
      "field": "workspaceAgentRuns.modelExecutionId",
      "optional": true
    }
  ],
  "addedIndexes": [
    "agentHosts.by_ownerUserId_and_teamId_and_deviceId"
  ],
  "productionRowsRead": false,
  "deploymentPerformed": false
}
```

## Owned source bindings

```json
[
  {
    "path": "backend/convex/projects.ts",
    "sha256": "ceb41ec2f5f91e9a21d034fc291dd55b480effd253a68a3c58514a60cbb8ad04"
  },
  {
    "path": "server/broadcast/channels.ts",
    "sha256": "7b2bb0af7881530953e5415a3c60b2a557794169858275f5d99356dcdfd6f74b"
  },
  {
    "path": "server/broadcast/scheduler.test.ts",
    "sha256": "eb646f9b5e64ae64430309b89de8d6b6ca46e0ad91822bf4f1957786675fc834"
  },
  {
    "path": "server/index.ts",
    "sha256": "a8d3303275631d67ad485a4b8d62c65531422e552757566a5126b667b9dc9267"
  },
  {
    "path": "server/origin-cloud.ts",
    "sha256": "86749f3a6fad66eed686a34aa2dd24dde9bfa90c18cbf8c3bfeb77e64d6e5577"
  },
  {
    "path": "server/origin-studio.ts",
    "sha256": "43e8ef7fbcd2a3def336e206add86ec5715c8b2a52dcf591dc873a0a212bd6cb"
  },
  {
    "path": "server/origin-studio.test.ts",
    "sha256": "50c383e65fd9bd5cd3659c37b293198c0cf736f0bca50f004ac2a6a36aceae94"
  },
  {
    "path": "server/routes/studio.ts",
    "sha256": "50b68d6ed47f6064f3e8c4af356cfb4bf837df8b0e9af8f043136a7916c07d35"
  },
  {
    "path": "server/origin-studio-tools.ts",
    "sha256": "a165d883385167963aa9cff540becdd0783178f10b47f74432f21f468570e753"
  },
  {
    "path": "server/origin-studio-workflow.ts",
    "sha256": "e122da763c3db403c5808f09ecfc35d5bd9a404455cc4aecb08283d222a79210"
  },
  {
    "path": "server/host/project-tools.ts",
    "sha256": "d43df7f9730f07a20e3712ea6bcda1ea0a456d9439e6533ef60ad43d5945f9d9"
  },
  {
    "path": "server/host/project-tools.test.ts",
    "sha256": "3eb9e8b7b4cc7af077af0ab4e3f7ea6716cfb1ef8e1451be600b8a455061a272"
  },
  {
    "path": "server/origin-brand-tools.test.ts",
    "sha256": "2e80608da4196d6d0c686d78244d313f3682e043dfd5a4cb9001a09469990eeb"
  }
]
```

No files were staged or committed by this lane. Old049 operators were not executed or retargeted. Existing staged/unmerged Git state belongs to root's merge.
