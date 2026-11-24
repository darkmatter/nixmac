"use client";

import { Button } from "@/components/ui/button";
import { RestartSetupConfirmation } from "@/components/widget/onboarding/restart-setup";
import { tauriAPI } from "@/ipc/api";
import { settings } from "@/lib/env";
import { DIAGNOSTIC_CODES, diagnostics } from "@/lib/errors";
import { client } from "@/lib/orpc";
import { cn } from "@/lib/utils";
import { nav } from "@/router";
import { useViewModel } from "@nixmac/state";
import { CircleAlert, FolderX, Loader2, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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
 * the opt-in and may open Login Items, while Retry carries out the stored
 * decision again without recording a new one. A failed Retry request is
 * reported through the same diagnostic as the Permissions panel's Retry.
 */
function HelperActionButton({
  action,
  onRecheck,
  episode,
  onError,
}: {
  action: "approval" | "retry";
  onRecheck: () => Promise<void>;
  /** The failure episode a click starts in, read at click time. */
  episode: () => number;
  /** Reports for the episode the request started in; obsolete ones are ignored. */
  onError: (episode: number, message: string | null) => void;
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
        const started = episode();
        setWorking(true);
        onError(started, null);
        try {
          if (action === "approval") {
            await client.permissions.request({ permissionId: HELPER_PERMISSION_ID });
          } else {
            await client.darwin.helperRetry();
          }
          await onRecheck();
        } catch (error) {
          if (action === "retry") {
            // Reporting the diagnostic also logs it, with its code and fix.
            const diagnostic = diagnostics[DIAGNOSTIC_CODES.HELPER_RETRY_FAILED]({
              detail: error instanceof Error ? error.message : String(error),
            });
            onError(started, `${diagnostic.message} ${diagnostic.fix ?? ""}`.trim());
          } else {
            console.error("Failed to open the unattended sync helper approval:", error);
          }
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
  // A failed helper action, kept with the phase it failed in so a later state
  // does not inherit it.
  const [helperError, setHelperError] = useState<{ phase: string; message: string } | null>(null);
  // An error belongs to one failure episode. Leaving it, including the banner
  // disappearing because the helper recovered, clears it, so a later failure
  // never shows an earlier transport error before its own Retry.
  // A request still pending when its episode ends must not report into the
  // next one, so each phase change starts a new episode and a completion only
  // counts for the episode its click started in.
  const helperPhase = banners.find((issue) => issue.kind === "helper-inactive")?.phase ?? null;
  const helperEpisode = useRef(0);
  useEffect(() => {
    helperEpisode.current += 1;
    setHelperError(null);
  }, [helperPhase]);
  const currentEpisode = () => helperEpisode.current;
  const reportHelperError = (episode: number, phase: string, message: string | null) => {
    if (episode !== helperEpisode.current) return;
    setHelperError(message === null ? null : { phase, message });
  };
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
                {helperError !== null && helperError.phase === issue.phase ? (
                  <p role="alert" className="mt-1 wrap-anywhere text-xs">
                    {helperError.message}
                  </p>
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
              <HelperActionButton
                action="approval"
                onRecheck={onRecheck}
                episode={currentEpisode}
                onError={(episode, message) => reportHelperError(episode, issue.phase, message)}
              />
            ) : null}
            {issue.kind === "helper-inactive" && issue.phase === "failed" ? (
              <HelperActionButton
                action="retry"
                onRecheck={onRecheck}
                episode={currentEpisode}
                onError={(episode, message) => reportHelperError(episode, issue.phase, message)}
              />
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
