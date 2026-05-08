import * as Schema from "effect/Schema";

const Settings = Schema.Struct({
  VITE_SERVER_URL: Schema.optional(Schema.String),
  NIX_INSTALLED_OVERRIDE: Schema.optional(Schema.BooleanFromString),
});

export type SettingsType = Schema.Schema.Type<typeof Settings>;

export const settings: SettingsType = Schema.decodeUnknownSync(Settings)(
  import.meta.env,
);

// Helper to resolve the public website URL used by the native/web apps.
// Prefers the Vite env var `VITE_SERVER_URL` when available, otherwise
// falls back to a localhost URL for local development.
export function getWebSiteUrl(): string {
  return settings.VITE_SERVER_URL || "http://localhost:3001";
}
