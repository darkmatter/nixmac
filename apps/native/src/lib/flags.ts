/**
 * Feature flags — VITE_-prefixed env vars compiled in at build time.
 *
 * Convention: a feature flag is `true` when explicitly set to "true",
 * "1", or "on", or implicitly when running under `import.meta.env.DEV`.
 * Anything else is `false`. Each flag has a single named export so it
 * can be tree-shaken independently.
 */

function envFlag(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const v = value.toLowerCase();
  return v === "true" || v === "1" || v === "on";
}

/**
 * Filesystem view (header FolderTree button + view itself).
 * Currently backed by mock data — keep gated until wired to real
 * filesystem state. Visible in dev builds; opt-in in production via
 * `VITE_NIXMAC_FILESYSTEM=true`.
 */
export const filesystemViewEnabled =
  import.meta.env.DEV || envFlag(import.meta.env.VITE_NIXMAC_FILESYSTEM);
