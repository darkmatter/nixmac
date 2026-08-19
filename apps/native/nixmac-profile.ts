import { readFileSync } from "node:fs";
import path from "node:path";
import { EnvProfileSchema, NIXMAC_ENVS, type NixmacEnv } from "./src/lib/env-profile-schema";

type NixmacProfileName = "development" | "release" | "e2e";

function readProfileJson(nativeAppDir: string, name: NixmacProfileName): Record<string, unknown> {
  const raw = readFileSync(path.join(nativeAppDir, `env.${name}.json`), "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

/**
 * Profile file selection — keep in sync with `apps/native/src-tauri/build.rs`.
 *
 * Unset means development. Any other value is a mistake in the build command,
 * not a request for the default: falling through used to bake the development
 * profile, permission checks disabled, into a build that looked like a release.
 *
 * Returns the selector as well as the file, so the caller can check that the
 * file it picked names the same environment.
 */
function resolveNixmacProfile(): { selector: NixmacEnv; file: NixmacProfileName } {
  const selector = process.env.NIXMAC_ENV ?? "development";
  switch (selector) {
    case "development":
      return { selector, file: "development" };
    case "production":
      return { selector, file: "release" };
    case "e2e":
      return { selector, file: "e2e" };
    default:
      throw new Error(
        `NIXMAC_ENV must be unset or one of ${NIXMAC_ENVS.join(", ")}; got ${JSON.stringify(selector)}`,
      );
  }
}

function resolveNixmacVersion(nativeAppDir: string): string {
  if (process.env.NIXMAC_VERSION) {
    return process.env.NIXMAC_VERSION;
  }
  try {
    const pkg = JSON.parse(
      readFileSync(path.join(nativeAppDir, "package.json"), "utf8"),
    ) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function coerceEnvOverride(
  baseValue: unknown,
  envValue: string,
): string | boolean | number {
  if (typeof baseValue === "boolean") {
    const normalized = envValue.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes";
  }
  if (typeof baseValue === "number") {
    const parsed = Number(envValue);
    return Number.isFinite(parsed) ? parsed : envValue;
  }
  return envValue;
}

const OVERRIDABLE_PREFIXES = [
  "NIXMAC_",
  "VITE_",
  "SENTRY_",
  "SUBMITTED_",
  "SUMMARY_",
  "EVOLVE_",
  "OLLAMA_",
  "VLLM_",
  "OPENAI_",
  "OPENROUTER_",
  "DEBUG_",
  "NIX_INSTALLED_",
] as const;

/**
 * Keys process env must never overwrite.
 *
 * `NIXMAC_ENV` picks which profile file to read, and each profile names the same
 * environment in its own `NIXMAC_ENV` key. Letting process env write that key too
 * is what let the selector and the file it selected drift apart. A selector is not
 * a setting.
 */
const NON_OVERRIDABLE_KEYS = new Set(["$schema", "NIXMAC_ENV"]);

function isOverridableKey(key: string): boolean {
  return OVERRIDABLE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * Merge process env on top of the committed profile — same idea as `.env` overriding
 * defaults, and mirroring Rust `NixmacEnvSettings::resolve()` precedence for strings.
 */
function mergeProfileWithProcessEnv(
  base: Record<string, unknown>,
  nativeAppDir: string,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };

  for (const [key, envValue] of Object.entries(process.env)) {
    if (NON_OVERRIDABLE_KEYS.has(key) || envValue === undefined || envValue.trim() === "")
      continue;
    if (!(key in merged) && !isOverridableKey(key)) continue;
    merged[key] = coerceEnvOverride(merged[key], envValue);
  }

  merged.NIXMAC_VERSION = resolveNixmacVersion(nativeAppDir);
  return merged;
}

function resolveMergedProfile(
  nativeAppDir: string,
  file: NixmacProfileName,
): Record<string, unknown> {
  return mergeProfileWithProcessEnv(readProfileJson(nativeAppDir, file), nativeAppDir);
}

/**
 * Vite `define` entries that bake the selected profile into the bundle.
 *
 * A define is raw text substitution, so this emits a JavaScript object literal
 * that `src/lib/env.ts` consumes directly: no string to parse, and therefore no
 * parse for a bad profile to fall back from. Validating and coercing here means
 * an invalid profile fails the build instead of the app.
 *
 * The schema only checks that `NIXMAC_ENV` is one of the three names, so the
 * file could name an environment other than the one the selector asked for.
 * `mayBypassUserGates` in `src/lib/env.ts` reads that name to decide whether the
 * skip-permissions and nix-installed bypasses are allowed at all, so a profile
 * mislabelled `development` would switch that lockout off in a release build.
 * Checking the two agree is what keeps the name honest.
 */
export function nixmacBuildDefines(nativeAppDir: string): Record<string, string> {
  const { selector, file } = resolveNixmacProfile();
  const profile = EnvProfileSchema.parse(resolveMergedProfile(nativeAppDir, file));
  if (profile.NIXMAC_ENV !== selector) {
    throw new Error(
      `env.${file}.json declares NIXMAC_ENV ${JSON.stringify(profile.NIXMAC_ENV)}, but this build selected ${JSON.stringify(selector)}; the two must name the same environment`,
    );
  }
  return {
    __NIXMAC_PROFILE_DATA__: JSON.stringify(profile),
  };
}
