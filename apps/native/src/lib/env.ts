export type SettingsType = {
  VITE_SERVER_URL?: string;
  NIX_INSTALLED_OVERRIDE?: boolean;
};

function booleanFromEnv(value: unknown): boolean | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

export const settings: SettingsType = {
  VITE_SERVER_URL:
    typeof import.meta.env?.VITE_SERVER_URL === "string" ? import.meta.env.VITE_SERVER_URL : undefined,
  NIX_INSTALLED_OVERRIDE: booleanFromEnv(import.meta.env?.NIX_INSTALLED_OVERRIDE),
};

// Helper to resolve the public website URL used by the native/web apps.
// Prefers the Vite env var `VITE_SERVER_URL` when available, otherwise
// falls back to a localhost URL for local development.
export function getWebSiteUrl(): string {
  return settings.VITE_SERVER_URL || "http://localhost:3001";
}
