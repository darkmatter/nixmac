"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useNixInstall } from "@/hooks/use-nix-install";
import { useWidgetStore } from "@/stores/widget-store";
import { open } from "@tauri-apps/plugin-shell";
import { CheckCircle2, ExternalLink, Loader2, Package, RefreshCw } from "lucide-react";
import { useEffect } from "react";

type NixSetupState = "checking" | "missing-nix" | "missing-darwin-rebuild" | "success";

function getNixSetupState(store: {
  nixInstalled: boolean | null;
  darwinRebuildAvailable: boolean | null;
}): NixSetupState {
  if (store.nixInstalled === true && store.darwinRebuildAvailable === true) return "success";
  if (store.nixInstalled === null) return "checking";
  if (store.nixInstalled !== true) return "missing-nix";
  return "missing-darwin-rebuild";
}

const NIX_INSTALLERS = [
  {
    href: "https://determinate.systems/nix-installer/",
    title: "Determinate Systems installer",
    description: "Recommended for most Macs: a polished installer with a clear uninstall path.",
  },
  {
    href: "https://nixos.org/download/",
    title: "Official NixOS installer",
    description: "Best if you want the upstream Nix project path and are comfortable following terminal setup steps.",
  },
] as const;

const NIX_DARWIN_URL = "https://github.com/LnL7/nix-darwin";

async function openExternalUrl(url: string) {
  try {
    await open(url);
  } catch (error) {
    console.warn("Failed to open external URL with Tauri shell; falling back to browser window.", error);
    window.open(url, "_blank");
  }
}

function ExternalSetupLink({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => {
        event.preventDefault();
        void openExternalUrl(href);
      }}
      className="flex items-start justify-between gap-3 rounded-md border border-border p-3 text-left transition-colors hover:bg-muted/50"
    >
      <span>
        <span className="block font-medium text-sm">{title}</span>
        <span className="mt-1 block text-muted-foreground text-xs leading-5">{description}</span>
      </span>
      <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
    </a>
  );
}

export function NixSetupStep() {
  const nixInstalled = useWidgetStore((s) => s.nixInstalled);
  const darwinRebuildAvailable = useWidgetStore((s) => s.darwinRebuildAvailable);
  const { checkNix } = useNixInstall();

  const state = getNixSetupState({ nixInstalled, darwinRebuildAvailable });

  useEffect(() => {
    if (nixInstalled === null) {
      checkNix();
    }
  }, [nixInstalled, checkNix]);

  return (
    <div className="flex h-full flex-col items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Package className="h-6 w-6 text-primary" />
          </div>
          <h2 className="font-semibold text-foreground text-lg">System Setup</h2>
          <p className="mt-1 text-muted-foreground text-sm">
            nixmac needs Nix and nix-darwin before it can manage this Mac.
          </p>
        </div>

        <Card className="mb-4 p-4">
          {state === "checking" && (
            <div className="flex items-center justify-center gap-2 py-4 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking system...
            </div>
          )}

          {state === "missing-nix" && (
            <div className="space-y-4">
              <p className="text-muted-foreground text-sm leading-6">
                Nix is the package manager nixmac uses to build and apply repeatable Mac
                configuration changes. Install Nix first, then return here so nixmac can check
                your system again.
              </p>
              <div className="space-y-2">
                {NIX_INSTALLERS.map((installer) => (
                  <ExternalSetupLink key={installer.href} {...installer} />
                ))}
              </div>
              <Button onClick={checkNix} variant="outline" className="w-full">
                <RefreshCw className="h-4 w-4" />
                I've installed Nix - check again
              </Button>
            </div>
          )}

          {state === "missing-darwin-rebuild" && (
            <div className="space-y-4">
              <p className="text-muted-foreground text-sm leading-6">
                Nix is installed, but nixmac cannot find darwin-rebuild. Install nix-darwin so
                nixmac can build and apply macOS configuration changes, then check again.
              </p>
              <ExternalSetupLink
                href={NIX_DARWIN_URL}
                title="nix-darwin instructions"
                description="Follow the upstream setup guide to make darwin-rebuild available on this Mac."
              />
              <Button onClick={checkNix} variant="outline" className="w-full">
                <RefreshCw className="h-4 w-4" />
                I've installed nix-darwin - check again
              </Button>
            </div>
          )}

          {state === "success" && (
            <div className="flex items-center justify-center gap-2 py-4 text-sm text-green-600 dark:text-green-400">
              <CheckCircle2 className="h-5 w-5" />
              Nix & nix-darwin are installed
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
