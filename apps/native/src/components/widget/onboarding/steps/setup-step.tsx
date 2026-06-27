"use client";

import type { ComponentType } from "react";
import { useEffect, useState } from "react";
import { GitHubLogoIcon } from "@radix-ui/react-icons";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  GitBranch,
  GitCommit,
  HardDrive,
  Link2,
  Loader2,
  Rocket,
  Server,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { StepShell } from "@/components/widget/onboarding/step-shell";
import { stepEyebrow } from "@/components/widget/onboarding/lib/onboarding";
import { GitHubSource } from "@/components/widget/onboarding/source/github-source";
import { LocalSource } from "@/components/widget/onboarding/source/local-source";
import { FlakeRefSource } from "@/components/widget/onboarding/source/flake-ref-source";
import { CreateSource } from "@/components/widget/onboarding/source/create-source";
import { useDarwinConfig } from "@/hooks/use-darwin-config";
import { tauriAPI } from "@/ipc/api";
import { useViewModel } from "@nixmac/state";

type Mode = "choose" | "import" | "create";
type Method = "github" | "local" | "ref";

type StepIcon = ComponentType<{ className?: string }>;

const METHODS: { id: Method; label: string; blurb: string; icon: StepIcon }[] = [
  {
    id: "github",
    label: "GitHub",
    blurb: "Pull your flake straight from a public repository. No local git required.",
    icon: GitHubLogoIcon,
  },
  {
    id: "local",
    label: "Local folder",
    blurb: "Point to a folder that already contains a flake.nix.",
    icon: HardDrive,
  },
  {
    id: "ref",
    label: "Flake reference",
    blurb: "Paste a github: ref or a local path, or import a .zip.",
    icon: Link2,
  },
];

function PathCard({
  icon: Icon,
  title,
  description,
  badge,
  onClick,
  testId,
}: {
  icon: StepIcon;
  title: string;
  description: string;
  badge?: string;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className="group flex flex-col rounded-xl border border-border bg-card p-5 text-left transition-colors hover:border-primary/50 hover:bg-accent"
    >
      <span className="flex items-center justify-between">
        <span
          className="flex size-10 items-center justify-center rounded-lg bg-muted text-foreground transition-colors group-hover:bg-primary group-hover:text-primary-foreground"
          aria-hidden="true"
        >
          <Icon className="size-5" />
        </span>
        {badge ? (
          <span className="rounded-full bg-success/15 px-2 py-0.5 font-semibold text-[11px] text-success">
            {badge}
          </span>
        ) : null}
      </span>
      <span className="mt-4 flex items-center gap-1 font-semibold text-base">
        {title}
        <ChevronRight
          className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </span>
      <span className="mt-1 text-pretty text-muted-foreground text-sm leading-relaxed">
        {description}
      </span>
    </button>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-4 inline-flex items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      Back
    </button>
  );
}

