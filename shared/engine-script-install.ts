/** A vendor's official installer the app can run for the desktop owner once they confirm it. */
export interface EngineInstallScript {
  /** The exact command that runs: shown to the owner verbatim before they confirm. */
  command: string;
  /** The vendor domain the installer is downloaded from. */
  source: string;
  /** The vendor's own install instructions, where this command is published. */
  docsUrl: string;
}

/** Progress of one installer run, polled at `GET /api/engine-installs/:instanceId`. */
export interface EngineScriptInstallJob {
  instanceId: string;
  state: "running" | "succeeded" | "failed" | "cancelled";
  /** The last few KB of the installer's output, without terminal colour codes. */
  output: string;
  error?: string;
  startedAt: string;
  finishedAt?: string;
}
