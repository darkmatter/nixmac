"use client";

import { Button } from "@/components/ui/button";
import { RestartSetupConfirmation } from "@/components/widget/onboarding/restart-setup";
import { tauriAPI } from "@/ipc/api";
import { settings } from "@/lib/env";
import { client } from "@/lib/orpc";
import { nav } from "@/router";
import { useViewModel } from "@nixmac/state";
import { CircleAlert, FolderX, Loader2, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  computeRepairPlan,
  HELPER_PERMISSION_ID,
  type RepairInputs,
  type RepairIssue,
  type RepairPlan,
} from "./lib";

/** The inputs read once, when the (hydrated) widget mounts. */
type LaunchSnapshot = Omit<
  RepairInputs,
  "helperRow" | "helperPreference" | "helperGraceElapsed"
>;

/**
 * How long "the helper was asked for and is not answering" must hold before the
 * banner says so.
 *
 * Not a cosmetic debounce: at the moment the widget mounts the condition is true
 * on any launch that has to re-register the helper, and the backend is already
 * working on it. Waiting lets those launches finish in silence, and leaves only
 * the ones that are still stuck once the user has had time to look at the window
 * — which is when there is something for them to do.
 */
export const HELPER_GRACE_MS = 10_000;

/**
 * Post-completion prerequisite regressions: what to block on, what to banner.
 *
 * The plan is decided from a launch snapshot, re-taken only by the returned
 * `recheck`, with one exception: the unattended sync helper's banner follows the
 * live row and the live standing decision. `computeRepairPlan` documents why that
 * one row is different and why a banner may change mid-session where the blocking
 * card may not.
 */
export function useRepair(): {
  plan: RepairPlan;
  recheck: () => Promise<void>;
  dismissBanner: (kind: RepairIssue["kind"]) => void;
} {
  const [snapshot, setSnapshot] = useState<LaunchSnapshot | null>(null);
  const [dismissed, setDismissed] = useState<RepairIssue["kind"][]>([]);
  // The widget renders a neutral shell until hydration; the launch evaluation
  // must read post-hydration values (probes have run, latch is mirrored).
  const hydrated = useViewModel((s) => s.hydrated);

  // The two live inputs. `find` hands back the row object the store holds rather
  // than building a new one, so a re-render can never come from the selector
  // itself. Every publish is one, though: each `permissions_changed` mirrors a
  // freshly deserialized state, so even a report identical to the last one is a
  // new object — which is why the grace clock below keys on the condition rather
  // than on the row.
  const helperRow = useViewModel(
    (s) => s.permissions?.permissions.find((p) => p.id === HELPER_PERMISSION_ID) ?? null,
  );
  const helperPreference = useViewModel((s) => s.preferences?.helperPreference ?? null);

  // The grace clock keys on the condition, not on the report that reveals it: a
  // helper whose registration keeps failing publishes a new row every pass, and
  // restarting the clock on each one would keep the banner off the screen for
  // exactly as long as the failure lasts. So the effect depends on this boolean
  // and nothing else — a report that changes while still not granted does not
  // touch the timer, and the row reaching granted clears the banner and the clock
  // together.
  const helperWanted =
    helperPreference === "granted" && helperRow !== null && helperRow.status !== "granted";
  const [helperGraceElapsed, setHelperGraceElapsed] = useState(false);
  useEffect(() => {
    if (!helperWanted) {
      setHelperGraceElapsed(false);
      return;
    }
    const timer = setTimeout(() => setHelperGraceElapsed(true), HELPER_GRACE_MS);
    return () => clearTimeout(timer);
  }, [helperWanted]);

  const evaluate = useCallback(async () => {
    // Snapshot the store rather than subscribing: everything here is
    // launch-scoped by design (the helper's live inputs are read above).
    const vm = useViewModel.getState();
    const configDir = vm.preferences?.configDir ?? null;

    let flakeExists: boolean | null = null;
    if (configDir) {
      try {
        flakeExists = await client.flake.exists();
      } catch {
        // Probe unavailable — do not manufacture a blocking state from it.
        flakeExists = null;
      }
    }

    setSnapshot({
      completedAt: vm.onboardingState?.completedAt ?? null,
      configDir,
      flakeExists,
      nixInstalled: vm.nixInstall?.installed ?? null,
      permissions: vm.permissions,
      skipPermissions: settings.skipPermissions === true,
      nixInstalledOverride: settings.nixInstalledOverride === true,
    });
  }, []);

  useEffect(() => {
    if (hydrated) void evaluate();
  }, [hydrated, evaluate]);

  const recheck = useCallback(async () => {
    // Refresh the probed inputs the plan reads before re-classifying.
    try {
      // deprecated(orpc): replace with client/orpc from @/lib/orpc
      await tauriAPI.permissions.refresh();
    } catch {}
    await evaluate();
  }, [evaluate]);

  const plan = snapshot
    ? computeRepairPlan({ ...snapshot, helperRow, helperPreference, helperGraceElapsed })
    : { blocking: null, banners: [] };

  return {
    plan: {
      blocking: plan.blocking,
      banners: plan.banners.filter((b) => !dismissed.includes(b.kind)),
    },
    recheck,
    dismissBanner: (kind) => setDismissed((prev) => [...prev, kind]),
  };
}

