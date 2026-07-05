import { createConsoleReporter, defineDiagnostics } from "nostics";
import { createDevReporter } from "nostics/reporters/dev";

/// <reference type="vite/client" />

const DIAGNOSTIC_CODES = {
  EVOLVE_NO_PROVIDER: "EVOLVE_E001",
} as const;

/**
 * Stable rebuild/activation failure codes. These mirror the Rust
 * `RebuildErrorType` enum (`shared_types::events`, snake_case on the wire) and
 * double as nostics diagnostic codes so the overlay copy and any
 * thrown/reported diagnostic stay in sync. App-defined codes (`EVOLVE_E001`)
 * follow the `PREFIX_XNNNN` convention; backend-driven categories keep their
 * wire identifier to avoid a mapping layer.
 */
export const REBUILD_ERROR_CODES = {
  INFINITE_RECURSION: "infinite_recursion",
  EVALUATION_ERROR: "evaluation_error",
  BUILD_ERROR: "build_error",
  FULL_DISK_ACCESS: "full_disk_access",
  APP_MANAGEMENT: "app_management",
  USER_CANCELLED: "user_cancelled",
  AUTHORIZATION_DENIED: "authorization_denied",
  ETC_CLOBBER: "etc_clobber",
  GENERIC_ERROR: "generic_error",
} as const;

export type RebuildErrorCode = (typeof REBUILD_ERROR_CODES)[keyof typeof REBUILD_ERROR_CODES];

/**
 * True when a rebuild failure should be followed by a permissions re-probe.
 * App Management failures stay in the rebuild error panel because macOS does
 * not expose a reliable grant probe for that TCC service.
 */
export function isProbeablePermissionRebuildError(errorCode: string | null | undefined): boolean {
  return errorCode === REBUILD_ERROR_CODES.FULL_DISK_ACCESS;
}

/**
 * Rebuild failures that are NOT fixable by editing Nix config — permission,
 * authorization, cancellation, and /etc-clobber classes. These route to their
 * own resolution flows (permission re-probe, rename-and-retry), so "Fix with
 * AI" is suppressed for them to avoid wasting an evolve run.
 */
const AI_UNFIXABLE_REBUILD_ERRORS = new Set<string>([
  REBUILD_ERROR_CODES.FULL_DISK_ACCESS,
  REBUILD_ERROR_CODES.APP_MANAGEMENT,
  REBUILD_ERROR_CODES.USER_CANCELLED,
  REBUILD_ERROR_CODES.AUTHORIZATION_DENIED,
  REBUILD_ERROR_CODES.ETC_CLOBBER,
]);

/**
 * True when a failed build's error class is something the evolve agent can
 * plausibly fix by editing the configuration (evaluation/build/recursion
 * errors and the generic catch-all). Used to gate the "Fix with AI" button.
 */
export function isAiFixableRebuildError(errorCode: string | null | undefined): boolean {
  if (!errorCode) {
    // Unknown/unclassified failures are still worth an attempt.
    return true;
  }
  return !AI_UNFIXABLE_REBUILD_ERRORS.has(errorCode);
}

type RebuildErrorDetails = {
  why: string;
  fix: string;
};

const DEFAULT_REBUILD_ERROR_DETAILS: RebuildErrorDetails = {
  why: "Build failed",
  fix: "The build encountered an error. You can rollback to your previous configuration or dismiss to investigate.",
};

/**
 * Single source of truth for rebuild error copy. The `why`/`fix` shape matches
 * nostics `DiagnosticDefinition`, so this map is spread directly into
 * `defineDiagnostics` below — no parallel registry, no duplicated strings.
 */
const REBUILD_ERROR_DETAILS = {
  [REBUILD_ERROR_CODES.INFINITE_RECURSION]: {
    why: "Infinite recursion detected in your configuration",
    fix: "Your configuration has a circular dependency. Rolling back will restore your previous working configuration.",
  },
  [REBUILD_ERROR_CODES.EVALUATION_ERROR]: {
    why: "Nix evaluation error",
    fix: "There's a syntax or evaluation error in your Nix files. Check the error message for details.",
  },
  [REBUILD_ERROR_CODES.BUILD_ERROR]: {
    why: "Build failed",
    fix: "A package failed to build. You may need to update your flake or fix the package configuration.",
  },
  [REBUILD_ERROR_CODES.FULL_DISK_ACCESS]: {
    why: "Full Disk Access is required for activation",
    fix: "darwin-rebuild requires Full Disk Access. Make sure nixmac is in your Applications folder (not running from the install disk image), then grant access in System Settings → Privacy & Security → Full Disk Access.",
  },
  [REBUILD_ERROR_CODES.APP_MANAGEMENT]: {
    why: "App Management is required to update managed app bundles",
    fix: "macOS blocked nixmac while updating managed app bundles. Enable nixmac in System Settings → Privacy & Security → App Management, or grant Full Disk Access if you prefer the broader permission.",
  },
  [REBUILD_ERROR_CODES.USER_CANCELLED]: {
    why: "Activation cancelled",
    fix: "The activation was cancelled. You can retry the operation.",
  },
  [REBUILD_ERROR_CODES.AUTHORIZATION_DENIED]: {
    why: "Authorization denied",
    fix: "The activation was denied due to insufficient permissions. You can adjust your settings and retry.",
  },
  [REBUILD_ERROR_CODES.ETC_CLOBBER]: {
    why: "Existing /etc files would be overwritten",
    fix: "nix-darwin found files in /etc it doesn't manage and won't overwrite. Back up anything important, then rename each listed file by adding .before-nix-darwin to the end and retry. No changes were made to your system.",
  },
  [REBUILD_ERROR_CODES.GENERIC_ERROR]: DEFAULT_REBUILD_ERROR_DETAILS,
} satisfies Record<RebuildErrorCode, RebuildErrorDetails>;

function getRebuildErrorDetails(errorCode: RebuildErrorCode | string | undefined): RebuildErrorDetails {
  if (!errorCode || !(errorCode in REBUILD_ERROR_DETAILS)) {
    return DEFAULT_REBUILD_ERROR_DETAILS;
  }

  return REBUILD_ERROR_DETAILS[errorCode as RebuildErrorCode];
}

export function getRebuildErrorTitle(errorCode: RebuildErrorCode | string | undefined): string {
  return getRebuildErrorDetails(errorCode).why;
}

export function getRebuildErrorSuggestion(errorCode: RebuildErrorCode | string | undefined): string {
  return getRebuildErrorDetails(errorCode).fix;
}

export function getRebuildSystemSafetyMessage(
  systemUntouched: boolean | undefined,
  context: "apply" | "rollback",
): string | null {
  if (context !== "apply") {
    return null;
  }

  if (systemUntouched === true) {
    return "No changes were made to your system.";
  }

  return null;
}

function docsBase(code: string): string {
  return `https://docs.nixmac.com/diagnostics/${code}`;
}

// since this  is a desktop app, we don't need to worry about reducing bundle size
export const diagnostics = defineDiagnostics({
  docsBase,
  reporters: [createConsoleReporter(), createDevReporter()],
  codes: {
    [DIAGNOSTIC_CODES.EVOLVE_NO_PROVIDER]: {
      why: `No provider configured`,
      fix: `Sign into your Nixmac account or configure your provider in Settings`,
    },
    ...REBUILD_ERROR_DETAILS,
  },
});