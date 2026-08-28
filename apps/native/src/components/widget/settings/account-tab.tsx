import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { accountStatusQueryOptions, setCachedAccountStatus } from "@/lib/account-status";
import { client } from "@/lib/orpc";
import { CheckCircle2, Loader2, LogOut, UserCircle2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

type Busy = "idle" | "sending-code" | "verifying-code" | "signing-out";

export function AccountTab() {
  const queryClient = useQueryClient();
  const accountStatusQuery = useQuery(accountStatusQueryOptions());
  const auth = accountStatusQuery.data ?? null;
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [busy, setBusy] = useState<Busy>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (auth?.webAccount?.email) {
      setEmail(auth.webAccount.email);
    }
  }, [auth?.webAccount?.email]);

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

  const onSendCode = () =>
    run("sending-code", async () => {
      await client.account.sendOtp({ email: email.trim() });
      setOtp("");
      setOtpSent(true);
      setNotice("Check your email for a sign-in code");
    });

  const onVerifyCode = () =>
    run("verifying-code", async () => {
      const trimmedEmail = email.trim();
      const status = await client.account.verifyOtp({
        email: trimmedEmail,
        otp: otp.trim(),
        name: trimmedEmail.split("@")[0]?.trim() || "nixmac",
      });
      setCachedAccountStatus(queryClient, status);
      setOtp("");
      setOtpSent(false);
      setNotice("Signed in");
    });

  const onSignOut = () =>
    run("signing-out", async () => {
      const status = await client.account.signOut();
      setCachedAccountStatus(queryClient, status);
      setOtp("");
      setOtpSent(false);
    });

  const isBusy = busy !== "idle";
  const signedIn = auth?.webApiAuthReady ?? false;
  const displayedError = error ?? accountStatusQuery.error?.message ?? null;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-semibold text-base">nixmac Account</h2>
        <p className="text-muted-foreground text-xs">
          Sign in with an email code. The app stores a per-device API key locally and uses it for
          hosted inference, billing, and GitHub requests.
        </p>
      </div>

      {signedIn ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 p-3">
            <UserCircle2 className="h-5 w-5 text-primary" />
            <div className="flex-1">
              <p className="font-medium text-sm">
                {auth?.webAccount?.email ?? auth?.account?.email}
              </p>
              <p className="text-muted-foreground text-xs">
                Device API key stored locally for authenticated requests.
              </p>
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
          {otpSent ? (
            <div className="space-y-2">
              <label className="font-medium text-sm" htmlFor="account-otp">
                Verification code
              </label>
              <Input
                id="account-otp"
                type="text"
                inputMode="numeric"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onVerifyCode();
                }}
                placeholder="Enter the code from your email"
                className="text-xs"
                disabled={isBusy}
              />
            </div>
          ) : null}
          <Button
            onClick={otpSent ? onVerifyCode : onSendCode}
            className="w-full"
            disabled={isBusy || !email.trim() || (otpSent && !otp.trim())}
            data-testid="account-sign-in"
          >
            {isBusy ? (
              <>
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                {busy === "sending-code" ? "Sending code…" : "Verifying code…"}
              </>
            ) : otpSent ? (
              "Verify code and sign in"
            ) : (
              "Send sign-in code"
            )}
          </Button>
          {otpSent ? (
            <button
              type="button"
              onClick={() => {
                setOtp("");
                setOtpSent(false);
                setNotice(null);
                setError(null);
              }}
              className="text-muted-foreground text-xs hover:underline"
              disabled={isBusy}
            >
              Use a different email
            </button>
          ) : null}
        </div>
      )}

      {notice && (
        <p className="flex items-center gap-1 text-emerald-400 text-xs">
          <CheckCircle2 className="h-3 w-3" />
          {notice}
        </p>
      )}
      {displayedError && <p className="text-rose-300 text-xs">{displayedError}</p>}
    </div>
  );
}
