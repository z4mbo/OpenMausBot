import { ORIGIN_PROJECT, ORIGIN_SCOPE } from "./agents-origin-scope.ts";
import { BRAND_VOICE } from "./agents-brand-tools.ts";

export const PIPELINE_TOOL_DEFINITIONS = [
  {
    name: "origin_pipeline_list_leads",
    description: "List an Origin project's Sales contacts: totals per stage and its leads (id, stage, contact details, value, owner, next step, sources), filtered by stage or a search; or read one lead with its notes, deals and timeline (emails, texts, calls with summaries) with lead_id." + ORIGIN_SCOPE,
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
    description: "Start, pause, resume or stop a lead's follow-up sequence in an Origin project's Pipeline. Each step is due `day` days after the start: email (subject, body), sms or whatsapp (body), ai_call (goal) or call_task (a reminder for a person to call; body optional). {first_name}, {name} and {company} fill in. Due contact steps are drafted for a person to approve; the sequence stops when the lead replies or moves to Won or Lost, and a new one replaces the old." + BRAND_VOICE + ORIGIN_SCOPE,
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
    description: "Reach or answer a lead from an Origin project's Sales with the person's own keys: an email (subject and body), a text or WhatsApp message (body), or an AI phone call by the project's ElevenLabs agent (goal: what the call should achieve and how to open it). Leave channel out to reply on the one they last wrote on. Unless the project's admin turned on auto-send, nothing goes out until a person approves your draft in the Sales inbox; say so instead of retrying. AI calls are summarised into the lead's timeline when they end." + BRAND_VOICE + ORIGIN_SCOPE,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        lead_id: { type: "string", minLength: 1, maxLength: 64 },
        channel: { type: "string", enum: ["email", "sms", "whatsapp", "ai_call"], description: "Default: the channel they last wrote on." },
        subject: { type: "string", maxLength: 300, description: "Email only." },
        body: { type: "string", maxLength: 20_000, description: "The email or message text." },
        goal: { type: "string", maxLength: 8_000, description: "AI call only: its goal and script." },
        project: ORIGIN_PROJECT,
      },
      required: ["lead_id"],
    },
  },
  {
    name: "origin_pipeline_conversations",
    description: "Read an Origin project's Sales inbox: every contact's conversation, newest first, with unread replies, agent drafts waiting for approval and won deals waiting for confirmation; or one contact's emails, texts, WhatsApp messages and call summaries in order with lead_id." + ORIGIN_SCOPE,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        lead_id: { type: "string", maxLength: 64, description: "Read this contact's conversation." },
        unread_only: { type: "boolean", description: "Only conversations that need someone." },
        project: ORIGIN_PROJECT,
      },
    },
  },
  {
    name: "origin_pipeline_deal",
    description: "List, open or change the deals in an Origin project's Sales: value and currency, stage, expected close date, simple line items and notes. action won only asks a person to confirm the sale (with the amount and reason); nothing is won until they do. action lost closes it with a reason." + ORIGIN_SCOPE,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        action: { type: "string", enum: ["list", "save", "won", "lost"], description: "Default save." },
        lead_id: { type: "string", maxLength: 64, description: "The contact: opens a deal, or lists theirs." },
        deal_id: { type: "string", maxLength: 64, description: "The deal to change, win or lose." },
        title: { type: "string", maxLength: 200 },
        value: { type: "number", minimum: 0, description: "Ignored when line_items are given: their total is the value." },
        currency: { type: "string", maxLength: 3, description: "Default the project's." },
        stage: { type: "string", maxLength: 40, description: "An open stage; use won or lost to close." },
        close_date: { type: "string", maxLength: 10, description: "Expected close, YYYY-MM-DD." },
        line_items: {
          type: "array", maxItems: 20,
          items: {
            type: "object", additionalProperties: false,
            properties: { name: { type: "string", maxLength: 120 }, quantity: { type: "number", minimum: 0 }, unit_price: { type: "number", minimum: 0 } },
            required: ["name", "unit_price"],
          },
        },
        notes: { type: "string", maxLength: 8_000 },
        amount: { type: "number", minimum: 0, description: "won only: what the customer agreed to pay." },
        reason: { type: "string", maxLength: 300, description: "won or lost: why." },
        project: ORIGIN_PROJECT,
      },
    },
  },
];
