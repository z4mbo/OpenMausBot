/**
 * Service sign-ins: a Vault item of kind "service" holds the tokens a service's command line reads from its
 * environment, encrypted with the Vault passphrase as one JSON object of environment variable name to value. While
 * a person has the Vault unlocked and the item is marked usable by agents, their computer's agents get those
 * variables, so `vercel deploy` or `npx convex deploy` run signed in without the token ever being typed into chat.
 */

export interface VaultServiceField {
  env: string;
  label: string;
  /** Identifiers such as an account id are not secrets and may be short. */
  secret: boolean;
  optional?: boolean;
  multiline?: boolean;
}

export interface VaultService {
  id: string;
  label: string;
  /** Where the person creates the token. */
  tokenUrl: string;
  fields: readonly VaultServiceField[];
}

export const CUSTOM_SERVICE = "custom";

export const VAULT_SERVICES: readonly VaultService[] = [
  { id: "convex", label: "Convex", tokenUrl: "https://dashboard.convex.dev", fields: [{ env: "CONVEX_DEPLOY_KEY", label: "Deploy key", secret: true }] },
  { id: "vercel", label: "Vercel", tokenUrl: "https://vercel.com/account/tokens", fields: [
    { env: "VERCEL_TOKEN", label: "Access token", secret: true },
    { env: "VERCEL_ORG_ID", label: "Team ID", secret: false, optional: true },
  ] },
  { id: "apple", label: "Apple App Store Connect", tokenUrl: "https://appstoreconnect.apple.com/access/integrations/api", fields: [
    { env: "APP_STORE_CONNECT_API_KEY_KEY_ID", label: "Key ID", secret: false },
    { env: "APP_STORE_CONNECT_API_KEY_ISSUER_ID", label: "Issuer ID", secret: false },
    { env: "APP_STORE_CONNECT_API_KEY_KEY", label: "Private key (.p8 contents)", secret: true, multiline: true },
  ] },
  { id: "netlify", label: "Netlify", tokenUrl: "https://app.netlify.com/user/applications#personal-access-tokens", fields: [{ env: "NETLIFY_AUTH_TOKEN", label: "Personal access token", secret: true }] },
  { id: "cloudflare", label: "Cloudflare", tokenUrl: "https://dash.cloudflare.com/profile/api-tokens", fields: [
    { env: "CLOUDFLARE_API_TOKEN", label: "API token", secret: true },
    { env: "CLOUDFLARE_ACCOUNT_ID", label: "Account ID", secret: false, optional: true },
  ] },
  { id: "supabase", label: "Supabase", tokenUrl: "https://supabase.com/dashboard/account/tokens", fields: [{ env: "SUPABASE_ACCESS_TOKEN", label: "Access token", secret: true }] },
  { id: "expo", label: "Expo", tokenUrl: "https://expo.dev/settings/access-tokens", fields: [{ env: "EXPO_TOKEN", label: "Access token", secret: true }] },
  { id: "npm", label: "npm", tokenUrl: "https://www.npmjs.com/settings/~/tokens", fields: [{ env: "NPM_TOKEN", label: "Access token", secret: true }] },
  { id: "fly", label: "Fly.io", tokenUrl: "https://fly.io/user/personal_access_tokens", fields: [{ env: "FLY_API_TOKEN", label: "Access token", secret: true }] },
  { id: CUSTOM_SERVICE, label: "Other service", tokenUrl: "", fields: [] },
];

/** Security: names an agent's shell, its engine's billing or Origin's own operator secrets depend on are never set from the Vault. */
const RESERVED_ENV = /^(PATH|PATHEXT|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|TEMP|TMP|SHELL|COMSPEC|SYSTEMROOT|NODE_OPTIONS|LD_PRELOAD|LD_LIBRARY_PATH|DYLD_[A-Z_]+|OMB_[A-Z0-9_]*|ORIGIN_[A-Z0-9_]*|CONVEX_SELF_HOSTED_ADMIN_KEY|ANTHROPIC_[A-Z0-9_]*|OPENAI_[A-Z0-9_]*|GEMINI_API_KEY|GOOGLE_API_KEY|GITHUB_TOKEN|GH_TOKEN)$/u;
const ENV_NAME = /^[A-Z][A-Z0-9_]{1,63}$/u;
export const SERVICE_SECRET_MIN = 8;

export function vaultService(id: string | undefined): VaultService | undefined {
  return VAULT_SERVICES.find((service) => service.id === id);
}

export function usableEnvName(name: string): boolean {
  return ENV_NAME.test(name) && !RESERVED_ENV.test(name);
}

export type ServiceEnv = Record<string, string>;

/** Why these values cannot be saved for this service, or null. */
export function serviceEnvProblem(serviceId: string, env: ServiceEnv): string | null {
  const service = vaultService(serviceId);
  if (!service) return "Choose a service";
  const names = Object.keys(env);
  if (!names.length) return "Enter the token";
  for (const name of names) if (!usableEnvName(name)) return `${name} can't be set from the Vault`;
  if (service.id === CUSTOM_SERVICE) {
    return names.some((name) => env[name]!.length < SERVICE_SECRET_MIN) ? `Use values of ${SERVICE_SECRET_MIN} characters or more, which Origin can keep out of logs` : null;
  }
  for (const field of service.fields) {
    const value = env[field.env] ?? "";
    if (!value && !field.optional) return `Enter the ${field.label}`;
    if (value && field.secret && value.length < SERVICE_SECRET_MIN) return `The ${field.label} looks too short`;
  }
  return names.some((name) => !service.fields.some((field) => field.env === name)) ? `${service.label} doesn't use other variables` : null;
}

/** The values to keep out of logs: every secret field, and every value of a custom service. */
export function serviceSecretValues(serviceId: string, env: ServiceEnv): string[] {
  const service = vaultService(serviceId);
  if (!service) return [];
  if (service.id === CUSTOM_SERVICE) return Object.values(env);
  return service.fields.filter((field) => field.secret && env[field.env]).map((field) => env[field.env]!);
}

export function parseServiceEnv(serviceId: string, text: string): ServiceEnv | null {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return null; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const env: ServiceEnv = {};
  for (const [name, value] of Object.entries(parsed)) {
    if (typeof value !== "string") return null;
    if (value) env[name] = value;
  }
  return serviceEnvProblem(serviceId, env) ? null : env;
}
