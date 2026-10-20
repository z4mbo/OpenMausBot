/** One field of a connected service as a client sees it: whether it is set, and the value only when it is not secret. */
export interface IntegrationFieldStatus {
  name: string;
  label: string;
  secret: boolean;
  optional: boolean;
  placeholder?: string;
  set: boolean;
  value?: string;
}

/** A key an admin shared with the workspace or one project, which this person's server uses when they have none of their own. */
export interface SharedIntegration {
  by: string;
  /** The project it was shared with, or null for the whole workspace. */
  projectName: string | null;
}

/** What GET /api/integrations returns for each service; `configured` means every required field is set, by this person or a shared key. */
export interface IntegrationStatus {
  id: string;
  label: string;
  help: string;
  configured: boolean;
  /** Whose keys are used: this person's own on this computer, a shared key, or none yet. */
  source: "yours" | "shared" | null;
  shared: SharedIntegration | null;
  fields: IntegrationFieldStatus[];
}
