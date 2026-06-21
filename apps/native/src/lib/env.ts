import * as Schema from "effect/Schema";

// NIX_INSTALLED_OVERRIDE is parsed as a plain string and coerced to boolean
// in code below. We deliberately avoid `Schema.Literal` / `Schema.Literals`
// here because their signatures are version-skewed between effect 3.x
// (variadic `Literal(...values)`, no `Literals`) and 4.0-beta (single-value
// `Literal(value)` + plural `Literals(values)`), so neither form source-
// compiles in both. Plain `Schema.String` works regardless of which version
// bun's hoisting resolves - relevant because tsc/build sees 4.0-beta from
// the lockfile while Chromatic's storybook environment can end up resolving
// 3.x via stale workspace symlinks.
//
// Trade-off: we lose schema-level "must be 'true' or 'false'" strictness,
// but the only downstream consumer is `settings.NIX_INSTALLED_OVERRIDE !== true`
// (see widget/utils.ts), which treats any non-"true" value as functionally
// false. Silent acceptance of unexpected strings is observationally
// equivalent to coercing them to `undefined`.
const Settings = Schema.Struct({
  VITE_SERVER_URL: Schema.optional(Schema.String),
  NIX_INSTALLED_OVERRIDE: Schema.optional(Schema.String),
});

export type SettingsType = {
  readonly VITE_SERVER_URL?: string;
  readonly NIX_INSTALLED_OVERRIDE?: boolean;
};

const raw = Schema.decodeUnknownSync(Settings)(import.meta.env);

export const settings: SettingsType = {
  VITE_SERVER_URL: raw.VITE_SERVER_URL,
  NIX_INSTALLED_OVERRIDE: raw.NIX_INSTALLED_OVERRIDE === "true" ? true : undefined,
};

// Helper to resolve the public website URL used by the native/web apps.
// Prefers the Vite env var `VITE_SERVER_URL` when available, otherwise
// falls back to a localhost URL for local development.
export function getWebSiteUrl(): string {
  return settings.VITE_SERVER_URL || "http://localhost:3001";
}
