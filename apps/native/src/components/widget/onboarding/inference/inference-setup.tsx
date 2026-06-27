"use client";

import { Button } from "@/components/ui/button";
import {
  BYOK_PROVIDERS,
  FALLBACK_HOSTED_PAYG_PRODUCT,
  parseHostedPaygProductResponse,
  validateKeyFormat,
  type HostedPaygProduct,
  type InferenceConfig,
  type InferenceMode,
} from "@/components/widget/onboarding/lib/inference";
import { tauriAPI } from "@/ipc/api";
import { getWebSiteUrl } from "@/lib/env";
import { getTelemetry } from "@/lib/telemetry/instance";
import { cn } from "@/lib/utils";
import NixmacIcon from "@nixmac/ui/components/icon";
import { open } from "@tauri-apps/plugin-shell";
import {
  Check,
  CreditCard,
  KeyRound,
  Loader2,
  Lock,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import posthog from "posthog-js";
import type React from "react";
import { useEffect, useMemo, useState } from "react";

interface InferenceSetupProps {
  onConfigured: (config: InferenceConfig) => void;
}

export function InferenceSetup({ onConfigured }: InferenceSetupProps) {
  const [mode, setMode] = useState<InferenceMode>("hosted");

  return (
    <div className="flex flex-col gap-5">
      <div role="tablist" aria-label="Inference method" className="grid grid-cols-2 gap-2">
        <ModeCard
          active={mode === "hosted"}
          icon={<NixmacIcon className="size-6 bg-none" />}
          title="nixmac hosted"
          blurb="We run the models. Sign in and add a payment method."
          badge="Recommended"
          onClick={() => setMode("hosted")}
        />
        <ModeCard
          active={mode === "byok"}
          icon={<KeyRound className="size-4" />}
          title="Bring your own key"
          blurb="Use your own provider account and API key."
          onClick={() => setMode("byok")}
        />
      </div>

      {mode === "hosted" ? (
        <HostedFlow onConfigured={onConfigured} />
      ) : (
        <ByokFlow onConfigured={onConfigured} />
      )}
    </div>
  );
}

function ModeCard({
  active,
  icon,
  title,
  blurb,
  badge,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  title: string;
  blurb: string;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "relative flex flex-col gap-1.5 rounded-xl border p-4 text-left transition-colors",
        active ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-accent",
      )}
    >
      <span className="flex items-center gap-2">
        <span
          className={cn(
            "flex size-8 items-center justify-center rounded-lg",
            active ? "bg-zinc-700/80 text-primary-foreground" : "bg-none text-muted-foreground",
          )}
          aria-hidden="true"
        >
          {icon}
        </span>
        <span className="font-medium text-sm">{title}</span>
        {badge ? (
          <span className="rounded-full bg-success/15 px-1.5 py-0.5 font-semibold text-[10px] text-success">
            {badge}
          </span>
        ) : null}
      </span>
      <span className="text-pretty text-muted-foreground text-xs leading-relaxed">{blurb}</span>
    </button>
  );
}

/* ----------------------------- Hosted account ---------------------------- */

type HostedStage = "account" | "payment";

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

function accountNameFromEmail(email: string): string {
  return email.split("@")[0]?.trim() || "nixmac";
}

async function openExternal(url: string) {
  try {
    await open(url);
  } catch {
    window.open(url, "_blank");
  }
}

