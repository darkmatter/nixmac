"use client";

import { GitBranch, Sparkles, Terminal } from "lucide-react";

export function WelcomeStep() {
  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-muted/50 p-6">
        <h3 className="mb-4 font-semibold text-xl">Welcome to nixmac</h3>
        <p className="mb-6 text-muted-foreground leading-relaxed">
          Declaratively manage your Mac using Nix. nixmac makes it easy to configure and maintain
          your system with version-controlled, reproducible configurations.
        </p>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col items-start gap-2 rounded-lg bg-background p-4">
            <div className="rounded-md bg-primary/10 p-2">
              <Terminal className="h-5 w-5 text-primary" />
            </div>
            <h4 className="font-medium">Declarative</h4>
            <p className="text-muted-foreground text-sm">Define your entire system in code</p>
          </div>

          <div className="flex flex-col items-start gap-2 rounded-lg bg-background p-4">
            <div className="rounded-md bg-primary/10 p-2">
              <GitBranch className="h-5 w-5 text-primary" />
            </div>
            <h4 className="font-medium">Version Control</h4>
            <p className="text-muted-foreground text-sm">Track changes with Git</p>
          </div>

          <div className="flex flex-col items-start gap-2 rounded-lg bg-background p-4">
            <div className="rounded-md bg-primary/10 p-2">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <h4 className="font-medium">Reproducible</h4>
            <p className="text-muted-foreground text-sm">Same config, same system</p>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-muted-foreground text-sm">
          <strong className="text-foreground">Note:</strong> This setup wizard will help you
          configure nixmac. Most users can proceed with the default settings.
        </p>
      </div>
    </div>
  );
}
