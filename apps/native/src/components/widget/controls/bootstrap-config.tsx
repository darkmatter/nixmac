"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDarwinConfig } from "@/hooks/use-darwin-config";
import { useFlakeExists } from "@/hooks/use-flake-exists";
import { useThisHostname } from "@/hooks/use-this-hostname";
import { useViewModel } from "@nixmac/state";
import { useUiState } from "@nixmac/state";
import { AlertCircle, GitCommit, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

interface BootstrapConfigProps {
  label: string;
  onSuccess?: () => void;
  showLabel?: boolean;
  forceNeedsInitialCommit?: boolean;
}

const DEFAULT_HOSTNAME = "macbook";

export function BootstrapConfig({
  label,
  onSuccess,
  showLabel = true,
  forceNeedsInitialCommit = false,
}: BootstrapConfigProps) {
  const [hostname, setHostname] = useState(DEFAULT_HOSTNAME);
  const [localError, setLocalError] = useState<string | null>(null);
  const { bootstrap, isBootstrapping } = useDarwinConfig();
  const configDir = useViewModel((state) => state.preferences?.configDir ?? "");
  const gitStatus = useViewModel((state) => state.git);
  const flakeExists = useFlakeExists(configDir);

  const fetchedHost = useThisHostname();
  const hostnamePlaceholder = fetchedHost || DEFAULT_HOSTNAME;

  // Seed the editable host field from this Mac's hostname, unless the user
  // already changed it.
  useEffect(() => {
    setHostname((current) => (current === DEFAULT_HOSTNAME ? hostnamePlaceholder : current));
  }, [hostnamePlaceholder]);

  // Clear any prior bootstrap error when the target directory changes.
  useEffect(() => {
    setLocalError(null);
  }, [configDir]);

  const needsInitialCommit =
    forceNeedsInitialCommit ||
    (flakeExists === true && (gitStatus === null || gitStatus.headCommitHash === ""));

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
    const storeError = useUiState.getState().error;
    if (storeError) {
      setLocalError(storeError);
    } else {
      onSuccess?.();
    }
  };

  return (
    <div className="space-y-2">
      {showLabel && <label className="font-medium text-sm">{label}</label>}
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
                placeholder={hostnamePlaceholder}
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