export function SetupStep() {
  const configDir = useViewModel((s) => s.preferences?.configDir ?? "");
  const hosts = useViewModel((s) => s.hosts);
  const savedHost = useViewModel((s) => s.preferences?.hostAttr ?? "");
  const gitStatus = useViewModel((s) => s.git);
  const { saveHost, bootstrap, isBootstrapping } = useDarwinConfig();

  const [changing, setChanging] = useState(false);
  const [mode, setMode] = useState<Mode>("choose");
  const [method, setMethod] = useState<Method>("github");
  const [selectedHost, setSelectedHost] = useState("");
  const [flakeExists, setFlakeExists] = useState<boolean | null>(null);
  const [thisHostname, setThisHostname] = useState("this-mac");

  const hasConfigDir = Boolean(configDir);
  const showSources = !hasConfigDir || changing;

  // Once a config dir lands, leave the "change source" view.
  useEffect(() => {
    if (configDir) setChanging(false);
  }, [configDir]);

  // Does the chosen directory already contain a flake.nix?
  useEffect(() => {
    let cancelled = false;
    if (!configDir) {
      setFlakeExists(false);
      return;
    }
    setFlakeExists(null);
    // deprecated(orpc): replace with client/orpc from @/lib/orpc
    tauriAPI.flake
      .existsAt(configDir)
      .then((exists) => {
        if (!cancelled) setFlakeExists(exists);
      })
      .catch(() => {
        if (!cancelled) setFlakeExists(false);
      });
    return () => {
      cancelled = true;
    };
  }, [configDir]);

  useEffect(() => {
    // deprecated(orpc): replace with client/orpc from @/lib/orpc
    tauriAPI.config
      .getThisHostname()
      .then((name) => {
        if (name.trim()) setThisHostname(name.trim());
      })
      .catch(() => {});
  }, []);

  // ---- No config dir yet: fork between existing vs. new ----
  if (showSources) {
    if (mode === "choose") {
      return (
        <StepShell
          eyebrow={stepEyebrow("setup")}
          title="Set up your configuration"
          description="nixmac manages your Mac through a Nix flake. Do you already have one, or are you starting fresh?"
        >
          {changing ? <BackLink onClick={() => setChanging(false)} /> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <PathCard
              icon={GitBranch}
              title="I already have a flake"
              description="Import an existing nix-darwin configuration from GitHub, a local folder, or a flake reference."
              onClick={() => setMode("import")}
            />
            <PathCard
              icon={Rocket}
              title="Start from scratch"
              description="New to nix-darwin? We'll generate a clean starter configuration tailored to this Mac."
              badge="First time here"
              onClick={() => setMode("create")}
              testId="onboarding-start-from-scratch"
            />
          </div>
        </StepShell>
      );
    }

    if (mode === "create") {
      return (
        <StepShell
          eyebrow={stepEyebrow("setup")}
          title="Create a starter configuration"
          description="Name this Mac and we'll scaffold a working flake for it. You can customize everything afterward."
        >
          <BackLink onClick={() => setMode("choose")} />
          <CreateSource onCreated={() => setChanging(false)} />
        </StepShell>
      );
    }

    // mode === "import"
    return (
      <StepShell
        eyebrow={stepEyebrow("setup")}
        title="Import your configuration"
        description="Import an existing flake from a GitHub repo, a local folder, or a flake reference — whichever matches your setup."
      >
        <BackLink onClick={() => setMode("choose")} />

        {method === "github" ? (
          <div className="flex flex-col gap-5">
            <GitHubSource onImported={() => setChanging(false)} />
            <div>
              <p className="mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
                Or import another way
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {METHODS.filter((m) => m.id !== "github").map((m) => {
                  const Icon = m.icon;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setMethod(m.id)}
                      className="group flex items-start gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-primary/50 hover:bg-accent"
                    >
                      <span
                        className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors group-hover:text-foreground"
                        aria-hidden="true"
                      >
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block font-medium text-sm">{m.label}</span>
                        <span className="block text-pretty text-muted-foreground text-xs leading-relaxed">
                          {m.blurb}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <button
              type="button"
              onClick={() => setMethod("github")}
              className="inline-flex items-center gap-1.5 self-start text-muted-foreground text-sm transition-colors hover:text-foreground"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              Back to GitHub
            </button>
            {method === "local" ? <LocalSource onImported={() => setChanging(false)} /> : null}
            {method === "ref" ? <FlakeRefSource onImported={() => setChanging(false)} /> : null}
          </div>
        )}
      </StepShell>
    );
  }

  // ---- Config dir chosen: confirm host ----
  const hasHosts = hosts.length > 0;
  const effectiveHost = selectedHost || savedHost;
  const needsInitialCommit =
    flakeExists === true && (gitStatus === null || gitStatus.headCommitHash === "");
  const checkingFlake = flakeExists === null;

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
        <button
          type="button"
          onClick={() => {
            setChanging(true);
            setMode("choose");
          }}
          className="shrink-0 font-medium text-primary text-xs hover:underline"
        >
          Change
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
                  <GitCommit className="size-4" aria-hidden="true" />
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
            <Button onClick={() => saveHost(effectiveHost)} disabled={!effectiveHost}>
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
                  <Sparkles className="size-4" aria-hidden="true" />
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