async function loadHostedPaygProduct(): Promise<HostedPaygProduct> {
  const base = getWebSiteUrl().replace(/\/$/, "");
  const response = await fetch(`${base}/api/billing/payg-product`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Could not load Polar PAYG product (${response.status})`);
  }
  return parseHostedPaygProductResponse(await response.json());
}

function HostedFlow({ onConfigured }: { onConfigured: (config: InferenceConfig) => void }) {
  const [stage, setStage] = useState<HostedStage>("account");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [paygProduct, setPaygProduct] = useState<HostedPaygProduct>(FALLBACK_HOSTED_PAYG_PRODUCT);
  const [paygProductLoaded, setPaygProductLoaded] = useState(false);
  const [paygProductLoading, setPaygProductLoading] = useState(false);
  const [paygProductError, setPaygProductError] = useState<string | null>(null);
  const [creditAmount, setCreditAmount] = useState(25);
  const [checkoutStarted, setCheckoutStarted] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [zipCode, setZipCode] = useState("");
  const [country, setCountry] = useState("US");

  const normalizedEmail = email.trim();
  const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail);
  const accountReady = emailValid && (!otpSent || otp.trim().length > 0);
  const amountWithinBounds =
    creditAmount >= paygProduct.minimumAmountUsd &&
    (paygProduct.maximumAmountUsd === undefined || creditAmount <= paygProduct.maximumAmountUsd);
  const cardReady =
    paygProductLoaded &&
    amountWithinBounds &&
    zipCode.trim().length > 0 &&
    country.trim().length > 0;

  useEffect(() => {
    let cancelled = false;
    tauriAPI.account
      .status()
      .then((status) => {
        if (cancelled || !status.webAccount) return;
        setEmail(status.webAccount.email);
        setOtp("");
        setOtpSent(false);
        setStage("payment");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (stage !== "payment") return;
    let cancelled = false;
    setPaygProductLoading(true);
    setPaygProductLoaded(false);
    setPaygProductError(null);
    loadHostedPaygProduct()
      .then((product) => {
        if (cancelled) return;
        setPaygProduct(product);
        setPaygProductLoaded(true);
        setCreditAmount((current) =>
          Math.max(
            product.minimumAmountUsd,
            Math.min(current, product.maximumAmountUsd ?? current),
          ),
        );
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setPaygProductLoaded(false);
          setPaygProductError(errorMessage(e));
        }
      })
      .finally(() => {
        if (!cancelled) setPaygProductLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [stage]);

  async function sendSignInCode() {
    if (!emailValid) return;
    setWorking(true);
    setError(null);
    try {
      // deprecated(orpc): replace with client/orpc from @/lib/orpc
      await tauriAPI.account.sendOtp(normalizedEmail);
      setOtp("");
      setOtpSent(true);
    } catch (e: unknown) {
      setError(errorMessage(e));
    } finally {
      setWorking(false);
    }
  }

  function changeEmail() {
    setOtp("");
    setOtpSent(false);
    setError(null);
  }

  async function verifySignInCode() {
    if (!accountReady || !otpSent) return;
    setWorking(true);
    setError(null);
    try {
      // deprecated(orpc): replace with client/orpc from @/lib/orpc
      await tauriAPI.account.verifyOtp(
        normalizedEmail,
        otp.trim(),
        accountNameFromEmail(normalizedEmail),
      );
      setEmail(normalizedEmail);
      setOtp("");
      posthog.identify(normalizedEmail, { email: normalizedEmail });
      getTelemetry().captureEvent({ name: "account_signed_in" });
      setStage("payment");
    } catch (e: unknown) {
      setError(otpErrorMessage(e));
    } finally {
      setWorking(false);
    }
  }

  async function submitPayment() {
    if (!cardReady) return;
    setWorking(true);
    setError(null);
    try {
      const checkoutUrl = await tauriAPI.account.createPaygCheckout(
        creditAmount,
        country,
        zipCode.trim(),
      );
      await openExternal(checkoutUrl);
      setCheckoutStarted(true);
    } catch (e: unknown) {
      setError(errorMessage(e));
    } finally {
      setWorking(false);
    }
  }

  if (stage === "account") {
    const accountAction = otpSent ? verifySignInCode : sendSignInCode;
    const accountBusyLabel = otpSent ? "Verifying code…" : "Sending code…";
    const accountLabel = otpSent ? "Verify code and continue" : "Send sign-in code";

    return (
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
        <p className="font-semibold text-sm">Sign in to nixmac</p>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="inf-email" className="font-medium text-sm">
            Email
          </label>
          <input
            id="inf-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            disabled={otpSent || working}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        {otpSent ? (
          <>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="inf-otp" className="font-medium text-sm">
                Verification code
              </label>
              <input
                id="inf-otp"
                type="text"
                inputMode="numeric"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                placeholder="Enter the code from your email"
                autoComplete="one-time-code"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div className="flex items-center justify-between gap-3 text-xs">
              <button
                type="button"
                onClick={sendSignInCode}
                disabled={working || !emailValid}
                className="font-medium text-primary hover:underline disabled:pointer-events-none disabled:opacity-50"
              >
                Resend code
              </button>
              <button
                type="button"
                onClick={changeEmail}
                disabled={working}
                className="text-muted-foreground hover:underline disabled:pointer-events-none disabled:opacity-50"
              >
                Change email
              </button>
            </div>
          </>
        ) : (
          <p className="text-muted-foreground text-xs">
            We&apos;ll email you a one-time code to sign in or create your nixmac account.
          </p>
        )}

        <Button onClick={accountAction} disabled={!accountReady || working}>
          {working ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              {accountBusyLabel}
            </>
          ) : (
            accountLabel
          )}
        </Button>
        {error ? <p className="text-destructive text-xs">{error}</p> : null}
        <p className="flex items-center gap-1.5 text-muted-foreground text-xs">
          <ShieldCheck className="size-3.5 text-success" aria-hidden="true" />
          Encrypted in transit. We never see your nix configuration contents.
        </p>
      </div>
    );
  }

  // stage === "payment"
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2 text-sm">
        <span className="flex size-6 items-center justify-center rounded-full bg-success/15 text-success">
          <Check className="size-3.5" aria-hidden="true" />
        </span>
        Signed in as <span className="font-medium">{email}</span>
      </div>

      <fieldset>
        <legend className="mb-2 font-medium text-sm">Choose credit top-up</legend>
        <p className="mb-3 text-muted-foreground text-xs">
          Type the hosted inference credit you want to add. Your nixmac subscription includes device syncing
          across Macs.
        </p>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="credit-amount" className="font-medium text-sm">
            Credit amount
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground text-sm">
              $
            </span>
            <input
              id="credit-amount"
              type="number"
              min={paygProduct.minimumAmountUsd}
              max={paygProduct.maximumAmountUsd}
              step={1}
              value={creditAmount}
              onChange={(e) => setCreditAmount(Number(e.target.value))}
              className="w-full rounded-lg border border-input bg-background py-2 pr-3 pl-7 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <p className="text-muted-foreground text-xs">
            {paygProduct.name}
            {paygProductLoaded
              ? ` via Polar PAYG (${paygProduct.currency.toUpperCase()})`
              : " via Polar PAYG"}
            . Minimum ${paygProduct.minimumAmountUsd}
            {paygProduct.maximumAmountUsd ? `, maximum $${paygProduct.maximumAmountUsd}` : ""}.
          </p>
        </div>
        {paygProductLoading ? (
          <p className="mt-2 flex items-center gap-1.5 text-muted-foreground text-xs">
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            Loading Polar PAYG product…
          </p>
        ) : null}
        {paygProductError ? (
          <p className="mt-2 text-destructive text-xs">
            {paygProductError}. Check the billing server connection before continuing.
          </p>
        ) : null}
        {!amountWithinBounds ? (
          <p className="mt-2 text-destructive text-xs">
            Enter an amount between ${paygProduct.minimumAmountUsd}
            {paygProduct.maximumAmountUsd ? ` and $${paygProduct.maximumAmountUsd}` : " or more"}.
          </p>
        ) : null}
      </fieldset>

      <div className="flex flex-col gap-3">
        <p className="flex items-center gap-1.5 font-medium text-sm">
          <CreditCard className="size-4 text-muted-foreground" aria-hidden="true" />
          Checkout
        </p>
        <div className="flex flex-col gap-1.5">
          <p className="text-muted-foreground text-xs">
            We&apos;ll open Polar to collect payment details securely.
          </p>
          <div className="flex gap-2">
            <div className="flex flex-1 flex-col gap-1.5">
              <label htmlFor="billing-zip" className="font-medium text-sm">
                ZIP code
              </label>
              <input
                id="billing-zip"
                value={zipCode}
                onChange={(e) => setZipCode(e.target.value)}
                placeholder="94107"
                autoComplete="postal-code"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <label htmlFor="billing-country" className="font-medium text-sm">
                Country
              </label>
              <select
                id="billing-country"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                autoComplete="country"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="US">United States</option>
                <option value="CA">Canada</option>
                <option value="GB">United Kingdom</option>
                <option value="AU">Australia</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <Button onClick={submitPayment} disabled={!cardReady || working || paygProductLoading}>
        {working ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Opening Polar…
          </>
        ) : (
          <>
            <Lock className="size-4" aria-hidden="true" />
            Add ${creditAmount}
          </>
        )}
      </Button>
      <p className="flex items-center gap-1.5 text-muted-foreground text-xs">
        <ShieldCheck className="size-3.5 text-success" aria-hidden="true" />
        Card details are handled by Polar. ZIP code and country are used for billing.
      </p>
      {checkoutStarted ? (
        <div className="rounded-lg border border-success/30 bg-success/5 p-3">
          <p className="text-muted-foreground text-xs">
            Finish checkout in Polar, then continue once the payment completes.
          </p>
          <Button
            className="mt-2"
            size="sm"
            variant="secondary"
            onClick={() => {
              getTelemetry().captureEvent({
                name: "inference_configured",
                props: { mode: "hosted" },
              });
              onConfigured({ mode: "hosted", email, plan: `${paygProduct.slug}:${creditAmount}` });
            }}
          >
            I completed checkout
          </Button>
        </div>
      ) : null}
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </div>
  );
}

/* ------------------------------- BYOK flow ------------------------------- */

type KeyState = "idle" | "checking" | "invalid" | "valid";

function ByokFlow({ onConfigured }: { onConfigured: (config: InferenceConfig) => void }) {
  const [providerId, setProviderId] = useState(BYOK_PROVIDERS[0].id);
  const provider = useMemo(
    () => BYOK_PROVIDERS.find((p) => p.id === providerId) ?? BYOK_PROVIDERS[0],
    [providerId],
  );
  const [model, setModel] = useState(provider.defaultModel);
  const [key, setKey] = useState("");
  const [keyState, setKeyState] = useState<KeyState>("idle");
  const [serverError, setServerError] = useState("");

  const format = useMemo(() => validateKeyFormat(provider, key), [provider, key]);
  const touched = key.trim().length > 0;

  function changeProvider(id: string) {
    const next = BYOK_PROVIDERS.find((p) => p.id === id) ?? BYOK_PROVIDERS[0];
    setProviderId(next.id);
    setModel(next.defaultModel);
    setKey("");
    setKeyState("idle");
    setServerError("");
  }

  async function verify() {
    if (!format.valid) return;
    setKeyState("checking");
    setServerError("");
    try {
      // Persist the key + provider/model exactly like Settings → AI Models.
      // deprecated(orpc): replace with client/orpc from @/lib/orpc
      await tauriAPI.ui.setPrefs({
        [provider.prefsKeyField]: key.trim(),
        evolveProvider: provider.id,
        evolveModel: model,
      });
      setKeyState("valid");
      getTelemetry().captureEvent({
        name: "inference_configured",
        props: { mode: "byok", provider: provider.id },
      });
      setTimeout(
        () =>
          onConfigured({
            mode: "byok",
            providerId: provider.id,
            providerName: provider.name,
            model,
          }),
        500,
      );
    } catch (e: unknown) {
      setKeyState("invalid");
      const msg = e instanceof Error ? e.message : String(e);
      setServerError(msg);
      getTelemetry().captureError(e instanceof Error ? e : new Error(msg), {
        provider: provider.id,
      });
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="byok-provider" className="font-medium text-sm">
            Provider
          </label>
          <select
            id="byok-provider"
            value={providerId}
            onChange={(e) => changeProvider(e.target.value)}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {BYOK_PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="byok-model" className="font-medium text-sm">
            Model
          </label>
          <select
            id="byok-model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {provider.models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="byok-key" className="font-medium text-sm">
          API key
        </label>
        <div
          className={cn(
            "flex items-center gap-2 rounded-lg border bg-background px-3 py-2 transition-colors focus-within:ring-2 focus-within:ring-ring",
            keyState === "invalid" || (touched && !format.valid)
              ? "border-destructive"
              : keyState === "valid"
                ? "border-success"
                : "border-input",
          )}
        >
          <KeyRound className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            id="byok-key"
            type="password"
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              setKeyState("idle");
              setServerError("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void verify();
            }}
            spellCheck={false}
            autoComplete="off"
            placeholder={provider.keyPlaceholder}
            className="w-full bg-transparent font-mono text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        <div className="min-h-5 text-xs" aria-live="polite">
          {keyState === "valid" ? (
            <span className="flex items-center gap-1.5 text-success">
              <Check className="size-3.5" aria-hidden="true" />
              Key saved for {provider.name}.
            </span>
          ) : serverError ? (
            <span className="flex items-center gap-1.5 text-destructive">
              <TriangleAlert className="size-3.5" aria-hidden="true" />
              {serverError}
            </span>
          ) : touched ? (
            <span
              className={cn(
                "flex items-center gap-1.5",
                format.valid ? "text-muted-foreground" : "text-destructive",
              )}
            >
              {!format.valid ? <TriangleAlert className="size-3.5" aria-hidden="true" /> : null}
              {format.hint}
            </span>
          ) : (
            <span className="text-muted-foreground">
              Find it at {provider.docsHint}. Stored locally in your app preferences.
            </span>
          )}
        </div>
      </div>

      <Button
        onClick={verify}
        disabled={!format.valid || keyState === "checking" || keyState === "valid"}
      >
        {keyState === "checking" ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Saving key…
          </>
        ) : keyState === "valid" ? (
          <>
            <Check className="size-4" aria-hidden="true" />
            Saved
          </>
        ) : (
          "Save & use this key"
        )}
      </Button>
      <p className="flex items-center gap-1.5 text-muted-foreground text-xs">
        <Lock className="size-3.5 text-success" aria-hidden="true" />
        Your key is stored locally on this Mac — never on our servers.
      </p>
    </div>
  );
}
