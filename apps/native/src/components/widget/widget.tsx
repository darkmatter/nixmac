"use client";

import { useWidgetStore } from "@/stores/widget-store";
import { computeCurrentStep } from "@/components/widget/utils";
import {
  darwinAPI,
  ipcRenderer,
} from "@/tauri-api";
import type { GitStatus } from "@/tauri-api";
import {
  loadConfig,
  loadHosts,
  recoverFromGitState,
} from "@/hooks/use-widget-initialization";
import { useEffect, useRef } from "react";
import {
  SetupStep,
  OverviewStep,
  EvolvingStep,
  CommitStep,
  PermissionsStep,
} from "./steps";
import { Header } from "@/components/widget/header";
import { Stepper } from "@/components/widget/stepper";
import { Console } from "@/components/widget/console";
import { SettingsDialog } from "@/components/widget/settings-dialog";
import { ErrorMessage } from "@/components/widget/error-message";
import { useGitOperations } from "@/hooks/use-git-operations";
import { usePreviewIndicator } from "@/hooks/use-preview-indicator";
import { cn } from "@/lib/utils";
import { RebuildOverlayPanel } from "@/components/rebuild-overlay-panel";
import { useRebuild } from "@/hooks/use-rebuild";
import { useSummary } from "@/hooks/use-summary";

/**
 * Main widget component that connects to Tauri backend.
 *
 * State is computed entirely on the client - the server just exposes
 * data endpoints (config, git status, etc.) without tracking UI state.
 */

export function DarwinWidget() {
  const store = useWidgetStore();
  const storeRef = useRef(store);
  storeRef.current = store;
  const step = computeCurrentStep(store);
  const { refreshGitStatus } = useGitOperations();
  const { updatePreviewIndicator } = usePreviewIndicator();
  const { handleRollback, handleDismiss } = useRebuild();
  const checkAndFetchSummary = useSummary().checkAndFetchSummary

  // Check if rebuild overlay should be shown
  const showRebuildOverlay =
    store.rebuild.isRunning || store.rebuild.success !== undefined;

  // =============================================================================
  // Global Widget Effects
  // =============================================================================

  // Load initial data once on mount
  useEffect(() => {
    const mounted = { current: true };

    (async () => {
      try {
        // Check permissions first (including FDA via native plugin)
        const permissionsState = await darwinAPI.permissions.checkAll();

        // Use native plugin to get accurate FDA status
        // Note: This may return false positives in dev mode (checks terminal's FDA, not app's)
        let fdaGranted = false;
        try {
          fdaGranted = await darwinAPI.permissions.checkFullDiskAccess();
        } catch (e) {
          // Plugin check failed, fall back to backend result
        }

        // Update FDA permission status based on native plugin result
        const fdaStatus = fdaGranted ? "granted" : "denied";
        const updatedPermissions = permissionsState.permissions.map((p) =>
          p.id === "full-disk"
            ? { ...p, status: fdaStatus as "granted" | "denied" }
            : p,
        );
        const allRequiredGranted = updatedPermissions
          .filter((p) => p.required)
          .every((p) => p.status === "granted");

        if (mounted.current) {
          storeRef.current.setPermissionsState({
            ...permissionsState,
            permissions: updatedPermissions,
            allRequiredGranted,
          });
          storeRef.current.setPermissionsChecked(true);
        }

        await loadConfig();
        await loadHosts();
        const gitStatus = await refreshGitStatus();
        await recoverFromGitState(gitStatus, mounted, updatePreviewIndicator);

        // Load preferences
      } catch (e: unknown) {
        if (mounted.current) {
          // Mark permissions as checked even if it failed
          storeRef.current.setPermissionsChecked(true);

          const errorMessage = (e as Error)?.message || String(e);
          const supressFlakeError =
            step === "setup" &&
            errorMessage.includes("Failed to list hosts: path");
          if (!supressFlakeError) {
            storeRef.current.setError(errorMessage);
          }
        }
      }
    })();

    return () => {
      mounted.current = false;
    };
  }, []);

  // Listen for git status changes from the backend watcher
  useEffect(() => {
    let isSubscribed = true;

    const gitStatusSub = ipcRenderer.on<{ status: GitStatus }>(
      "git:status-changed",
      (event) => {
        if (!isSubscribed) return;
        storeRef.current.setGitStatus(event.payload.status);
        checkAndFetchSummary();
      }
    );

    return () => {
      isSubscribed = false;
      gitStatusSub.then((unlisten) => unlisten());
    };
  }, []);

  // =============================================================================
  // Routing mechanism
  // =============================================================================

  const getActiveStepComponent = () => {
    switch (step) {
      case "permissions":
        return <PermissionsStep />;

      case "setup":
        return <SetupStep />;

      case "overview":
        return <OverviewStep />;

      case "commit":
        return <CommitStep />;

      case "evolving":
        return <EvolvingStep />;

      default:
        return <OverviewStep />;
    }
  };

  // =============================================================================
  // Render
  // =============================================================================

  return (
    <>
      <div className="flex h-full w-full flex-col bg-background/90 backdrop-blur-xl">
        <Header />
        <Stepper />

        {/* Main Content */}
        <div className="flex min-h-0 flex-1 flex-col overflow-auto">
          <div
            className={cn("flex-1 p-5", step !== "evolving" && "overflow-auto")}
          >
            <ErrorMessage />
            {showRebuildOverlay ? (
              <div className="flex h-full items-center justify-center">
                <div className="h-full w-full max-h-[600px] max-w-[800px]">
                  <RebuildOverlayPanel
                    isRunning={store.rebuild.isRunning}
                    lines={store.rebuild.lines}
                    rawLines={store.rebuild.rawLines}
                    success={store.rebuild.success}
                    errorType={store.rebuild.errorType}
                    errorMessage={store.rebuild.errorMessage}
                    onRollback={handleRollback}
                    onDismiss={handleDismiss}
                    onCancel={handleDismiss}
                  />
                </div>
              </div>
            ) : (
              getActiveStepComponent()
            )}
          </div>
        </div>

        <Console />
        <SettingsDialog />
      </div>
    </>
  );
}