/**
 * The helper banner's one action: the same Grant the helper's row in Settings →
 * Permissions offers. It records the decision and reconciles towards it, and it
 * is the only action that opens Login Items — which it does when macOS is waiting
 * for the approval there.
 *
 * No re-probe afterwards, unlike the "Check again" button on the snapshot-based
 * banner: this banner reads the row live, and the backend publishes it on every
 * reconciliation pass. A failed call leaves the banner and the row's sentence
 * standing, which is already the truth, so it is logged rather than surfaced.
 *
 * The label keeps its box under `invisible` with the spinner laid over it, as the
 * helper's row does, because the Button base carries `transition-all`: a label
 * swapped for a shorter one would animate the width and shift the dismiss button
 * next to it. The spinner is nested rather than a direct child because `size="sm"`
 * carries `has-[>svg]:px-2.5`, which a top-level icon would trigger.
 */
function HelperGrantButton() {
  const [granting, setGranting] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={granting}
      aria-label={granting ? "Enabling…" : undefined}
      aria-busy={granting}
      className="relative disabled:opacity-100"
      onClick={async () => {
        setGranting(true);
        try {
          // deprecated(orpc): replace with client/orpc from @/lib/orpc
          await tauriAPI.permissions.request(HELPER_PERMISSION_ID);
        } catch (error) {
          console.error("Failed to enable the unattended sync helper:", error);
        } finally {
          setGranting(false);
        }
      }}
    >
      <span className={granting ? "invisible" : undefined}>Enable</span>
      {granting ? (
        <span className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        </span>
      ) : null}
    </Button>
  );
}

/** Non-blocking repair notices, rendered above the main content. */
export function RepairBanners({
  banners,
  onDismiss,
  onRecheck,
}: {
  banners: RepairIssue[];
  onDismiss: (kind: RepairIssue["kind"]) => void;
  onRecheck: () => Promise<void>;
}) {
  if (banners.length === 0) return null;
  return (
    <>
      {banners.map((issue) => (
        <div
          key={issue.kind}
          className="relative mx-5 mt-2 flex items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-amber-200 text-sm"
        >
          <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            {issue.kind === "nix-missing" ? (
              <>
                <p className="font-medium">Nix is no longer installed</p>
                <p className="mt-0.5 text-xs opacity-70">
                  Builds will fail until Nix is reinstalled. Reinstall it, or restart setup to be
                  walked through the install again.
                </p>
              </>
            ) : issue.kind === "permissions-revoked" ? (
              <>
                <p className="font-medium">
                  Required permission{issue.missing.length === 1 ? "" : "s"} revoked:{" "}
                  {issue.missing.map((p) => p.name).join(", ")}
                </p>
                <p className="mt-0.5 text-xs opacity-70">
                  Some features will fail until access is granted again. Review and re-grant
                  permissions in Settings → Permissions.
                </p>
              </>
            ) : issue.kind === "helper-inactive" ? (
              <>
                {/* States the condition and nothing more: which of the states
                    behind it this is cannot be known here, and the sentence
                    below is the row's own report of it. */}
                <p className="font-medium">Unattended sync helper is not active</p>
                {/* `wrap-anywhere` because these sentences quote paths — a
                    `/Volumes/…` bundle is one unbreakable token wider than the
                    banner. Not `break-all`, which would also break the ordinary
                    words at the end of every line. */}
                {issue.instructions ? (
                  <p className="mt-0.5 wrap-anywhere text-xs opacity-70">{issue.instructions}</p>
                ) : null}
              </>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {issue.kind === "permissions-revoked" && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => nav.openSettings("permissions")}
                >
                  Open Settings
                </Button>
                {/* Repair is launch-scoped, so the banner won't observe grants
                    made in the settings tab — offer an explicit re-probe. */}
                <Button size="sm" variant="ghost" onClick={() => void onRecheck()}>
                  Check again
                </Button>
              </>
            )}
            {issue.kind === "helper-inactive" && <HelperGrantButton />}
            <button
              type="button"
              onClick={() => onDismiss(issue.kind)}
              className="rounded p-0.5 opacity-50 transition-opacity hover:opacity-100"
              aria-label="Dismiss"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      ))}
    </>
  );
}

/**
 * Blocking repair surface: the configured flake is gone, so the main
 * surfaces have nothing to operate on. Rendered in place of the step
 * content; deliberately NOT the onboarding wizard (design decision D7).
 */
export function RepairBlockingCard({
  issue,
  onRecheck,
}: {
  issue: Extract<RepairIssue, { kind: "config-missing" }>;
  onRecheck: () => Promise<void>;
}) {
  const [confirmingRestart, setConfirmingRestart] = useState(false);
  const [rechecking, setRechecking] = useState(false);

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-md space-y-4 rounded-xl border border-border p-6 text-center">
        <FolderX className="mx-auto size-8 text-amber-400" aria-hidden="true" />
        <div className="space-y-1">
          <h2 className="font-semibold text-base">Configuration not found</h2>
          <p className="text-muted-foreground text-sm">
            No flake was found at{" "}
            <span className="break-all font-mono text-xs">{issue.configDir}</span>. The folder may
            have been moved or deleted. Point nixmac at the right folder, or restart setup.
          </p>
        </div>
        <div className="flex items-center justify-center gap-2">
          <Button size="sm" onClick={() => nav.openSettings("general")}>
            Choose folder…
          </Button>
          <Button size="sm" variant="outline" onClick={() => setConfirmingRestart(true)}>
            <RotateCcw className="size-3.5" aria-hidden="true" />
            Restart setup
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={rechecking}
            onClick={async () => {
              setRechecking(true);
              try {
                await onRecheck();
              } finally {
                setRechecking(false);
              }
            }}
          >
            Check again
          </Button>
        </div>
        <RestartSetupConfirmation
          open={confirmingRestart}
          onOpenChange={setConfirmingRestart}
          context="completed"
        />
      </div>
    </div>
  );
}
