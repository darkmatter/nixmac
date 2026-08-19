import { z } from "zod";

const envBool = z.preprocess((value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes";
  }
  return false;
}, z.boolean());

const optionalEnvString = z.preprocess((value) => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}, z.string().optional());

/**
 * Deployment environment, named by the `NIXMAC_ENV` key of each committed
 * profile. These are exactly the values `NIXMAC_ENV` may take when selecting a
 * profile, and both selectors refuse a file whose own `NIXMAC_ENV` is not the
 * value that selected it — see `nixmac-profile.ts` and `src-tauri/build.rs`.
 */
export const NIXMAC_ENVS = ["development", "production", "e2e"] as const;

export type NixmacEnv = (typeof NIXMAC_ENVS)[number];

/**
 * Shape of `apps/native/env.{development,release,e2e}.json` after the
 * build-time merge with process env.
 *
 * Imported by the build script, which validates and coerces a profile before
 * baking it into the bundle, and by `src/lib/env.ts`, which parses the baked
 * value. One schema for both, so they cannot disagree about what a profile is.
 */
export const EnvProfileSchema = z
  .object({
    $schema: z.string().optional(),
    NIXMAC_ENV: z.enum(NIXMAC_ENVS),
    NIXMAC_VERSION: optionalEnvString,
    VITE_SERVER_URL: optionalEnvString,
    VITE_POSTHOG_KEY: optionalEnvString,
    VITE_POSTHOG_HOST: z.string().default("https://us.i.posthog.com"),
    VITE_NIXMAC_FILESYSTEM: envBool.default(false),
    NIX_INSTALLED_OVERRIDE: envBool.default(false),
    NIXMAC_DISABLE_UPDATER: envBool.default(false),
    VITE_NIXMAC_SKIP_PERMISSIONS: envBool.default(false),
  })
  .passthrough();

export type EnvProfile = z.infer<typeof EnvProfileSchema>;
