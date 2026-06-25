import { createConsoleReporter, defineDiagnostics } from "nostics";
import { createDevReporter } from "nostics/reporters/dev";

/// <reference type="vite/client" />

export const DIAGNOSTIC_CODES = {
  EVOLVE_NO_PROVIDER: "EVOLVE_E001",
} as const;

export const REBUILD_ERROR_CODES = {
  INFINITE_RECURSION: "infinite_recursion",
  EVALUATION_ERROR: "evaluation_error",
  BUILD_ERROR: "build_error",
  FULL_DISK_ACCESS: "full_disk_access",
  USER_CANCELLED: "user_cancelled",
  AUTHORIZATION_DENIED: "authorization_denied",
  GENERIC_ERROR: "generic_error",
} as const;

export type RebuildErrorCode = (typeof REBUILD_ERROR_CODES)[keyof typeof REBUILD_ERROR_CODES];

type RebuildErrorDetails = {
  title: string;
  suggestion: string;
};

const DEFAULT_REBUILD_ERROR_DETAILS: RebuildErrorDetails = {
  title: "Build Failed",
  suggestion:
    "The build encountered an error. You can rollback to your previous configuration or dismiss to investigate.",
};

const REBUILD_ERROR_DETAILS = {
  [REBUILD_ERROR_CODES.INFINITE_RECURSION]: {
    title: "Infinite Recursion Detected",
    suggestion:
      "Your configuration has a circular dependency. Rolling back will restore your previous working configuration.",
  },
  [REBUILD_ERROR_CODES.EVALUATION_ERROR]: {
    title: "Nix Evaluation Error",
    suggestion:
      "There's a syntax or evaluation error in your Nix files. Check the error message for details.",
  },
  [REBUILD_ERROR_CODES.BUILD_ERROR]: {
    title: "Build Failed",
    suggestion:
      "A package failed to build. You may need to update your flake or fix the package configuration.",
  },
  [REBUILD_ERROR_CODES.FULL_DISK_ACCESS]: {
    title: "Full Disk Access Required",
    suggestion:
      "darwin-rebuild requires Full Disk Access. Make sure nixmac is in your Applications folder (not running from the install disk image), then grant access in System Settings → Privacy & Security → Full Disk Access.",
  },
  [REBUILD_ERROR_CODES.USER_CANCELLED]: {
    title: "Activation Cancelled",
    suggestion: "The activation was cancelled. You can retry the operation.",
  },
  [REBUILD_ERROR_CODES.AUTHORIZATION_DENIED]: {
    title: "Authorization Denied",
    suggestion:
      "The activation was denied due to insufficient permissions. You can adjust your settings and retry.",
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
  return getRebuildErrorDetails(errorCode).title;
}

export function getRebuildErrorSuggestion(errorCode: RebuildErrorCode | string | undefined): string {
  return getRebuildErrorDetails(errorCode).suggestion;
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
  },
});