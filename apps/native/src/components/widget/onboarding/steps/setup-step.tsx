"use client";

import { Button } from "@/components/ui/button";
import { stepEyebrow } from "@/components/widget/onboarding/lib/onboarding";
import { StepShell } from "@/components/widget/onboarding/step-shell";
import { applyImportResult, useDarwinConfig } from "@/hooks/use-darwin-config";
import { useFlakeExists } from "@/hooks/use-flake-exists";
import { useThisHostname } from "@/hooks/use-this-hostname";
import { client, orpc } from "@/lib/orpc";
import { refreshHostsSnapshot } from "@/viewmodel/preferences";
import { onboardingActions, useViewModel } from "@nixmac/state";
import { useQuery } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  FolderGit2,
  GitCommit,
  Loader2,
  Server,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";

/**
 * Step 4: pick the `darwinConfiguration` host that matches this Mac, given a
 * config directory chosen in the previous step. Also covers the recovery
 * paths: no flake.nix at the config dir (with nested-flake quick fixes), an
 * uncommitted flake, and a flake without darwinConfigurations.
 */

export function SetupStep() {
  const configDir = useViewModel((s) => s.preferences?.configDir ?? "");
  const hosts = useViewModel((s) => s.hosts);
  const savedHost = useViewModel((s) => s.preferences?.hostAttr ?? "");
  const gitStatus = useViewModel((s) => s.git);
  const { saveHost, bootstrap, isBootstrapping } = useDarwinConfig();

  const [selectedHost, setSelectedHost] = useState("");
  const [savingHost, setSavingHost] = useState(false);
  const [fixingFlakeDir, setFixingFlakeDir] = useState(false);
  const [fixError, setFixError] = useState<string | null>(null);
  const flakeExists = useFlakeExists(configDir);
  const thisHostname = useThisHostname();

  // Recovery for a config dir with no flake at its root (e.g. imported before
  // nested-flake support): nested candidates become one-click fixes.
  const nestedFlakesQuery = useQuery(
    orpc.flake.locate.queryOptions({
      input: { dir: configDir },
      enabled: flakeExists === false && configDir.length > 0,
    }),
  );
  const nestedFlakeDirs = (nestedFlakesQuery.data ?? []).filter((dir) => dir !== "");

  const hasHosts = hosts.length > 0;
  // Pre-select the host matching this machine so the chooser never starts empty
  // when the flake already has an entry for it.
  const hostMatchingThisMac = hosts.includes(thisHostname) ? thisHostname : "";
  const effectiveHost = selectedHost || savedHost || hostMatchingThisMac;
  const needsInitialCommit =
    flakeExists === true && (gitStatus === null || gitStatus.headCommitHash === "");
  const checkingFlake = flakeExists === null;

  function changeSource() {
    onboardingActions.setViewingStep("config-dir");
  }

  async function adoptNestedFlake(flakeDir: string) {
    setFixError(null);
    setFixingFlakeDir(true);
    try {
      const result = await client.config.finalizeImport({ cloneDir: configDir, flakeDir });
      await applyImportResult(result);
      await refreshHostsSnapshot({ force: true });
    } catch (e: unknown) {
      setFixError(e instanceof Error ? e.message : String(e));
    } finally {
      setFixingFlakeDir(false);
    }
  }

  async function confirmHost() {
    if (!effectiveHost) return;
    setSavingHost(true);
    try {
      await saveHost(effectiveHost);
      await refreshHostsSnapshot({ force: true });
      // Back-navigation pins viewingStep to "setup" while furthestStep is already
      // ahead. Saving the host does not move furthestStep, so clear the override.
      onboardingActions.setViewingStep(null);
    } finally {
      setSavingHost(false);
    }
  }

  // The step claims success only when a flake is actually there.
  const description = checkingFlake
    ? "Checking your configuration directory…"
    : flakeExists
      ? "Great — your flake is imported. Now pick which machine entry matches this Mac."
      : "Your configuration directory doesn't contain a flake.nix yet.";

  return (
    <StepShell eyebrow={stepEyebrow("setup")} title="Choose your machine" description={description}>
      {/* Config directory summary; success styling only with a real flake. */}
      <div
        className={
          flakeExists === false
            ? "mb-4 flex items-center gap-3 rounded-xl border border-warning/30 bg-warning/5 p-3"
            : "mb-4 flex items-center gap-3 rounded-xl border border-success/30 bg-success/5 p-3"
        }
      >
        <span
          className={
            flakeExists === false
              ? "flex size-9 items-center justify-center rounded-lg bg-warning/15 text-warning"
              : "flex size-9 items-center justify-center rounded-lg bg-success/15 text-success"
          }
          aria-hidden="true"
        >
          {flakeExists === false ? <TriangleAlert className="size-5" /> : <Check className="size-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 font-medium text-sm">
            <Server className="size-3.5 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">Configuration directory</span>
          </p>
          <p className="truncate font-mono text-muted-foreground text-xs">{configDir}</p>
        </div>
        <button
          type="button"
          onClick={changeSource}
          className="shrink-0 text-muted-foreground text-xs transition-colors hover:text-foreground hover:underline"
        >
          Change source
        </button>
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
              {flakeExists === false
                ? "No flake.nix found in this directory"
                : hasHosts
                  ? "Pick the host that matches this Mac"
                  : "No hosts found in this flake"}
            </p>
          </div>
        </div>

        {checkingFlake ? (
          <div className="mt-4 flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Inspecting flake…
          </div>
        ) : flakeExists === false ? (
          <div className="mt-4 rounded-lg border border-warning/30 bg-warning/5 p-4">
            <p className="text-pretty text-muted-foreground text-sm">
              <span className="font-medium text-foreground">
                There is no <code className="font-mono">flake.nix</code> in this directory.
              </span>{" "}
              {nestedFlakeDirs.length > 0
                ? "We did find one deeper inside — use it, or point nixmac at a different source."
                : "Point nixmac at a folder or repository that contains your flake."}
            </p>
            {nestedFlakeDirs.length > 0 ? (
              <ul className="mt-3 flex flex-col gap-2" aria-label="Flakes found inside this directory">
                {nestedFlakeDirs.map((dir) => (
                  <li key={dir}>
                    <Button
                      variant="secondary"
                      onClick={() => void adoptNestedFlake(dir)}
                      disabled={fixingFlakeDir}
                      data-testid="use-nested-flake-button"
                    >
                      {fixingFlakeDir ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <FolderGit2 className="size-4" aria-hidden="true" />
                      )}
                      Use flake at <code className="font-mono">{dir}</code>
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
            <Button className="mt-3" variant="outline" onClick={changeSource}>
              Change source
            </Button>
            {fixError ? <p className="mt-2 text-destructive text-xs">{fixError}</p> : null}
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
          <div className="mt-4">
            <div className="flex flex-col gap-3 sm:flex-row">
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
                      {host}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
              </div>
              <Button onClick={() => void confirmHost()} disabled={!effectiveHost || savingHost}>
                {savingHost ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    Saving…
                  </>
                ) : (
                  "Use this host"
                )}
              </Button>
            </div>
            <p className="mt-2 text-muted-foreground text-xs">
              These are the <code className="font-mono">darwinConfigurations</code> entries in your
              flake.
            </p>
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
              onClick={() => bootstrap(thisHostname || "this-mac")}
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
