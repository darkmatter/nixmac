import * as Schema from "effect/Schema";

const Settings = Schema.Struct({
  VITE_SERVER_URL: Schema.optional(Schema.String),
  NIX_INSTALLED_OVERRIDE: Schema.optional(Schema.Literal("true", "false")),
});

type RawSettings = Schema.Schema.Type<typeof Settings>;

export type SettingsType = Omit<RawSettings, "NIX_INSTALLED_OVERRIDE"> & {
  readonly NIX_INSTALLED_OVERRIDE?: boolean;
};

const raw = Schema.decodeUnknownSync(Settings)(import.meta.env);

export const settings: SettingsType = {
  VITE_SERVER_URL: raw.VITE_SERVER_URL,
  NIX_INSTALLED_OVERRIDE:
    raw.NIX_INSTALLED_OVERRIDE === undefined
      ? undefined
      : raw.NIX_INSTALLED_OVERRIDE === "true",
};

// Helper to resolve the public website URL used by the native/web apps.
// Prefers the Vite env var `VITE_SERVER_URL` when available, otherwise
// falls back to a localhost URL for local development.
export function getWebSiteUrl(): string {
  return settings.VITE_SERVER_URL || "http://localhost:3001";
}
