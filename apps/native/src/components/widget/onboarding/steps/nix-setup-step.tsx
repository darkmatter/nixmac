"use client";

import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-shell";
import { ArrowUpRight, Check, CircleAlert, Loader2, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StepShell } from "@/components/widget/onboarding/step-shell";
import { stepEyebrow } from "@/components/widget/onboarding/lib/onboarding";
import { useNixInstall } from "@/hooks/use-nix-install";
import { useViewModel } from "@nixmac/state";
import { cn } from "@/lib/utils";

const NIX_INSTALLERS = [
  {
    href: "https://determinate.systems/nix-installer/",
    title: "Install Nix",
    subtitle: "Determinate Systems installer (recommended)",
  },
] as const;

const NIX_DARWIN_URL = "https://github.com/nix-darwin/nix-darwin";

async function openExternalUrl(url: string) {
  try {
    await open(url);
  } catch (error) {
    console.warn(
      "Failed to open external URL with Tauri shell; falling back to window.open.",
      error,
    );
    window.open(url, "_blank");
  }
}

type CheckStatus = "ok" | "missing" | "unknown" | "checking";

export function NixSetupStep() {
  const nixInstalled = useViewModel((s) => s.nixInstall?.installed ?? null);
  const darwinRebuildAvailable = useViewModel((s) => s.nixInstall?.darwinRebuildAvailable ?? null);
  const { checkNix } = useNixInstall();
  const [isChecking, setIsChecking] = useState(false);

  const probing = nixInstalled === null;

  useEffect(() => {
    if (nixInstalled === null) checkNix();
  }, [nixInstalled, checkNix]);

  async function recheck() {
    setIsChecking(true);
    try {
      await checkNix();
    } finally {
      setIsChecking(false);
    }
  }

  function statusFor(key: "nix" | "darwin"): CheckStatus {
    if (isChecking || probing) return "checking";
    if (key === "nix") return nixInstalled === true ? "ok" : "missing";
    if (nixInstalled !== true) return "unknown";
    return darwinRebuildAvailable === true ? "ok" : "missing";
  }

  const CHECKS: { key: "nix" | "darwin"; label: string; hint: string }[] = [
    { key: "nix", label: "Nix package manager", hint: "The nix binary on your PATH" },
    {
      key: "darwin",
      label: "nix-darwin (darwin-rebuild)",
      hint: "Applies your system configuration",
    },
  ];

  return (
    <StepShell
      eyebrow={stepEyebrow("nix-setup")}
      title="Install Nix & nix-darwin"
      description="nixmac needs Nix and nix-darwin installed before it can manage this Mac. Installation happens in your terminal — follow the links below, then re-check."
    >
      <div className="rounded-xl border border-border bg-card">
        <div className="flex flex-col gap-3 border-border border-b p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 font-medium text-sm">
            <Terminal className="size-4 text-muted-foreground" aria-hidden="true" />
            System check
          </div>
          <Button size="sm" variant="secondary" onClick={recheck} disabled={isChecking}>
            {isChecking ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Checking…
              </>
            ) : (
              "Check again"
            )}
          </Button>
        </div>

        <ul className="divide-y divide-border">
          {CHECKS.map((check) => {
            const status = statusFor(check.key);
            return (
              <li key={check.key} className="flex items-center gap-3 p-4">
                <span
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-full",
                    status === "ok" && "bg-success/15 text-success",
                    status === "missing" && "bg-destructive/15 text-destructive",
                    (status === "unknown" || status === "checking") &&
                      "bg-muted text-muted-foreground",
                  )}
                  aria-hidden="true"
                >
                  {status === "ok" ? (
                    <Check className="size-4" />
                  ) : status === "missing" ? (
                    <CircleAlert className="size-4" />
                  ) : status === "checking" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <span className="size-1.5 rounded-full bg-current" />
                  )}
                </span>
                <div className="min-w-0">
                  <p className="font-medium text-sm">{check.label}</p>
                  <p className="truncate text-muted-foreground text-xs">
                    {status === "ok"
                      ? "Detected and ready"
                      : status === "missing"
                        ? "Not found — install it below"
                        : check.hint}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {NIX_INSTALLERS.map((installer, i) => (
          <InstallLink
            key={installer.href}
            step={String(i + 1)}
            title={installer.title}
            subtitle={installer.subtitle}
            href={installer.href}
          />
        ))}
        <InstallLink
          step="2"
          title="Install nix-darwin"
          subtitle="Set up darwin-rebuild"
          href={NIX_DARWIN_URL}
        />
      </div>

      <p className="mt-5 text-muted-foreground/70 text-xs leading-relaxed">
        Already installed everything? Hit “Check again” and nixmac will continue as soon as both
        tools are detected.
      </p>
    </StepShell>
  );
}

function InstallLink({
  step,
  title,
  subtitle,
  href,
}: {
  step: string;
  title: string;
  subtitle: string;
  href: string;
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
      className="group flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/50 hover:bg-accent"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted font-mono text-muted-foreground text-sm">
        {step}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 font-medium text-sm">
          {title}
          <ArrowUpRight
            className="size-3.5 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </span>
        <span className="block truncate text-muted-foreground text-xs">{subtitle}</span>
      </span>
    </a>
  );
}
