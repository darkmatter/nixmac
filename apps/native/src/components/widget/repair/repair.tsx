"use client";

import { Button } from "@/components/ui/button";
import { RestartSetupConfirmation } from "@/components/widget/onboarding/restart-setup";
import { tauriAPI } from "@/ipc/api";
import { settings } from "@/lib/env";
import { client } from "@/lib/orpc";
import { cn } from "@/lib/utils";
import { nav } from "@/router";
import { useViewModel } from "@nixmac/state";
import { CircleAlert, FolderX, Loader2, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { HELPER_PERMISSION_ID } from "@/lib/permissions";
import {
  computeRepairPlan,
  type RepairInputs,
  type RepairIssue,
  type RepairPlan,
} from "./lib";

/** The inputs read once, when the (hydrated) widget mounts. */
type LaunchSnapshot = Omit<
  RepairInputs,
  "helperRow" | "helperPreference"
>;

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

  // The two live inputs.
  const helperRow = useViewModel(
    (s) => s.permissions?.permissions.find((p) => p.id === HELPER_PERMISSION_ID) ?? null,
  );
  const helperPreference = useViewModel((s) => s.preferences?.helperPreference ?? null);

  // Dismissal belongs to the state the user saw. A later failure must not stay
  // hidden because the user dismissed an earlier progress or approval notice.
  useEffect(() => {
    setDismissed((current) => current.filter((kind) => kind !== "helper-inactive"));
  }, [helperRow?.helperPhase]);

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
    ? computeRepairPlan({ ...snapshot, helperRow, helperPreference })
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
 * The helper's two repair actions are intentionally distinct: approval records
 * the opt-in and may open Login Items, while Retry preserves the standing
 * decision and only runs reconciliation again.
 */
function HelperActionButton({
  action,
  onRecheck,
}: {
  action: "approval" | "retry";
  onRecheck: () => Promise<void>;
}) {
  const [working, setWorking] = useState(false);
  const idle = action === "approval" ? "Open System Settings" : "Retry";
  const busy = action === "approval" ? "Opening…" : "Retrying…";
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={working}
      aria-label={working ? busy : undefined}
      aria-busy={working}
      className="relative disabled:opacity-100"
      onClick={async () => {
        setWorking(true);
        try {
          if (action === "approval") {
            await client.permissions.request({ permissionId: HELPER_PERMISSION_ID });
          } else {
            await client.darwin.helperRetry();
          }
          await onRecheck();
        } catch (error) {
          console.error(`Failed to ${action === "approval" ? "open" : "retry"} the unattended sync helper:`, error);
        } finally {
          setWorking(false);
        }
      }}
    >
      <span className={working ? "invisible" : undefined}>{idle}</span>
      {working ? (
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
          className={cn(
            "relative mx-5 mt-2 flex items-center gap-3 rounded-lg border px-4 py-3 text-sm",
            issue.kind === "helper-inactive" &&
              (issue.phase === "reconciling" || issue.phase === "waitingForActivation")
              ? "border-primary/30 bg-primary/10 text-primary"
              : "border-amber-500/40 bg-amber-500/10 text-amber-200",
          )}
        >
          {issue.kind === "helper-inactive" &&
          (issue.phase === "reconciling" || issue.phase === "waitingForActivation") ? (
            <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
          ) : (
            <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
          )}
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
                <p className="font-medium">
                  {issue.phase === "approvalRequired"
                    ? "Finish enabling unattended sync"
                    : issue.phase === "reconciling"
                      ? "Finishing unattended sync setup…"
                      : issue.phase === "waitingForActivation"
                        ? "Waiting for the current build or restore to finish"
                        : issue.phase === "needsUserAction"
                          ? "Unattended sync needs your attention"
                          : "Couldn’t finish enabling unattended sync"}
                </p>
                {/* The row's sentences quote unbreakable `/Volumes/…` paths
                    wider than the banner, so they must be allowed to break
                    anywhere. */}
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
            {issue.kind === "helper-inactive" && issue.phase === "approvalRequired" ? (
              <HelperActionButton action="approval" onRecheck={onRecheck} />
            ) : null}
            {issue.kind === "helper-inactive" && issue.phase === "failed" ? (
              <HelperActionButton action="retry" onRecheck={onRecheck} />
            ) : null}
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
