"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Check, FolderGit2, Loader2 } from "lucide-react";
import { useState } from "react";

interface FlakeDirChooserProps {
  /** Flake directories relative to the imported tree, shallowest first. */
  flakeDirs: string[];
  /** Finalize the import with the selected directory. */
  onChoose: (flakeDir: string) => void | Promise<void>;
  /** Discard the imported tree. */
  onCancel: () => void | Promise<void>;
  /** Disables the controls while a choice is being applied. */
  busy?: boolean;
}

/**
 * Lets the user pick which flake an imported repository should drive their
 * configuration from, when several `flake.nix` candidates were found and none
 * sits at the root. Shown by every import surface via `useImportConfig`.
 */
export function FlakeDirChooser({ flakeDirs, onChoose, onCancel, busy }: FlakeDirChooserProps) {
  const [selected, setSelected] = useState(flakeDirs[0] ?? "");

  return (
    <div className="rounded-xl border border-border bg-card p-4" data-testid="flake-dir-chooser">
      <div className="flex items-center gap-3">
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
          aria-hidden="true"
        >
          <FolderGit2 className="size-5" />
        </span>
        <div>
          <p className="font-medium text-sm">Multiple flakes found</p>
          <p className="text-muted-foreground text-xs">
            This repository contains several <code className="font-mono">flake.nix</code> files.
            Pick the one that configures this Mac.
          </p>
        </div>
      </div>

      <ul className="mt-4 flex flex-col gap-2" aria-label="Flake locations">
        {flakeDirs.map((dir) => {
          const isSelected = dir === selected;
          return (
            <li key={dir}>
              <button
                type="button"
                onClick={() => setSelected(dir)}
                disabled={busy}
                aria-pressed={isSelected}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors",
                  isSelected
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border bg-background hover:border-primary/50",
                )}
              >
                <span
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded-full border",
                    isSelected ? "border-primary bg-primary text-primary-foreground" : "border-border",
                  )}
                  aria-hidden="true"
                >
                  {isSelected ? <Check className="size-3" /> : null}
                </span>
                <code className="truncate font-mono text-sm">{dir}/flake.nix</code>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-4 flex gap-2">
        <Button
          onClick={() => void onChoose(selected)}
          disabled={busy || !selected}
          data-testid="flake-dir-chooser-confirm"
        >
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Applying…
            </>
          ) : (
            "Use this flake"
          )}
        </Button>
        <Button variant="outline" onClick={() => void onCancel()} disabled={busy}>
          Cancel import
        </Button>
      </div>
    </div>
  );
}
