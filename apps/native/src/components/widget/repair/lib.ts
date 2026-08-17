import type { HelperPreference, Permission, PermissionsState } from "@/ipc/types";

/**
 * The one permission nixmac installs itself instead of asking macOS for, and so
 * the one row whose state nixmac keeps working on after the probe returns.
 */
export const HELPER_PERMISSION_ID = "privileged-helper";

/** A prerequisite that regressed after onboarding completed. */
export type RepairIssue =
  | { kind: "config-missing"; configDir: string }
  | { kind: "nix-missing" }
  | { kind: "permissions-revoked"; missing: { id: string; name: string }[] }
  /** The user asked for the unattended sync helper and it is not answering. */
  | { kind: "helper-inactive"; instructions: string | null };

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
   * had it; null before the first probe. Read live because this row is expected
   * to be wrong for the first seconds of a launch and to then come right on its
   * own — see the header comment.
   */
  helperRow: Permission | null;
  /** The user's standing decision about the helper; null before hydration. */
  helperPreference: HelperPreference | null;
  /** Whether the helper condition has held long enough to be worth saying. */
  helperGraceElapsed: boolean;
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
 * Only a missing configuration blocks: every main surface (evolve, git,
 * build) operates on it. A missing Nix install or a revoked permission
 * degrades specific actions but leaves the app browsable, so they banner.
 *
 * Every input except the three helper ones is snapshotted when the widget mounts
 * and re-read only through the explicit "Check again" action, so the blocking
 * card is still decided once per launch: D7's rule is that a prerequisite is
 * "evaluated at launch and surfaced in place — the window is never swapped
 * mid-session by a background event", and replacing the step content is that
 * swap.
 *
 * The helper's inputs are live because a snapshot of that row says nothing
 * durable. A launch that upgrades the helper re-registers it, macOS may hold the
 * new registration until the user approves it in Login Items, and the backend
 * keeps reconciling until it converges — all of it after the probe the snapshot
 * came from. So a snapshot would banner a launch that is about to be fine, and
 * keep bannering after it became fine. A banner is the surface D7 allows to
 * change: it appears above the content and takes nothing over.
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
    // The helper is left out of this list unconditionally, and gets the banner
    // below instead. Two reasons, both structural: this list is a snapshot and
    // its row is not, and "revoked" is false for a registration that is waiting
    // for an approval the user has not given yet. Leaving it out cannot produce
    // an empty banner — `allRequiredGranted` still counts the helper, so it still
    // goes false, and the `missing.length > 0` guard is what decides.
    const missing = inputs.permissions.permissions
      .filter((p) => p.required && p.status !== "granted" && p.id !== HELPER_PERMISSION_ID)
      .map((p) => ({ id: p.id, name: p.name }));
    if (missing.length > 0) {
      banners.push({ kind: "permissions-revoked", missing });
    }
  }

  // The user asked for the helper and the helper is not answering.
  //
  // The condition is exactly that: the standing decision is `granted` and the row
  // is not. It covers a registration waiting for approval in Login Items, a copy
  // of nixmac running from a folder macOS will not register, and a register that
  // failed — and it deliberately cannot tell them apart, because the row carries
  // no marker to tell them apart by. Hence one headline for all of them, stating
  // the condition rather than any one cause, and the row's own `instructions` as
  // the sentence that says what is actually true right now.
  //
  // The same lack of a marker is why the banner's button is the row's Grant
  // action for every one of those states. When macOS is waiting for approval,
  // that click opens the pane where the user gives it, which is the case this
  // banner exists for. In the states no run can fix, the click re-runs and
  // re-reports the same sentence: honest, and no help. That is the accepted cost
  // of having nothing to branch on — not a gap to close by inventing a marker.
  if (
    !inputs.skipPermissions &&
    inputs.helperPreference === "granted" &&
    inputs.helperRow !== null &&
    inputs.helperRow.status !== "granted" &&
    inputs.helperGraceElapsed
  ) {
    banners.push({
      kind: "helper-inactive",
      instructions: inputs.helperRow.instructions ?? null,
    });
  }

  return { blocking, banners };
}
