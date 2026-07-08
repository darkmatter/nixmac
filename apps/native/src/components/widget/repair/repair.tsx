"use client";

import { Button } from "@/components/ui/button";
import { RestartSetupConfirmation } from "@/components/widget/onboarding/restart-setup";
import { tauriAPI } from "@/ipc/api";
import { settings } from "@/lib/env";
import { client } from "@/lib/orpc";
import { nav } from "@/router";
import { useViewModel } from "@nixmac/state";
import { CircleAlert, FolderX, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { computeRepairPlan, type RepairIssue, type RepairPlan } from "./lib";

/**
 * Launch-time evaluation of post-completion prerequisite regressions.
 *
 * Runs once when the (hydrated) widget mounts and only again through the
 * returned `recheck` — mid-session backend events never add or swap a repair
 * surface, mirroring how the onboarding takeover is entered only at
 * well-defined moments.
 */
export function useLaunchRepair(): {
  plan: RepairPlan;
  recheck: () => Promise<void>;
  dismissBanner: (kind: RepairIssue["kind"]) => void;
} {
  const [plan, setPlan] = useState<RepairPlan>({ blocking: null, banners: [] });
  const [dismissed, setDismissed] = useState<RepairIssue["kind"][]>([]);
  // The widget renders a neutral shell until hydration; the launch evaluation
  // must read post-hydration values (probes have run, latch is mirrored).
  const hydrated = useViewModel((s) => s.hydrated);

  const evaluate = useCallback(async () => {
    // Snapshot the store rather than subscribing: repair is launch-scoped
    // by design, not reactive.
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

    setPlan(
      computeRepairPlan({
        completedAt: vm.onboardingState?.completedAt ?? null,
        configDir,
        flakeExists,
        nixInstalled: vm.nixInstall?.installed ?? null,
        permissions: vm.permissions,
        skipPermissions: settings.skipPermissions === true,
        nixInstalledOverride: settings.nixInstalledOverride === true,
      }),
    );
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

  return {
    plan: {
      blocking: plan.blocking,
      banners: plan.banners.filter((b) => !dismissed.includes(b.kind)),
    },
    recheck,
    dismissBanner: (kind) => setDismissed((prev) => [...prev, kind]),
  };
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
                  Some features will fail until access is granted again in System Settings.
                </p>
              </>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {issue.kind === "permissions-revoked" && (
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  // Deep-link the first missing permission's grant flow, then
                  // re-probe so a fixed banner clears.
                  try {
                    // deprecated(orpc): replace with client/orpc from @/lib/orpc
                    await tauriAPI.permissions.request(issue.missing[0].id);
                  } catch {}
                  await onRecheck();
                }}
              >
                Fix…
              </Button>
            )}
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
