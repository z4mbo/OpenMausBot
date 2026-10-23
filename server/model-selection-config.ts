import { z } from "zod";
import { EFFORT_LEVELS } from "../shared/wire.ts";
import { isModelVariant } from "./contracts.ts";
import { REMOTE_MODEL_INSTANCE } from "../shared/model-selection.ts";

export const defaultModelSelectionSchema = z.object({
  instanceId: z.string().trim().min(1).max(200),
  model: z.string().trim().min(1).max(500),
  effort: z.enum(EFFORT_LEVELS).optional(),
  variant: z.string().refine(isModelVariant, "invalid model variant").optional(),
  source: z.object({ hostId: z.string().regex(/^[a-z0-9]{1,64}$/), sourceId: z.string().regex(/^[a-z0-9]{1,64}$/) }).strict().optional(),
}).strict().refine((selection) => selection.variant === undefined || selection.effort === undefined,
  "choose either a model variant or an effort level")
  .refine(selection => (selection.instanceId === REMOTE_MODEL_INSTANCE) === Boolean(selection.source),
    "A shared account requires origin-remote and an exact host/source identity");

export const globalModelSelectionSchema = defaultModelSelectionSchema.refine(selection => !selection.source,
  "Choose shared accounts for an existing workspace or project agent, not a global default");

export const automaticRecoverySchema = z.object({
  enabled: z.boolean(),
  backup: globalModelSelectionSchema.optional(),
}).strict().refine((recovery) => !recovery.enabled || recovery.backup !== undefined,
  { message: "Choose a backup model before enabling automatic recovery", path: ["backup"] });

export const dailyApiBudgetSchema = z.object({
  limitUsd: z.number().finite().min(0).max(1_000_000),
  timeZone: z.string().trim().min(1).max(100).refine((timeZone) => {
    try { new Intl.DateTimeFormat("en", { timeZone }).format(); return true; } catch { return false; }
  }, "Choose a supported time zone"),
}).strict();
