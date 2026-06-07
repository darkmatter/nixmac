import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { tauriAPI } from "@/ipc/api";
import type { AuthStatus, SyncRemoteStatus } from "@/ipc/types";
import { CheckCircle2, CloudDownload, CloudUpload, LogOut, RefreshCw, UserCircle2 } from "lucide-react";
import { useEffect, useState } from "react";

type Busy = "idle" | "signing-in" | "signing-out" | "saving-url" | "pushing" | "pulling" | "status";

export function AccountTab() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [serverUrl, setServerUrl] = useState("");
  const [remote, setRemote] = useState<SyncRemoteStatus | null>(null);
  const [busy, setBusy] = useState<Busy>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    tauriAPI.account
      .status()
      .then((status) => {
        setAuth(status);
        setServerUrl(status.serverUrl);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const run = async (kind: Busy, fn: () => Promise<void>) => {
    setError(null);
    setNotice(null);
    setBusy(kind);
    try {
      await fn();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("idle");
    }
  };

  const onSignIn = () =>
    run("signing-in", async () => {
      const status = await tauriAPI.account.signIn(email.trim(), password);
      setAuth(status);
      setPassword("");
      setNotice("Signed in");
    });

  const onSignOut = () =>
    run("signing-out", async () => {
      const status = await tauriAPI.account.signOut();
      setAuth(status);
      setRemote(null);
    });

  const onSaveServerUrl = () =>
    run("saving-url", async () => {
      const status = await tauriAPI.account.setServerUrl(serverUrl.trim());
      setAuth(status);
      setNotice("Server URL updated");
    });

  const onRefreshStatus = () =>
    run("status", async () => {
      setRemote(await tauriAPI.sync.status());
    });

  const onPush = () =>
    run("pushing", async () => {
      const result = await tauriAPI.sync.push();
      setNotice(result.message);
    });

  const onPull = () =>
    run("pulling", async () => {
      const result = await tauriAPI.sync.pull();
      setNotice(result.message);
    });

  const isBusy = busy !== "idle";
  const signedIn = auth?.signedIn ?? false;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-semibold text-base">nixmac Account</h2>
        <p className="text-muted-foreground text-xs">
          Sign in to sync your configuration through nixmac's servers instead of GitHub. Requests
          are authenticated with a per-device key kept in your macOS keychain.
        </p>
      </div>

      {/* Server URL */}
      <div className="space-y-2">
        <label className="font-medium text-sm" htmlFor="sync-server-url">
          Sync server
        </label>
        <div className="flex items-center gap-2">
          <Input
            id="sync-server-url"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder="https://sync.nixmac.app"
            className="font-mono text-xs"
            disabled={isBusy}
          />
          <Button onClick={onSaveServerUrl} size="sm" variant="secondary" disabled={isBusy}>
            Save
          </Button>
        </div>
      </div>

      {signedIn ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 p-3">
            <UserCircle2 className="h-5 w-5 text-primary" />
            <div className="flex-1">
              <p className="font-medium text-sm">{auth?.account?.email}</p>
              <p className="text-muted-foreground text-xs">Device key: {auth?.keyId}</p>
            </div>
            <Button
              onClick={onSignOut}
              size="sm"
              variant="ghost"
              disabled={isBusy}
              data-testid="account-sign-out"
            >
              <LogOut className="mr-1 h-3 w-3" />
              Sign out
            </Button>
          </div>

          {/* Sync actions */}
          <div className="space-y-2">
            <label className="font-medium text-sm">Sync</label>
            <div className="flex flex-wrap gap-2">
              <Button onClick={onPush} size="sm" disabled={isBusy} data-testid="sync-push">
                <CloudUpload className="mr-1 h-3 w-3" />
                Push
              </Button>
              <Button onClick={onPull} size="sm" variant="secondary" disabled={isBusy}>
                <CloudDownload className="mr-1 h-3 w-3" />
                Pull
              </Button>
              <Button onClick={onRefreshStatus} size="sm" variant="ghost" disabled={isBusy}>
                <RefreshCw className="mr-1 h-3 w-3" />
                Check status
              </Button>
            </div>
            {remote && (
              <p className="text-muted-foreground text-xs">
                {remote.configured
                  ? `Server snapshot: ${remote.headCommitHash?.slice(0, 8) ?? "unknown"} · ${remote.deviceCount} device(s)`
                  : "No server snapshot stored yet."}
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="font-medium text-sm" htmlFor="account-email">
              Email
            </label>
            <Input
              id="account-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="text-xs"
              disabled={isBusy}
            />
          </div>
          <div className="space-y-2">
            <label className="font-medium text-sm" htmlFor="account-password">
              Password
            </label>
            <Input
              id="account-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSignIn();
              }}
              placeholder="••••••••"
              className="text-xs"
              disabled={isBusy}
            />
          </div>
          <Button
            onClick={onSignIn}
            className="w-full"
            disabled={isBusy || !email.trim() || !password}
            data-testid="account-sign-in"
          >
            {busy === "signing-in" ? "Signing in…" : "Sign in"}
          </Button>
        </div>
      )}

      {notice && (
        <p className="flex items-center gap-1 text-emerald-400 text-xs">
          <CheckCircle2 className="h-3 w-3" />
          {notice}
        </p>
      )}
      {error && <p className="text-rose-300 text-xs">{error}</p>}
    </div>
  );
}
