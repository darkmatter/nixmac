/**
 * Feature flags from the committed env profile (plus `import.meta.env.DEV`).
 *
 * Each flag has a single named export so it can be tree-shaken independently.
 */

import { settings } from "@/lib/env";

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
 * Enabled in development profile; opt-in in production via profile JSON.
 */
export const filesystemViewEnabled =
  import.meta.env.DEV || settings.filesystemEnabled;
