"use client";

import { Button } from "@/components/ui/button";
import { stepEyebrow } from "@/components/widget/onboarding/lib/onboarding";
import { StepShell } from "@/components/widget/onboarding/step-shell";
import { useDarwinConfig } from "@/hooks/use-darwin-config";
import { useFlakeExists } from "@/hooks/use-flake-exists";
import { useThisHostname } from "@/hooks/use-this-hostname";
import { onboardingActions, useViewModel } from "@nixmac/state";
import {
  Check,
  ChevronDown,
  GitCommit,
  Loader2,
  Server,
  Sparkles,
} from "lucide-react";
import { useState } from "react";

/**
 * Step 4: pick the `darwinConfiguration` host that matches this Mac, given a
 * config directory chosen in the previous step. Also covers the "no hosts /
 * uncommitted flake" recovery paths.
 */
export function SetupStep() {
  const configDir = useViewModel((s) => s.preferences?.configDir ?? "");
  const hosts = useViewModel((s) => s.hosts);
  const savedHost = useViewModel((s) => s.preferences?.hostAttr ?? "");
  const gitStatus = useViewModel((s) => s.git);
  const { saveHost, bootstrap, isBootstrapping } = useDarwinConfig();

  const [selectedHost, setSelectedHost] = useState("");
  const flakeExists = useFlakeExists(configDir);
  const thisHostname = useThisHostname() || "this-mac";

  const hasHosts = hosts.length > 0;
  const effectiveHost = selectedHost || savedHost;
  const needsInitialCommit =
    flakeExists === true && (gitStatus === null || gitStatus.headCommitHash === "");
  const checkingFlake = flakeExists === null;

  async function confirmHost() {
    await saveHost(effectiveHost);
    // Back-navigation pins viewingStep to "setup" while furthestStep is already
    // ahead. Saving the host does not move furthestStep, so clear the override.
    onboardingActions.setViewingStep(null);
  }

  return (
    <StepShell
      eyebrow={stepEyebrow("setup")}
      title="Choose your machine"
      description="Great — your flake is imported. Now pick which machine entry matches this Mac."
    >
      {/* Imported source summary */}
      <div className="mb-4 flex items-center gap-3 rounded-xl border border-success/30 bg-success/5 p-3">
        <span
          className="flex size-9 items-center justify-center rounded-lg bg-success/15 text-success"
          aria-hidden="true"
        >
          <Check className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 font-medium text-sm">
            <Server className="size-3.5 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">Configuration directory</span>
          </p>
          <p className="truncate font-mono text-muted-foreground text-xs">{configDir}</p>
        </div>
      </div>

      {/* Host selection */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-3">
          <span
            className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground"
            aria-hidden="true"
          >
            <Server className="size-5" />
          </span>
          <div>
            <p className="font-medium text-sm">Machine configuration</p>
            <p className="text-muted-foreground text-xs">
              {hasHosts ? "Pick the host that matches this Mac" : "No hosts found in this flake"}
            </p>
          </div>
        </div>

        {checkingFlake ? (
          <div className="mt-4 flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Inspecting flake…
          </div>
        ) : needsInitialCommit ? (
          <div className="mt-4 rounded-lg border border-warning/30 bg-warning/5 p-4">
            <p className="text-pretty text-muted-foreground text-sm">
              <span className="font-medium text-foreground">
                flake.nix found but not committed.
              </span>{" "}
              Nix needs a git commit to evaluate your flake.
            </p>
            <Button
              className="mt-3"
              variant="secondary"
              onClick={() => bootstrap("")}
              disabled={isBootstrapping}
            >
              {isBootstrapping ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Committing…
                </>
              ) : (
                <>
                  <GitCommit className="size-4" />
                  Make initial commit
                </>
              )}
            </Button>
          </div>
        ) : hasHosts ? (
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <label htmlFor="host-select" className="sr-only">
                Select a host
              </label>
              <select
                id="host-select"
                value={effectiveHost}
                onChange={(e) => setSelectedHost(e.target.value)}
                className="w-full appearance-none rounded-lg border border-input bg-background px-3 py-2 pr-9 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="" disabled>
                  Select a host…
                </option>
                {hosts.map((host) => (
                  <option key={host} value={host}>
                    darwinConfigurations.{host}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
            </div>
            <Button onClick={() => void confirmHost()} disabled={!effectiveHost}>
              Use this host
            </Button>
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-dashed border-border bg-background p-4 text-center">
            <p className="text-muted-foreground text-sm">
              This flake has no <code className="font-mono">darwinConfigurations</code> yet. nixmac
              can scaffold a starter config for this Mac.
            </p>
            <Button
              className="mt-3"
              variant="secondary"
              onClick={() => bootstrap(thisHostname)}
              disabled={isBootstrapping}
            >
              {isBootstrapping ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Scaffolding…
                </>
              ) : (
                <>
                  <Sparkles className="size-4" />
                  Create starter config
                </>
              )}
            </Button>
          </div>
        )}
      </div>
    </StepShell>
  );
}
