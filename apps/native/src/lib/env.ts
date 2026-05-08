export interface SettingsType {
  VITE_SERVER_URL?: string;
  NIX_INSTALLED_OVERRIDE?: boolean;
}

function booleanFromEnv(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;

  switch (value.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    case "0":
    case "false":
    case "no":
    case "off":
      return false;
    default:
      return undefined;
  }
}

export const settings: SettingsType = {
  VITE_SERVER_URL:
    typeof import.meta.env.VITE_SERVER_URL === "string"
      ? import.meta.env.VITE_SERVER_URL
      : undefined,
  NIX_INSTALLED_OVERRIDE: booleanFromEnv(import.meta.env.NIX_INSTALLED_OVERRIDE),
};

// Helper to resolve the public website URL used by the native/web apps.
// Prefers the Vite env var `VITE_SERVER_URL` when available, otherwise
// falls back to a localhost URL for local development.
export function getWebSiteUrl(): string {
  return settings.VITE_SERVER_URL || "http://localhost:3001";
}
