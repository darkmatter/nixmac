import { readFileSync } from "node:fs";
import path from "node:path";

export type NixmacProfileName = "development" | "release" | "e2e";

function readProfileJson(nativeAppDir: string, name: NixmacProfileName): Record<string, unknown> {
  const raw = readFileSync(path.join(nativeAppDir, `env.${name}.json`), "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

/** Profile file selection — keep in sync with `apps/native/src-tauri/build.rs`. */
export function resolveNixmacProfile(): NixmacProfileName {
  switch (process.env.NIXMAC_ENV ?? "development") {
    case "prod":
    case "production":
      return "release";
    case "e2e":
      return "e2e";
    default:
      return "development";
  }
}

export function resolveNixmacVersion(nativeAppDir: string): string {
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

function isOverridableKey(key: string): boolean {
  return OVERRIDABLE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * Merge process env on top of the committed profile — same idea as `.env` overriding
 * defaults, and mirroring Rust `NixmacEnvSettings::resolve()` precedence for strings.
 */
export function mergeProfileWithProcessEnv(
  base: Record<string, unknown>,
  nativeAppDir: string,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };

  for (const [key, envValue] of Object.entries(process.env)) {
    if (key === "$schema" || envValue === undefined || envValue.trim() === "") continue;
    if (!(key in merged) && !isOverridableKey(key)) continue;
    merged[key] = coerceEnvOverride(merged[key], envValue);
  }

  merged.NIXMAC_VERSION = resolveNixmacVersion(nativeAppDir);
  return merged;
}

export function loadCommittedProfile(
  nativeAppDir: string,
  name: NixmacProfileName,
): Record<string, unknown> {
  return readProfileJson(nativeAppDir, name);
}

export function resolveMergedProfile(nativeAppDir: string): Record<string, unknown> {
  const base = loadCommittedProfile(nativeAppDir, resolveNixmacProfile());
  return mergeProfileWithProcessEnv(base, nativeAppDir);
}

export function nixmacBuildDefines(nativeAppDir: string): Record<string, string> {
  const profileName = resolveNixmacProfile();
  const merged = resolveMergedProfile(nativeAppDir);
  return {
    __NIXMAC_PROFILE__: JSON.stringify(profileName),
    __NIXMAC_PROFILE_JSON__: JSON.stringify(merged),
  };
}
