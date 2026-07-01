"use client";

import { stepEyebrow } from "@/components/widget/onboarding/lib/onboarding";
import { CreateSource } from "@/components/widget/onboarding/source/create-source";
import { FlakeRefSource } from "@/components/widget/onboarding/source/flake-ref-source";
import { GitHubSource } from "@/components/widget/onboarding/source/github-source";
import { LocalSource } from "@/components/widget/onboarding/source/local-source";
import { StepShell } from "@/components/widget/onboarding/step-shell";
import { useViewModel } from "@nixmac/state";
import { GitHubLogoIcon } from "@radix-ui/react-icons";
import {
  ArrowLeft,
  ChevronRight,
  GitBranch,
  HardDrive,
  Link2,
  Rocket,
} from "lucide-react";
import type { ComponentType } from "react";
import { useEffect, useState } from "react";

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

/**
 * Step 3: choose where nixmac reads its configuration from. Covers the
 * import/create fork (GitHub, local folder, flake ref, or scaffold a new one).
 * Host selection lives in the next step (`setup`).
 */
export function ConfigDirStep() {
  const configDir = useViewModel((s) => s.preferences?.configDir ?? "");

  const [changing, setChanging] = useState(false);
  const [mode, setMode] = useState<Mode>("choose");
  const [method, setMethod] = useState<Method>("github");

  const hasConfigDir = Boolean(configDir);
  const showSources = !hasConfigDir || changing;

  // Once a config dir lands, leave the "change source" view.
  useEffect(() => {
    if (configDir) setChanging(false);
  }, [configDir]);

  if (!showSources) {
    // Nothing to render here for the gated state — the host-selection step
    // (`setup`) takes over once a config dir is chosen. This branch is
    // unreachable while the gate machine is consistent, but defensive.
    return null;
  }

  if (mode === "choose") {
    return (
      <StepShell
        eyebrow={stepEyebrow("config-dir")}
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
        eyebrow={stepEyebrow("config-dir")}
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
      eyebrow={stepEyebrow("config-dir")}
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
