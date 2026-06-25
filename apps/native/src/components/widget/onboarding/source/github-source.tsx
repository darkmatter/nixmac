"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { GitHubLogoIcon } from "@radix-ui/react-icons";
import { open } from "@tauri-apps/plugin-shell";
import { Check, FileWarning, Globe, Loader2, Lock, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { tauriAPI } from "@/ipc/api";
import type { GithubRepo } from "@/ipc/types";
import { cn } from "@/lib/utils";

interface GitHubSourceProps {
  onImported?: () => void;
}

type AuthState = "checking" | "disconnected" | "connecting" | "connected";
type ConnectMode = "bootstrap" | "authed";

const DEFAULT_DIR = ".darwin";
const EMAIL_FALLBACK_MESSAGE =
  "GitHub could not finish account setup. Use an email code to continue, then reconnect GitHub.";

async function openExternal(url: string) {
  try {
    await open(url);
  } catch {
    window.open(url, "_blank");
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function otpErrorMessage(error: unknown): string {
  const message = errorMessage(error);
  if (/otp|code|verification|invalid|expired/i.test(message)) {
    return "That code is invalid or expired. Request a new code and try again.";
  }
  return message;
}

function isUnauthorizedSession(error: unknown): boolean {
  return /401|UNAUTHORIZED_SESSION|Unauthorized or invalid session/i.test(errorMessage(error));
}

function accountNameFromEmail(email: string): string {
  return email.split("@")[0]?.trim() || "nixmac";
}

function repoRef(repo: GithubRepo): string {
  return `${repo.owner}/${repo.name}`;
}

function repoMatchesQuery(repo: GithubRepo, normalizedQuery: string): boolean {
  return !normalizedQuery || repoRef(repo).toLowerCase().includes(normalizedQuery);
}

function compareReposByFlake(a: GithubRepo, b: GithubRepo): number {
  if (a.hasFlake === b.hasFlake) return 0;
  return a.hasFlake ? -1 : 1;
}

function repoVisibilityIcon(repo: GithubRepo): ReactNode {
  return repo.private ? <Lock className="size-3.5" /> : <Globe className="size-3.5" />;
}

function repoStatus(repo: GithubRepo, isImporting: boolean): ReactNode {
  if (isImporting) {
    return (
      <span className="flex items-center gap-1 font-medium text-primary text-xs">
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        Importing…
      </span>
    );
  }

  if (repo.hasFlake) {
    return (
      <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 font-medium text-success text-xs">
        flake.nix
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1 text-muted-foreground text-xs">
      <FileWarning className="size-3.5" aria-hidden="true" />
      No flake
    </span>
  );
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
  const [githubReady, setGithubReady] = useState(false);
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [showEmailFallback, setShowEmailFallback] = useState(false);
  const [connectMode, setConnectMode] = useState<ConnectMode | null>(null);
  const [bootstrapState, setBootstrapState] = useState<string | null>(null);
  const [accountWorking, setAccountWorking] = useState(false);
  const [login, setLogin] = useState<string | null>(null);
  const [repos, setRepos] = useState<GithubRepo[] | null>(null);
  const [repoQuery, setRepoQuery] = useState("");
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [importingRef, setImportingRef] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  const resetRejectedSession = useCallback((error: unknown): boolean => {
    if (!isUnauthorizedSession(error)) return false;
    setGithubReady(false);
    setAuth("disconnected");
    setLogin(null);
    setRepos(null);
    setConnectMode(null);
    setBootstrapState(null);
    return true;
  }, []);

  const requireEmailFallback = useCallback((message?: string | null) => {
    setShowEmailFallback(true);
    setGithubReady(false);
    setConnectMode(null);
    setBootstrapState(null);
    setAuth("disconnected");
    setError(message?.trim() || EMAIL_FALLBACK_MESSAGE);
  }, []);

  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  // Probe account + GitHub linkage on mount.
  useEffect(() => {
    // deprecated(orpc): replace with client/orpc from @/lib/orpc
    tauriAPI.account
      .status()
      .then(async (accountStatus) => {
        if (cancelled.current) return;
        setGithubReady(accountStatus.githubReady);
        if (!accountStatus.githubReady) {
          setAuth("disconnected");
          return;
        }
        // deprecated(orpc): replace with client/orpc from @/lib/orpc
        const s = await tauriAPI.github.status();
        if (cancelled.current) return;
        if (s.connected) {
          setLogin(s.login ?? null);
          setAuth("connected");
        } else {
          setAuth("disconnected");
        }
      })
      .catch((e: unknown) => {
        if (cancelled.current) return;
        resetRejectedSession(e);
        setAuth("disconnected");
      });
  }, [resetRejectedSession]);

  // Poll for linkage while the browser install is in progress.
  const pollGitHubConnection = useCallback(async () => {
    try {
      if (connectMode === "bootstrap") {
        if (!bootstrapState) return;
        // deprecated(orpc): replace with client/orpc from @/lib/orpc
        const s = await tauriAPI.github.bootstrapStatus(bootstrapState);
        if (cancelled.current) return;
        if (s.connected || s.state === "complete") {
          setGithubReady(true);
          setShowEmailFallback(false);
          setConnectMode(null);
          setBootstrapState(null);
          setLogin(s.login ?? null);
          setAuth("connected");
        } else if (s.state === "fallbackRequired" || s.state === "expired") {
          requireEmailFallback(s.fallbackReason);
        }
        return;
      }

      // deprecated(orpc): replace with client/orpc from @/lib/orpc
      const s = await tauriAPI.github.status();
      if (cancelled.current) return;
      if (s.connected) {
        setLogin(s.login ?? null);
        setConnectMode(null);
        setAuth("connected");
      }
    } catch (e: unknown) {
      if (connectMode === "bootstrap") {
        requireEmailFallback(errorMessage(e));
      } else if (resetRejectedSession(e)) {
        setError(errorMessage(e));
      }
    }
  }, [bootstrapState, connectMode, requireEmailFallback, resetRejectedSession]);

  useEffect(() => {
    if (auth !== "connecting") return;
    const id = setInterval(async () => {
      await pollGitHubConnection();
    }, 2500);
    return () => clearInterval(id);
  }, [auth, pollGitHubConnection]);

  // Load repos once connected.
  useEffect(() => {
    if (auth !== "connected" || repos !== null) return;
    setLoadingRepos(true);
    // deprecated(orpc): replace with client/orpc from @/lib/orpc
    tauriAPI.github
      .listRepos()
      .then((r) => {
        if (!cancelled.current) setRepos(r);
      })
      .catch((e: unknown) => {
        if (cancelled.current) return;
        resetRejectedSession(e);
        setError(errorMessage(e));
      })
      .finally(() => {
        if (!cancelled.current) setLoadingRepos(false);
      });
  }, [auth, repos, resetRejectedSession]);

  async function sendOtp() {
    setError(null);
    setAccountWorking(true);
    try {
      // deprecated(orpc): replace with client/orpc from @/lib/orpc
      await tauriAPI.account.sendOtp(email);
      if (cancelled.current) return;
      setOtp("");
      setOtpSent(true);
    } catch (e: unknown) {
      setError(errorMessage(e));
    } finally {
      if (!cancelled.current) setAccountWorking(false);
    }
  }

  function changeEmail() {
    setOtp("");
    setOtpSent(false);
    setError(null);
  }

  async function startGitHubConnect(mode: ConnectMode) {
    setAuth("connecting");
    setConnectMode(mode);
    if (mode === "bootstrap") {
      // deprecated(orpc): replace with client/orpc from @/lib/orpc
      const { installUrl, state } = await tauriAPI.github.bootstrapStart();
      setBootstrapState(state);
      await openExternal(installUrl);
      return;
    }

    setBootstrapState(null);
    // deprecated(orpc): replace with client/orpc from @/lib/orpc
    const { installUrl } = await tauriAPI.github.connectStart();
    await openExternal(installUrl);
  }

  async function verifyOtpAndConnect() {
    setError(null);
    setAccountWorking(true);
    try {
      // deprecated(orpc): replace with client/orpc from @/lib/orpc
      await tauriAPI.account.verifyOtp(email, otp, accountNameFromEmail(email));
      if (cancelled.current) return;
      setGithubReady(true);
      setShowEmailFallback(false);
      setOtpSent(false);
      setOtp("");
      await startGitHubConnect("authed");
    } catch (e: unknown) {
      resetRejectedSession(e);
      setError(otpErrorMessage(e));
      setAuth("disconnected");
    } finally {
      if (!cancelled.current) setAccountWorking(false);
    }
  }

  async function connect() {
    setError(null);
    setAccountWorking(true);
    const mode: ConnectMode = githubReady ? "authed" : "bootstrap";
    try {
      await startGitHubConnect(mode);
    } catch (e: unknown) {
      if (mode === "bootstrap") {
        requireEmailFallback(errorMessage(e));
      } else {
        resetRejectedSession(e);
        setError(errorMessage(e));
        setAuth("disconnected");
      }
    } finally {
      if (!cancelled.current) setAccountWorking(false);
    }
  }

  async function checkNow() {
    await pollGitHubConnection();
  }

  async function chooseRepo(repo: GithubRepo) {
    if (!repo.hasFlake) return;
    const repoRef = `${repo.owner}/${repo.name}`;
    setError(null);
    setImportingRef(repoRef);
    try {
      // deprecated(orpc): replace with client/orpc from @/lib/orpc
      await tauriAPI.github.import(repo.owner, repo.name, DEFAULT_DIR);
      onImported?.();
    } catch (e: unknown) {
      resetRejectedSession(e);
      setError(errorMessage(e));
    } finally {
      if (!cancelled.current) setImportingRef(null);
    }
  }

  const normalizedRepoQuery = repoQuery.trim().toLowerCase();
  const filteredRepos = repos
    ?.filter((repo) => repoMatchesQuery(repo, normalizedRepoQuery))
    .sort(compareReposByFlake);

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
    const connectBusy = connecting || accountWorking;
    const usingEmailFallback = showEmailFallback || otpSent;
    const connectBusyLabel = connecting
      ? "Waiting for GitHub…"
      : usingEmailFallback
        ? otpSent
          ? "Verifying code…"
          : "Sending code…"
        : "Opening GitHub…";
    const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
    const accountFormReady = emailValid && (!otpSent || otp.trim().length > 0);
    const canContinue = usingEmailFallback ? accountFormReady : true;
    const primaryAction = usingEmailFallback ? (otpSent ? verifyOtpAndConnect : sendOtp) : connect;
    const primaryLabel = usingEmailFallback
      ? otpSent
        ? "Verify code and connect"
        : "Send sign-in code"
      : "Continue with GitHub";
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
          Import your nix-darwin flake from a GitHub repository. GitHub authorizes read-only repo
          access; nixmac links that access to your account.
        </p>

        {usingEmailFallback ? (
          <div className="mt-5 w-full max-w-sm text-left">
            <p className="mb-3 rounded-lg border border-border bg-muted/30 px-3 py-2 text-muted-foreground text-xs">
              {error ?? EMAIL_FALLBACK_MESSAGE}
            </p>
            <div className="mb-3 flex flex-col gap-1.5">
              <label htmlFor="github-onboarding-email" className="font-medium text-sm">
                Email
              </label>
              <input
                id="github-onboarding-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                disabled={otpSent || accountWorking}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            {otpSent ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="github-onboarding-otp" className="font-medium text-sm">
                    Verification code
                  </label>
                  <input
                    id="github-onboarding-otp"
                    type="text"
                    inputMode="numeric"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                    placeholder="Enter the code from your email"
                    autoComplete="one-time-code"
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                <div className="mt-2 flex items-center justify-between gap-3 text-xs">
                  <button
                    type="button"
                    onClick={sendOtp}
                    disabled={accountWorking || !emailValid}
                    className="font-medium text-primary hover:underline disabled:pointer-events-none disabled:opacity-50"
                  >
                    Resend code
                  </button>
                  <button
                    type="button"
                    onClick={changeEmail}
                    disabled={accountWorking}
                    className="text-muted-foreground hover:underline disabled:pointer-events-none disabled:opacity-50"
                  >
                    Change email
                  </button>
                </div>
              </>
            ) : (
              <p className="text-muted-foreground text-xs">
                We'll email you a one-time code to sign in or create your nixmac account.
              </p>
            )}
          </div>
        ) : null}

        <Button
          className="mt-5"
          onClick={primaryAction}
          disabled={connectBusy || !canContinue}
          data-testid="github-connect-button"
        >
          {connectBusy ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              {connectBusyLabel}
            </>
          ) : (
            <>
              <GitHubLogoIcon className="size-4" aria-hidden="true" />
              {primaryLabel}
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
        {error && !usingEmailFallback ? <p className="mt-3 text-destructive text-xs">{error}</p> : null}
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
          <>
            <div className="relative mb-3">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <input
                type="search"
                value={repoQuery}
                onChange={(e) => setRepoQuery(e.target.value)}
                placeholder="Search repositories"
                aria-label="Search repositories"
                className="w-full rounded-lg border border-input bg-background py-2 pr-3 pl-9 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            {filteredRepos && filteredRepos.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {filteredRepos.map((repo) => {
                  const ref = repoRef(repo);
                  const isImporting = importingRef === ref;
                  return (
                    <li key={ref}>
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
                          {repoVisibilityIcon(repo)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-mono text-sm">
                            {repo.owner}/{repo.name}
                          </span>
                          <span className="text-muted-foreground text-xs">
                            Updated {relativeUpdated(repo.updatedAt)}
                          </span>
                        </span>
                        {repoStatus(repo, isImporting)}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="rounded-lg border border-dashed border-border bg-background px-3 py-6 text-center text-muted-foreground text-sm">
                No repositories match "{repoQuery}".
              </div>
            )}
          </>
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
