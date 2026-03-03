"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useNixInstall } from "@/hooks/use-nix-install";
import { useWidgetStore } from "@/stores/widget-store";
import { CheckCircle2, Download, ExternalLink, Loader2, Terminal } from "lucide-react";
import { useEffect } from "react";

type NixSetupState = "idle" | "installing" | "success" | "error";

function getNixSetupState(store: {
  nixInstalled: boolean | null;
  nixInstalling: boolean;
  darwinRebuildAvailable: boolean | null;
  error: string | null;
}): NixSetupState {
  if (store.nixInstalled === true && store.darwinRebuildAvailable === true) return "success";
  if (store.nixInstalling) return "installing";
  if (store.error) return "error";
  return "idle";
}

export function NixSetupStep() {
  const nixInstalled = useWidgetStore((s) => s.nixInstalled);
  const nixInstalling = useWidgetStore((s) => s.nixInstalling);
  const darwinRebuildAvailable = useWidgetStore((s) => s.darwinRebuildAvailable);
  const error = useWidgetStore((s) => s.error);
  const { checkNix, installNix } = useNixInstall();

  const state = getNixSetupState({ nixInstalled, nixInstalling, darwinRebuildAvailable, error });

  useEffect(() => {
    if (nixInstalled === null && !nixInstalling) {
      checkNix();
    }
  }, [nixInstalled, nixInstalling, checkNix]);

  // Auto-trigger install flow when nix is installed but darwin-rebuild is not.
  // The backend handles opening Terminal for just the darwin-rebuild prefetch.
  useEffect(() => {
    if (nixInstalled === true && darwinRebuildAvailable === false && !nixInstalling && !error) {
      installNix();
    }
  }, [nixInstalled, darwinRebuildAvailable, nixInstalling, error, installNix]);

  return (
    <div className="flex h-full flex-col items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Terminal className="h-6 w-6 text-primary" />
          </div>
          <h2 className="font-semibold text-foreground text-lg">System Setup</h2>
          <p className="mt-1 text-muted-foreground text-sm">
            Nix and nix-darwin are required to manage your system configuration
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
                      : "Nix is not installed on this system. Click below to install Nix and nix-darwin."}
                  </p>
                  <Button onClick={installNix} className="w-full">
                    <Download className="mr-2 h-4 w-4" />
                    {nixInstalled ? "Set up nix-darwin" : "Install Nix & nix-darwin"}
                  </Button>
                  <p className="text-center text-muted-foreground text-xs">
                    This will open Terminal to run the setup.
                  </p>
                </>
              )}
            </div>
          )}

          {state === "installing" && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                {nixInstalled ? "Setting up nix-darwin..." : "Installing Nix & nix-darwin..."}
              </div>
              <p className="text-center text-muted-foreground text-xs">
                Follow the instructions in the Terminal window. This page will update automatically.
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
              <div className="space-y-2">
                <p className="text-muted-foreground text-sm">
                  To set up manually, run in Terminal:
                </p>
                <code className="block rounded border border-border bg-background p-2 font-mono text-xs select-all">
                  curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix
                  | sh -s -- install
                </code>
              </div>
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
