"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDarwinConfig } from "@/hooks/use-darwin-config";
import { useWidgetStore } from "@/stores/widget-store";
import { darwinAPI } from "@/tauri-api";
import { AlertCircle, GitCommit, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

interface BootstrapConfigProps {
  label: string;
  onSuccess?: () => void;
}

export function BootstrapConfig({ label, onSuccess }: BootstrapConfigProps) {
  const [hostname, setHostname] = useState("macbook");
  const [localError, setLocalError] = useState<string | null>(null);
  const { bootstrap, isBootstrapping } = useDarwinConfig();
  const configDir = useWidgetStore((state) => state.configDir);
  const gitStatus = useWidgetStore((state) => state.gitStatus);
  const [flakeExists, setFlakeExists] = useState(false);

  useEffect(() => {
    setLocalError(null);
    if (!configDir) {
      setFlakeExists(false);
      return;
    }
    darwinAPI.flake.existsAt(configDir).then(setFlakeExists).catch(() => setFlakeExists(false));
  }, [configDir]);

  const needsInitialCommit = flakeExists && (gitStatus === null || gitStatus.headCommitHash === "");

  const message = needsInitialCommit
    ? "flake.nix found but not committed — Nix needs a git commit to evaluate your flake"
    : "No nix-darwin configuration found in this directory";
  const buttonLabel = needsInitialCommit ? "Make initial commit" : "Create Default Configuration";
  const loadingLabel = needsInitialCommit ? "Committing..." : "Creating Configuration...";
  const helpText = needsInitialCommit
    ? "Stages all files and creates the first commit"
    : "This will create a basic nix-darwin flake in the directory";

  const handleBootstrap = async (): Promise<void> => {
    setLocalError(null);
    await bootstrap(needsInitialCommit ? "" : hostname);
    const storeError = useWidgetStore.getState().error;
    if (storeError) {
      setLocalError(storeError);
    } else {
      onSuccess?.();
    }
  };

  return (
    <div className="space-y-2">
      <label className="font-medium text-sm">{label}</label>
      <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
        <div className="flex items-start gap-2">
          <AlertCircle className="mt-0.5 h-4 w-4 text-muted-foreground" />
          <p className="text-muted-foreground text-sm">{message}</p>
        </div>

        <div className="space-y-3">
          {!needsInitialCommit && (
            <div className="space-y-2">
              <label htmlFor="hostname" className="text-sm">
                Host name
              </label>
              <Input
                id="hostname"
                type="text"
                value={hostname}
                onChange={(e) => setHostname(e.target.value)}
                placeholder="macbook"
                className="font-mono text-xs"
                disabled={isBootstrapping}
              />
              <p className="text-muted-foreground text-xs">
                This will be your darwinConfiguration name
              </p>
            </div>
          )}

          <Button
            onClick={handleBootstrap}
            className="w-full"
            data-testid="create-default-config-button"
            disabled={(!needsInitialCommit && !hostname.trim()) || isBootstrapping}
          >
            {isBootstrapping ? (
              <>
                <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-solid border-current border-r-transparent" />
                {loadingLabel}
              </>
            ) : needsInitialCommit ? (
              <>
                <GitCommit className="mr-2 h-4 w-4" />
                {buttonLabel}
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                {buttonLabel}
              </>
            )}
          </Button>
          {localError && <p className="text-rose-300 text-xs">{localError}</p>}
          <p className="text-muted-foreground text-xs">{helpText}</p>
        </div>
      </div>
    </div>
  );
}