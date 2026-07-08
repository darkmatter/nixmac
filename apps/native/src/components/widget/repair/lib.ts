import type { PermissionsState } from "@/ipc/types";

/** A prerequisite that regressed after onboarding completed. */
export type RepairIssue =
  | { kind: "config-missing"; configDir: string }
  | { kind: "nix-missing" }
  | { kind: "permissions-revoked"; missing: { id: string; name: string }[] };

export interface RepairInputs {
  /** Onboarding completion latch; repair is a post-completion concept. */
  completedAt: number | null;
  configDir: string | null;
  /** Whether a flake was found at the configured dir; null = probe unavailable. */
  flakeExists: boolean | null;
  nixInstalled: boolean | null;
  permissions: PermissionsState | null;
  /** Dev-profile overrides; a skipped gate must not resurface as a repair. */
  skipPermissions: boolean;
  nixInstalledOverride: boolean;
}

export interface RepairPlan {
  /** Renders in place of the main content: the app is inoperable without it. */
  blocking: Extract<RepairIssue, { kind: "config-missing" }> | null;
  /** Render above the main content; the app stays usable. */
  banners: RepairIssue[];
}

/**
 * Classify post-completion prerequisite regressions (design decision D7 of
 * docs/2026-07-08-onboarding-state-ownership.md). Evaluated once at launch —
 * the window is never swapped mid-session by a background event — and
 * re-evaluated only through the explicit "Check again" action.
 *
 * Only a missing configuration blocks: every main surface (evolve, git,
 * build) operates on it. A missing Nix install or a revoked permission
 * degrades specific actions but leaves the app browsable, so they banner.
 */
export function computeRepairPlan(inputs: RepairInputs): RepairPlan {
  // Pre-completion gating belongs to the onboarding wizard, not repair.
  if (inputs.completedAt === null) return { blocking: null, banners: [] };

  let blocking: RepairPlan["blocking"] = null;
  const banners: RepairIssue[] = [];

  if (inputs.configDir && inputs.flakeExists === false) {
    blocking = { kind: "config-missing", configDir: inputs.configDir };
  }

  if (!inputs.nixInstalledOverride && inputs.nixInstalled === false) {
    banners.push({ kind: "nix-missing" });
  }

  if (!inputs.skipPermissions && inputs.permissions && !inputs.permissions.allRequiredGranted) {
    const missing = inputs.permissions.permissions
      .filter((p) => p.required && p.status !== "granted")
      .map((p) => ({ id: p.id, name: p.name }));
    if (missing.length > 0) {
      banners.push({ kind: "permissions-revoked", missing });
    }
  }

  return { blocking, banners };
}
