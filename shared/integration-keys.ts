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

/** What GET /api/integrations returns for each service; `configured` means every required field is set. */
export interface IntegrationStatus {
  id: string;
  label: string;
  help: string;
  configured: boolean;
  fields: IntegrationFieldStatus[];
}
