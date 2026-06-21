"use client";

import { useState } from "react";
import { Check, FileWarning, GitBranch, Globe, Loader2, Lock, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MOCK_REPOS, type MockRepo } from "@/components/widget/onboarding/lib/flake-ref";
import { useDarwinConfig } from "@/hooks/use-darwin-config";
import { cn } from "@/lib/utils";

interface GitHubSourceProps {
  onImported?: () => void;
}

type AuthState = "disconnected" | "connecting" | "connected";

const DEFAULT_DIR = ".darwin";

/**
 * Import a nix-darwin flake from GitHub. The connect step + repository list
 * mirror the design mockup; until real GitHub OAuth + repo listing is wired,
 * the connect is simulated and the list is illustrative. Selecting a repo runs
 * the real `config.importGithub` against `owner/repo`. (To import a specific
 * repo today, the Flake reference tab accepts `github:owner/repo`.)
 */
export function GitHubSource({ onImported }: GitHubSourceProps) {
  const { importGithub } = useDarwinConfig();
  const [auth, setAuth] = useState<AuthState>("disconnected");
  const [user, setUser] = useState<string | null>(null);
  const [importingRef, setImportingRef] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function connect() {
    setAuth("connecting");
    // TODO(github-oauth): no OAuth backend yet — simulate the handshake. Once
    // real auth + repo listing lands, populate the list below from the API.
    setTimeout(() => {
      setUser("you");
      setAuth("connected");
    }, 1200);
  }

  async function chooseRepo(repo: MockRepo) {
    if (!repo.hasFlake) return;
    const repoRef = `${repo.owner}/${repo.name}`;
    setError(null);
    setImportingRef(repoRef);
    try {
      await importGithub(repoRef, DEFAULT_DIR);
      onImported?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImportingRef(null);
    }
  }

  // ---- Connect screen ----
  if (auth !== "connected") {
    return (
      <div className="flex flex-col items-center rounded-xl border border-dashed border-border bg-background px-6 py-10 text-center">
        <span
          className="flex size-12 items-center justify-center rounded-xl bg-foreground text-background"
          aria-hidden="true"
        >
          <GitBranch className="size-6" />
        </span>
        <p className="mt-4 font-medium text-sm">Connect your GitHub account</p>
        <p className="mt-1 max-w-sm text-pretty text-muted-foreground text-sm">
          New Mac with nothing set up yet? Connect GitHub to pull your flake straight from a
          repository — no local git required.
        </p>
        <Button
          className="mt-5"
          onClick={connect}
          disabled={auth === "connecting"}
          data-testid="github-connect-button"
        >
          {auth === "connecting" ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Waiting for GitHub…
            </>
          ) : (
            <>
              <GitBranch className="size-4" aria-hidden="true" />
              Continue with GitHub
            </>
          )}
        </Button>
        <p className="mt-4 flex items-center gap-1.5 text-muted-foreground text-xs">
          <ShieldCheck className="size-3.5 text-success" aria-hidden="true" />
          Read-only access to your repositories. Revoke anytime.
        </p>
      </div>
    );
  }

  // ---- Connected: repository list ----
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2">
        <span className="flex items-center gap-2 text-sm">
          <span
            className="flex size-6 items-center justify-center rounded-full bg-success/15 text-success"
            aria-hidden="true"
          >
            <Check className="size-3.5" />
          </span>
          Connected as <span className="font-medium">@{user}</span>
        </span>
        <span className="text-muted-foreground text-xs">Read-only</span>
      </div>

      <div>
        <p className="mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
          Your repositories
        </p>
        <ul className="flex flex-col gap-2">
          {MOCK_REPOS.map((repo) => {
            const repoRef = `${repo.owner}/${repo.name}`;
            const isImporting = importingRef === repoRef;
            return (
              <li key={repo.name}>
                <button
                  type="button"
                  onClick={() => chooseRepo(repo)}
                  disabled={!repo.hasFlake || importingRef !== null}
                  data-testid="import-repo-button"
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                    repo.hasFlake
                      ? "border-border bg-card hover:border-primary/50"
                      : "cursor-not-allowed border-border/60 bg-card/50 opacity-70",
                    isImporting && "border-primary ring-1 ring-primary",
                  )}
                >
                  <span
                    className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
                    aria-hidden="true"
                  >
                    {repo.private ? <Lock className="size-3.5" /> : <Globe className="size-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-sm">
                      {repo.owner}/{repo.name}
                    </span>
                    <span className="text-muted-foreground text-xs">Updated {repo.updated}</span>
                  </span>
                  {isImporting ? (
                    <span className="flex items-center gap-1 font-medium text-primary text-xs">
                      <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                      Importing…
                    </span>
                  ) : repo.hasFlake ? (
                    <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 font-medium text-success text-xs">
                      flake.nix
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-muted-foreground text-xs">
                      <FileWarning className="size-3.5" aria-hidden="true" />
                      No flake
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </div>
  );
}
