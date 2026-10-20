import { ORIGIN_PROJECT, ORIGIN_SCOPE } from "./agents-origin-scope.ts";

export const PIPELINE_TOOL_DEFINITIONS = [
  {
    name: "origin_pipeline_list_leads",
    description: "List an Origin project's sales pipeline: totals per stage and its leads (id, stage, contact details, value, owner, next step), filtered by stage or a search; or read one lead with its notes and timeline (emails, texts, calls with summaries) with lead_id." + ORIGIN_SCOPE,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        stage: { type: "string", maxLength: 40, description: "New, Contacted, Qualified, Proposal, Won or Lost." },
        query: { type: "string", maxLength: 200, description: "Matches name, company, email, phone, notes and tags." },
        lead_id: { type: "string", maxLength: 64, description: "Read this lead in full." },
        project: ORIGIN_PROJECT,
      },
    },
  },
  {
    name: "origin_pipeline_upsert_lead",
    description: "Add a lead you researched to an Origin project's pipeline, or change one with lead_id. A lead with the same email is updated instead of duplicated. Only add real people or companies you found; never invent contact details." + ORIGIN_SCOPE,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        lead_id: { type: "string", maxLength: 64, description: "Omit to add a lead." },
        name: { type: "string", maxLength: 200, description: "Required for a new lead." },
        company: { type: "string", maxLength: 200 },
        email: { type: "string", maxLength: 254 },
        phone: { type: "string", maxLength: 40, description: "With its country code, like +39 333 123 4567." },
        source: { type: "string", maxLength: 60, description: "Where you found them; default agent research." },
        stage: { type: "string", maxLength: 40 },
        value: { type: "number", minimum: 0, description: "Expected deal value in the project's currency." },
        tags: { type: "array", maxItems: 12, items: { type: "string", maxLength: 40 } },
        notes: { type: "string", maxLength: 8_000, description: "What you know about them and why they fit; cite your sources." },
        next_step: { type: "string", maxLength: 300 },
        next_due: { type: "string", maxLength: 10, description: "YYYY-MM-DD." },
        project: ORIGIN_PROJECT,
      },
    },
  },
  {
    name: "origin_pipeline_log_activity",
    description: "Record something that already happened with a lead on its Pipeline timeline: a note, or an email, text or call that took place outside Origin. Sends nothing." + ORIGIN_SCOPE,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        lead_id: { type: "string", minLength: 1, maxLength: 64 },
        kind: { type: "string", enum: ["note", "email", "sms", "whatsapp", "call", "ai_call"], description: "Default note." },
        subject: { type: "string", maxLength: 300 },
        body: { type: "string", maxLength: 20_000 },
        summary: { type: "string", maxLength: 8_000 },
        project: ORIGIN_PROJECT,
      },
      required: ["lead_id"],
    },
  },
  {
    name: "origin_pipeline_sequence",
    description: "Start, pause, resume or stop a lead's follow-up sequence in an Origin project's Pipeline. Each step is due `day` days after the start: email (subject, body), sms or whatsapp (body), ai_call (goal) or call_task (a reminder for a person to call; body optional). {first_name}, {name} and {company} fill in. Due contact steps are drafted for a person to approve; the sequence stops when the lead replies or moves to Won or Lost, and a new one replaces the old." + ORIGIN_SCOPE,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        lead_id: { type: "string", minLength: 1, maxLength: 64 },
        action: { type: "string", enum: ["start", "pause", "resume", "stop"], description: "Default start." },
        steps: {
          type: "array", maxItems: 8, description: "start only, in day order.",
          items: {
            type: "object", additionalProperties: false,
            properties: {
              day: { type: "integer", minimum: 0, maximum: 90 },
              channel: { type: "string", enum: ["email", "sms", "whatsapp", "ai_call", "call_task"] },
              subject: { type: "string", maxLength: 300 },
              body: { type: "string", maxLength: 20_000 },
              goal: { type: "string", maxLength: 8_000 },
            },
            required: ["day", "channel"],
          },
        },
        project: ORIGIN_PROJECT,
      },
      required: ["lead_id"],
    },
  },
  {
    name: "origin_pipeline_contact",
    description: "Reach a lead from an Origin project's Pipeline with the person's own keys: an email (subject and body), a text or WhatsApp message (body), or an AI phone call by the project's ElevenLabs agent (goal: what the call should achieve and how to open it). Unless the project's admin turned on auto-send, nothing goes out until a person approves your draft in the app; say so instead of retrying. AI calls are summarised into the lead's timeline when they end." + ORIGIN_SCOPE,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        lead_id: { type: "string", minLength: 1, maxLength: 64 },
        channel: { type: "string", enum: ["email", "sms", "whatsapp", "ai_call"] },
        subject: { type: "string", maxLength: 300, description: "Email only." },
        body: { type: "string", maxLength: 20_000, description: "The email or message text." },
        goal: { type: "string", maxLength: 8_000, description: "AI call only: its goal and script." },
        project: ORIGIN_PROJECT,
      },
      required: ["lead_id", "channel"],
    },
  },
];
