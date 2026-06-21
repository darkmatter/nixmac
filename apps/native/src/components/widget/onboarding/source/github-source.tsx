"use client";

import { useState } from "react";
import { GitBranch, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDarwinConfig } from "@/hooks/use-darwin-config";
import { cn } from "@/lib/utils";

interface GitHubSourceProps {
  onImported?: () => void;
}

const DEFAULT_DIR = ".darwin";

const EXAMPLES = ["nix-darwin/nix-darwin", "you/dotfiles", "you/nix-config#main"];

/**
 * Import a nix-darwin flake from a public GitHub repo via the real
 * `config.importGithub` command — takes `owner/repo` with an optional
 * `#branch`. (OAuth + private-repo browsing is a future enhancement.)
 */
export function GitHubSource({ onImported }: GitHubSourceProps) {
  const { importGithub } = useDarwinConfig();
  const [repoRef, setRepoRef] = useState("");
  const [dirName, setDirName] = useState(DEFAULT_DIR);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targetName = dirName.trim() || DEFAULT_DIR;
  const ready = repoRef.trim().length > 0;

  async function runImport() {
    if (!ready) {
      setError("Enter a GitHub reference like owner/repo");
      return;
    }
    setError(null);
    setImporting(true);
    try {
      await importGithub(repoRef.trim(), targetName);
      onImported?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-3">
        <span
          className="flex size-10 items-center justify-center rounded-xl bg-foreground text-background"
          aria-hidden="true"
        >
          <GitBranch className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="font-medium text-sm">Import from a GitHub repo</p>
          <p className="text-pretty text-muted-foreground text-sm">
            Pull your flake straight from a public repository — no local git required.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="gh-repo" className="font-medium text-sm">
          Repository
        </label>
        <div
          className={cn(
            "flex items-center gap-2 rounded-lg border bg-background px-3 py-2 transition-colors focus-within:ring-2 focus-within:ring-ring",
            error ? "border-destructive" : "border-input",
          )}
        >
          <span className="font-mono text-muted-foreground text-sm">github:</span>
          <input
            id="gh-repo"
            value={repoRef}
            onChange={(e) => {
              setRepoRef(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void runImport();
            }}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            placeholder="owner/repo"
            className="w-full bg-transparent font-mono text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setRepoRef(ex)}
              className="rounded-lg border border-border bg-background px-2.5 py-1 font-mono text-foreground text-xs transition-colors hover:border-primary/50"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="gh-dir" className="font-medium text-sm">
          Destination folder
        </label>
        <input
          id="gh-dir"
          value={dirName}
          onChange={(e) => setDirName(e.target.value)}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <p className="text-muted-foreground text-xs">
          Imported into <code className="font-mono">~/{targetName}</code>. Add{" "}
          <code className="font-mono">#branch</code> to the repo to clone a specific branch.
        </p>
      </div>

      <Button onClick={runImport} disabled={!ready || importing} data-testid="import-repo-button">
        {importing ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Importing…
          </>
        ) : (
          <>
            <GitBranch className="size-4" aria-hidden="true" />
            Import from GitHub
          </>
        )}
      </Button>

      {error ? <p className="text-destructive text-xs">{error}</p> : null}

      <p className="flex items-center gap-1.5 text-muted-foreground text-xs">
        <ShieldCheck className="size-3.5 text-success" aria-hidden="true" />
        Public repos work today. Private-repo sign-in is coming soon.
      </p>
    </div>
  );
}
