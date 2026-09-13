import type { HelperPreference, Permission, PermissionsState } from "@/ipc/types";
import { HELPER_PERMISSION_ID } from "@/lib/permissions";

/** A prerequisite that regressed after onboarding completed. */
export type RepairIssue =
  | { kind: "config-missing"; configDir: string }
  | { kind: "nix-missing" }
  | { kind: "permissions-revoked"; missing: { id: string; name: string }[] }
  /** The user asked for the unattended sync helper and it is not ready. */
  | {
      kind: "helper-inactive";
      phase: NonNullable<Permission["helperPhase"]>;
      instructions: string | null;
    };

export interface RepairInputs {
  /** Onboarding completion latch; repair is a post-completion concept. */
  completedAt: number | null;
  configDir: string | null;
  /** Whether a flake was found at the configured dir; null = probe unavailable. */
  flakeExists: boolean | null;
  nixInstalled: boolean | null;
  permissions: PermissionsState | null;
  /**
   * The helper's row as it stands *now*, not as the snapshot in `permissions`
   * had it; null before the first probe. See [`computeRepairPlan`] for why it
   * is read live.
   */
  helperRow: Permission | null;
  /** The user's standing decision about the helper; null before hydration. */
  helperPreference: HelperPreference | null;
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
 * docs/2026-07-08-onboarding-state-ownership.md).
 *
 * Only a missing configuration blocks: every main surface operates on it,
 * while the other regressions degrade specific actions and banner instead.
 *
 * Every input except the two helper ones is snapshotted when the widget
 * mounts and re-read only through "Check again", keeping the blocking card
 * decided once per launch, as D7 requires. The helper's inputs are live: its
 * row is expected to be wrong for the first seconds of a launch and to come
 * right on its own, so a snapshot would banner a launch that is about to be
 * fine — and a banner is the one surface D7 allows to change mid-session.
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
    // The helper gets its own banner below: its list entry here would be a
    // snapshot where its row is live, and "revoked" is wrong for a
    // registration waiting on approval. The `missing.length > 0` guard keeps
    // this banner from rendering empty.
    const missing = inputs.permissions.permissions
      .filter((p) => p.required && p.status !== "granted" && p.id !== HELPER_PERMISSION_ID)
      .map((p) => ({ id: p.id, name: p.name }));
    if (missing.length > 0) {
      banners.push({ kind: "permissions-revoked", missing });
    }
  }

  // The helper reverses the old no-marker decision deliberately: approval,
  // progress, an active sync, displacement, and failure require different
  // copy and actions. The backend owns this phase so every surface sees the
  // same state and no UI parses diagnostic prose.
  if (
    !inputs.skipPermissions &&
    inputs.helperPreference === "granted" &&
    inputs.helperRow !== null &&
    inputs.helperRow.status !== "granted"
  ) {
    const observedPhase =
      inputs.helperRow.helperPhase ??
      (inputs.helperRow.canRequestProgrammatically ? "reconciling" : "approvalRequired");
    // Defensive only: a correct reconciliation cannot report NoHelper/Removed
    // while the stored preference is Granted. If state ever arrives crossed,
    // do not silently render it as an intentional opt-out.
    const phase =
      observedPhase === "disabled" || observedPhase === "ready" ? "failed" : observedPhase;
    banners.push({
      kind: "helper-inactive",
      phase,
      instructions: inputs.helperRow.instructions ?? null,
    });
  }

  return { blocking, banners };
}
