export interface SettingsType {
  VITE_SERVER_URL?: string;
  NIX_INSTALLED_OVERRIDE?: boolean;
}

const env = import.meta.env as Record<string, string | boolean | undefined>;

function parseBoolean(value: string | boolean | undefined): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

export const settings: SettingsType = {
  VITE_SERVER_URL: typeof env.VITE_SERVER_URL === "string" ? env.VITE_SERVER_URL : undefined,
  NIX_INSTALLED_OVERRIDE: parseBoolean(env.NIX_INSTALLED_OVERRIDE),
};

// Helper to resolve the public website URL used by the native/web apps.
// Prefers the Vite env var `VITE_SERVER_URL` when available, otherwise
// falls back to a localhost URL for local development.
export function getWebSiteUrl(): string {
  return settings.VITE_SERVER_URL || "http://localhost:3001";
}
