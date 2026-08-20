/**
 * The one permission nixmac installs itself instead of asking macOS for, and so
 * the one row whose state nixmac keeps working on after the probe returns.
 * Mirrors the backend's permission id (`system::permissions`), the same way
 * `lib/errors.ts` keeps the rebuild error codes' wire identifiers.
 */
export const HELPER_PERMISSION_ID = "privileged-helper";
