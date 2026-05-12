import * as Schema from "effect/Schema";

const Settings = Schema.Struct({
  VITE_SERVER_URL: Schema.optional(Schema.String),
  // Vite env vars come in as strings; only the literal "true"
  // (case-insensitive) will be treated as an override.
  NIX_INSTALLED_OVERRIDE: Schema.optional(Schema.String),
});

export type SettingsType = Schema.Schema.Type<typeof Settings>;

const rawSettings = Schema.decodeUnknownSync(Settings)(import.meta.env) as SettingsType;

export const settings = {
  ...rawSettings,
  NIX_INSTALLED_OVERRIDE:
    rawSettings.NIX_INSTALLED_OVERRIDE == null
      ? undefined
      : /^true$/i.test(String(rawSettings.NIX_INSTALLED_OVERRIDE)),
} as {
  readonly VITE_SERVER_URL?: string;
  readonly NIX_INSTALLED_OVERRIDE?: boolean;
};

// Helper to resolve the public website URL used by the native/web apps.
// Prefers the Vite env var `VITE_SERVER_URL` when available, otherwise
// falls back to a localhost URL for local development.
export function getWebSiteUrl(): string {
  return settings.VITE_SERVER_URL || "http://localhost:3001";
}
