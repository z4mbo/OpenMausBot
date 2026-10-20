import { ORIGIN_PROJECT, ORIGIN_SCOPE } from "./agents-origin-scope.ts";

export const SHIP_TOOL_DEFINITIONS = [
  {
    name: "origin_ship_status",
    description: "Read where an Origin project ships: its deploy targets (Vercel, Netlify, Cloudflare Pages, GitHub Actions) with recent deployments, their state, address, commit, which one is live in production now and what can be redeployed, promoted or rolled back, plus its releases." + ORIGIN_SCOPE,
    inputSchema: { type: "object", additionalProperties: false, properties: { project: ORIGIN_PROJECT } },
  },
  {
    name: "origin_ship_deploy",
    description: "Deploy an Origin project's target from its production branch (default), or redeploy, promote or roll back to a deployment_id from origin_ship_status. Chief only; the person approves each call." + ORIGIN_SCOPE,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        target: { type: "string", minLength: 1, maxLength: 120, description: "Id or name from origin_ship_status." },
        action: { type: "string", enum: ["deploy", "redeploy", "promote", "rollback"] },
        deployment_id: { type: "string", maxLength: 120 },
        project: ORIGIN_PROJECT,
      },
      required: ["target"],
    },
  },
  {
    name: "origin_release_draft",
    description: "Draft an Origin project's next release from the pull requests merged since its last tag, or update the open draft: the version is suggested from them and the notes are written for users unless you pass notes. A project admin edits and approves it in Ship, which tags it on GitHub, then deploys deploy_target to production and drafts a Broadcast announcement when announce is true." + ORIGIN_SCOPE,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        tag: { type: "string", maxLength: 64, description: "Like v1.4.0; omit for the suggested one." },
        title: { type: "string", maxLength: 120 },
        notes: { type: "string", maxLength: 20_000, description: "Markdown for the project's users; omit to have them written." },
        deploy_target: { type: "string", maxLength: 120, description: "Target id or name from origin_ship_status." },
        announce: { type: "boolean" },
        project: ORIGIN_PROJECT,
      },
    },
  },
];
