"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useNixInstall } from "@/hooks/use-nix-install";
import { useWidgetStore } from "@/stores/widget-store";
import { CheckCircle2, Download, ExternalLink, Loader2, Package } from "lucide-react";
import { useEffect } from "react";

type NixSetupState = "idle" | "downloading" | "waiting-for-installer" | "prefetching" | "success" | "error";

function getNixSetupState(store: {
  nixInstalled: boolean | null;
  nixInstalling: boolean;
  nixInstallPhase: "downloading" | "waiting-for-installer" | "prefetching" | null;
  darwinRebuildAvailable: boolean | null;
  error: string | null;
}): NixSetupState {
  if (store.nixInstalled === true && store.darwinRebuildAvailable === true) return "success";
  if (store.error) return "error";
  if (store.nixInstallPhase === "downloading") return "downloading";
  if (store.nixInstallPhase === "waiting-for-installer") return "waiting-for-installer";
  if (store.nixInstallPhase === "prefetching" || store.nixInstalling) return "prefetching";
  return "idle";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function NixSetupStep() {
  const nixInstalled = useWidgetStore((s) => s.nixInstalled);
  const nixInstalling = useWidgetStore((s) => s.nixInstalling);
  const nixInstallPhase = useWidgetStore((s) => s.nixInstallPhase);
  const nixDownloadProgress = useWidgetStore((s) => s.nixDownloadProgress);
  const darwinRebuildAvailable = useWidgetStore((s) => s.darwinRebuildAvailable);
  const error = useWidgetStore((s) => s.error);
  const { checkNix, installNix } = useNixInstall();

  const state = getNixSetupState({ nixInstalled, nixInstalling, nixInstallPhase, darwinRebuildAvailable, error });

  useEffect(() => {
    if (nixInstalled === null && !nixInstalling) {
      checkNix();
    }
  }, [nixInstalled, nixInstalling, checkNix]);

  // Auto-trigger install flow when nix is installed but darwin-rebuild is not.
  // The backend handles running the prefetch directly (no Terminal).
  useEffect(() => {
    if (nixInstalled === true && darwinRebuildAvailable === false && !nixInstalling && !error) {
      installNix();
    }
  }, [nixInstalled, darwinRebuildAvailable, nixInstalling, error, installNix]);

  // Open settings dialog during install so users can configure API keys while waiting.
  const isInstalling = state === "downloading" || state === "waiting-for-installer" || state === "prefetching";
  useEffect(() => {
    if (!isInstalling) return;
    const timer = setTimeout(() => {
      useWidgetStore.getState().setSettingsOpen(true);
    }, 5000);
    return () => clearTimeout(timer);
  }, [isInstalling]);

  const downloadPercent =
    nixDownloadProgress && nixDownloadProgress.total > 0
      ? Math.round((nixDownloadProgress.downloaded / nixDownloadProgress.total) * 100)
      : 0;

  return (
    <div className="flex h-full flex-col items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 opacity-0">
            <Package className="h-6 w-6 text-primary" />
          </div>
          <h2 className="font-semibold text-foreground text-lg">System Setup</h2>
          <p className="mt-1 text-muted-foreground text-sm">
            This app needs to install a few things to get started. While you wait, feel free to set up your AI provider and preferences using the gear icon above.
          </p>
        </div>

        <Card className="mb-4 p-4">
          {state === "idle" && (
            <div className="space-y-4">
              {nixInstalled === null ? (
                <div className="flex items-center justify-center gap-2 py-4 text-muted-foreground text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Checking system...
                </div>
              ) : (
                <>
                  <p className="text-muted-foreground text-sm">
                    {nixInstalled
                      ? "nix-darwin needs to be set up. Click below to continue."
                      : "Nix is not installed on this system. Click below to install it using the standard macOS installer."}
                  </p>
                  <Button onClick={installNix} className="w-full">
                    <Download className="mr-2 h-4 w-4" />
                    {nixInstalled ? "Set up nix-darwin" : "Install Nix"}
                  </Button>
                </>
              )}
            </div>
          )}

          {state === "downloading" && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Downloading installer...
              </div>
              {nixDownloadProgress && nixDownloadProgress.total > 0 && (
                <div className="space-y-1">
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-200"
                      style={{ width: `${downloadPercent}%` }}
                    />
                  </div>
                  <p className="text-right text-muted-foreground text-xs">
                    {formatBytes(nixDownloadProgress.downloaded)} / {formatBytes(nixDownloadProgress.total)}
                  </p>
                </div>
              )}
            </div>
          )}

          {state === "waiting-for-installer" && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Waiting for installation to complete...
              </div>
              <p className="text-center text-muted-foreground text-xs">
                Follow the instructions in the Installer window. This page will update automatically.
              </p>
            </div>
          )}

          {state === "prefetching" && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Preparing nix-darwin...
              </div>
              <p className="text-center text-muted-foreground text-xs">
                This may take a few minutes on first run.
              </p>
            </div>
          )}

          {state === "success" && (
            <div className="flex items-center justify-center gap-2 py-4 text-sm text-green-600 dark:text-green-400">
              <CheckCircle2 className="h-5 w-5" />
              Nix & nix-darwin are installed
            </div>
          )}

          {state === "error" && (
            <div className="space-y-4">
              <p className="text-destructive text-sm">{error}</p>
              <div className="flex gap-2">
                <Button onClick={installNix} variant="default" className="flex-1">
                  Try Again
                </Button>
                <Button onClick={checkNix} variant="outline" className="flex-1">
                  Check Again
                </Button>
              </div>
              <a
                href="https://determinate.systems/nix-installer/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-1 text-muted-foreground text-xs hover:text-foreground"
              >
                <ExternalLink className="h-3 w-3" />
                Determinate Systems Installer
              </a>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
