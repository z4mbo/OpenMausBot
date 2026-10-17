/** Operator secrets only this process reads, plus every `OMB_CLOUD_` var (the underscore leaves out OMB_CLOUDFLARED_PATH). */
export const CONTROL_PLANE_ENV = [
  "OMB_LICENSE_KEY", "OMB_INSTALLATION_CREDENTIAL",
  "ORIGIN_INTEGRATION_SECRET", "ORIGIN_GITHUB_TOKEN", "ORIGIN_RESEND_API_KEY", "ORIGIN_TURN_SECRET",
  "GITHUB_APP_PRIVATE_KEY", "GITHUB_CLIENT_SECRET", "GITHUB_WEBHOOK_SECRET",
] as const;
export const CONTROL_PLANE_ENV_PREFIX = "OMB_CLOUD_";
const ORIGIN_BACKEND_ADMIN_ENV = ["CONVEX_DEPLOY_KEY", "CONVEX_SELF_HOSTED_ADMIN_KEY"] as const;

/** Names compare case-insensitively because Windows environments do. */
export function stripControlPlaneEnv(env: Record<string, string | undefined>): void {
  const originOperator = Object.entries(env).some(([name, value]) => name.toUpperCase() === "ORIGIN_INTEGRATION_SECRET" && Boolean(value?.trim()));
  for (const key of Object.keys(env)) {
    const name = key.toUpperCase();
    if (name.startsWith(CONTROL_PLANE_ENV_PREFIX) || (CONTROL_PLANE_ENV as readonly string[]).includes(name)
      || (originOperator && (ORIGIN_BACKEND_ADMIN_ENV as readonly string[]).includes(name))) delete env[key];
  }
}
