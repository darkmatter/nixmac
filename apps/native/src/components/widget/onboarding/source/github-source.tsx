"use client";

import { useEffect, useRef, useState } from "react";
import { GitHubLogoIcon } from "@radix-ui/react-icons";
import { open } from "@tauri-apps/plugin-shell";
import { Check, FileWarning, Globe, Loader2, Lock, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { tauriAPI } from "@/ipc/api";
import type { GithubRepo } from "@/ipc/types";
import { cn } from "@/lib/utils";

interface GitHubSourceProps {
  onImported?: () => void;
}

type AuthState = "checking" | "disconnected" | "connecting" | "connected";

const DEFAULT_DIR = ".darwin";

async function openExternal(url: string) {
  try {
    await open(url);
  } catch {
    window.open(url, "_blank");
  }
}

/** Human-friendly "Updated …" from an ISO-8601 timestamp. */
function relativeUpdated(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months > 1 ? "s" : ""} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years > 1 ? "s" : ""} ago`;
}

/**
 * Import a nix-darwin flake from GitHub via the server-brokered GitHub App.
 * The desktop never holds the App key or a long-lived token: connect opens the
 * install in the browser, we poll `github.status` until the account is linked,
 * list the installation's repos, and clone the chosen one with a short-lived
 * token minted per-import (see docs/github-app-server-contract.md).
 */
export function GitHubSource({ onImported }: GitHubSourceProps) {
  const [auth, setAuth] = useState<AuthState>("checking");
  const [login, setLogin] = useState<string | null>(null);
  const [repos, setRepos] = useState<GithubRepo[] | null>(null);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [importingRef, setImportingRef] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  // Already connected? Skip straight to the repo list on mount.
  useEffect(() => {
    tauriAPI.github
      .status()
      .then((s) => {
        if (cancelled.current) return;
        if (s.connected) {
          setLogin(s.login ?? null);
          setAuth("connected");
        } else {
          setAuth("disconnected");
        }
      })
      .catch(() => {
        if (!cancelled.current) setAuth("disconnected");
      });
  }, []);

  // Poll for linkage while the browser install is in progress.
  useEffect(() => {
    if (auth !== "connecting") return;
    const id = setInterval(async () => {
      try {
        const s = await tauriAPI.github.status();
        if (cancelled.current) return;
        if (s.connected) {
          setLogin(s.login ?? null);
          setAuth("connected");
        }
      } catch {
        /* keep polling — the user may not have finished yet */
      }
    }, 2500);
    return () => clearInterval(id);
  }, [auth]);

  // Load repos once connected.
  useEffect(() => {
    if (auth !== "connected" || repos !== null) return;
    setLoadingRepos(true);
    tauriAPI.github
      .listRepos()
      .then((r) => {
        if (!cancelled.current) setRepos(r);
      })
      .catch((e: unknown) => {
        if (!cancelled.current) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled.current) setLoadingRepos(false);
      });
  }, [auth, repos]);

  async function connect() {
    setError(null);
    setAuth("connecting");
    try {
      const { installUrl } = await tauriAPI.github.connectStart();
      await openExternal(installUrl);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setAuth("disconnected");
    }
  }

  async function checkNow() {
    try {
      const s = await tauriAPI.github.status();
      if (cancelled.current) return;
      if (s.connected) {
        setLogin(s.login ?? null);
        setAuth("connected");
      }
    } catch {
      /* ignore — stays in connecting */
    }
  }

  async function chooseRepo(repo: GithubRepo) {
    if (!repo.hasFlake) return;
    const repoRef = `${repo.owner}/${repo.name}`;
    setError(null);
    setImportingRef(repoRef);
    try {
      await tauriAPI.github.import(repo.owner, repo.name, DEFAULT_DIR);
      onImported?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!cancelled.current) setImportingRef(null);
    }
  }

  // ---- Initial status probe ----
  if (auth === "checking") {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-background px-6 py-10 text-muted-foreground text-sm">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Checking GitHub connection…
      </div>
    );
  }

  // ---- Connect screen ----
  if (auth !== "connected") {
    const connecting = auth === "connecting";
    return (
      <div className="flex flex-col items-center rounded-xl border border-dashed border-border bg-background px-6 py-10 text-center">
        <span
          className="flex size-12 items-center justify-center rounded-xl bg-foreground text-background"
          aria-hidden="true"
        >
          <GitHubLogoIcon className="size-6" />
        </span>
        <p className="mt-4 font-medium text-sm">Connect your GitHub account</p>
        <p className="mt-1 max-w-sm text-pretty text-muted-foreground text-sm">
          New Mac with nothing set up yet? Connect GitHub to pull your flake straight from a
          repository — no local git required.
        </p>
        <Button className="mt-5" onClick={connect} disabled={connecting} data-testid="github-connect-button">
          {connecting ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Waiting for GitHub…
            </>
          ) : (
            <>
              <GitHubLogoIcon className="size-4" aria-hidden="true" />
              Continue with GitHub
            </>
          )}
        </Button>
        {connecting ? (
          <div className="mt-3 flex flex-col items-center gap-1.5">
            <button
              type="button"
              onClick={checkNow}
              className="inline-flex items-center gap-1.5 font-medium text-primary text-xs hover:underline"
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
              I&apos;ve authorized — check now
            </button>
            <button
              type="button"
              onClick={connect}
              className="text-muted-foreground text-xs hover:underline"
            >
              Re-open GitHub
            </button>
          </div>
        ) : null}
        <p className="mt-4 flex items-center gap-1.5 text-muted-foreground text-xs">
          <ShieldCheck className="size-3.5 text-success" aria-hidden="true" />
          Read-only access to the repositories you choose. Revoke anytime.
        </p>
        {error ? <p className="mt-3 text-destructive text-xs">{error}</p> : null}
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
          Connected{login ? <> as <span className="font-medium">@{login}</span></> : null}
        </span>
        <span className="text-muted-foreground text-xs">Read-only</span>
      </div>

      <div>
        <p className="mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
          Your repositories
        </p>

        {loadingRepos ? (
          <div className="flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 py-6 text-muted-foreground text-sm">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Loading your repositories…
          </div>
        ) : repos && repos.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {repos.map((repo) => {
              const repoRef = `${repo.owner}/${repo.name}`;
              const isImporting = importingRef === repoRef;
              return (
                <li key={repoRef}>
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
                      <span className="text-muted-foreground text-xs">
                        Updated {relativeUpdated(repo.updatedAt)}
                      </span>
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
        ) : (
          <div className="rounded-lg border border-dashed border-border bg-background px-3 py-6 text-center text-muted-foreground text-sm">
            No repositories shared with nixmac yet.{" "}
            <button type="button" onClick={connect} className="font-medium text-primary hover:underline">
              Adjust on GitHub
            </button>
          </div>
        )}
      </div>

      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </div>
  );
}
