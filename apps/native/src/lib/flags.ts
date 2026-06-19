/**
 * Feature flags — VITE_-prefixed env vars compiled in at build time.
 *
 * Most flags are simple booleans. The filesystem flag additionally supports
 * a bitmask value that enables individual sections of the UI.
 *
 * For filesystem flags:
 *   - "true", "1", or "on" enable all sections
 *   - a positive integer enables the corresponding section bitmask
 *   - "false", "0", "off", unset, or invalid values disable all sections
 *   - in DEV builds, all sections are enabled by default unless the env var
 *     is explicitly set, in which case its value takes precedence
 */

export const enum FilesystemSectionFlag {
  Entry   = 1 << 1,
  Darwin  = 1 << 2,
  Home    = 1 << 3,
  Support = 1 << 4,
  Manage  = 1 << 5,
};

function envBitmask(value: unknown): number {
  if (typeof value !== "string") return 0;
  const v = value.trim().toLowerCase();
  if (v === "true" || v === "1" || v === "on") {
    return Number.MAX_SAFE_INTEGER;
  }
  if (!/^\d+$/.test(v)) {
    return 0;
  }
  return Number.parseInt(v, 10);
}

const filesystemEnv = import.meta.env.VITE_NIXMAC_FILESYSTEM;

// In DEV builds if the env var IS set, use it as a bitmask so we
// can test this behavior without doing a production build.
const filesystemSectionMask =
  filesystemEnv !== undefined
    ? envBitmask(filesystemEnv)
    : import.meta.env.DEV
      ? Number.MAX_SAFE_INTEGER
      : 0;

/**
 * Filesystem view (header FolderTree button + view itself).
 * Currently backed by mock data — keep gated until wired to real
 * filesystem state. Visible in dev builds; opt-in in production via
 * `VITE_NIXMAC_FILESYSTEM=true` or a numerical value which is a mask of the flags.
 */
export const filesystemViewEnabled = filesystemSectionMask !== 0;

export function filesystemSectionEnabled(flagValue: FilesystemSectionFlag): boolean {
  return (filesystemSectionMask & flagValue) !== 0;
}