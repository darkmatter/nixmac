"use client";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ModelCombobox } from "@/components/widget/controls/model-combobox";
import { ProviderIcon } from "@/components/widget/controls/provider-icons/provider-icon";
import {
  BYOK_PROVIDERS,
  DEFAULT_NIXMAC_MODEL,
  NIXMAC_PROVIDER,
  validateKeyFormat,
  type CheckoutProduct,
  type InferenceConfig,
  type InferenceMode,
} from "@/components/widget/onboarding/lib/inference";
import { tauriAPI } from "@/ipc/api";
import type { AccountBilling, BillingProductInfo } from "@/lib/orpc";
import { client, orpc } from "@/lib/orpc";
import { getTelemetry } from "@/lib/telemetry/instance";
import { cn } from "@/lib/utils";
import NixmacIcon from "@nixmac/ui/components/icon";
import { useQuery } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-shell";
import {
  Check,
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
          blurb="We run the models. Sign in and choose hosted billing."
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

const PAYG_HIGHLIGHTS = [
  "Pay only for the model usage you consume",
  "Monthly metered billing through Polar",
  "Use hosted inference across supported models",
];

const PRO_HIGHLIGHTS = [
  "Pay only for the model usage you consume",
  "Device sync for keeping configurations in step",
  "Built for users managing more than one Mac",
];

const PAYG_SUBSCRIPTION_SLUG = "payg-tokens";
const PRO_SUBSCRIPTION_SLUG = "pro";

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

function formatUsd(amount: number): string {
  return amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function planLabel(slug: string): string {
  return slug === "pro" ? "Pro" : "Pay as you go";
}

function priceLabelFor(product: BillingProductInfo | undefined, fallback: string): string {
  if (!product) {
    return fallback;
  }
  if (product.type === "subscription" && typeof product.priceUsd === "number") {
    const interval = product.recurringInterval === "year" ? "/yr" : "/mo";
    const amount = Number.isInteger(product.priceUsd)
      ? `${product.priceUsd}`
      : formatUsd(product.priceUsd);
    return `$${amount}${interval}`;
  }
  return fallback;
}

function hasSubscription(billing: AccountBilling | null | undefined, slug: string): boolean {
  return billing?.subscriptions.some((subscription) => subscription.slug === slug) ?? false;
}

function hasPaygSubscription(billing: AccountBilling | null | undefined): boolean {
  return hasSubscription(billing, PAYG_SUBSCRIPTION_SLUG);
}

function hasProSubscription(billing: AccountBilling | null | undefined): boolean {
  return hasSubscription(billing, PRO_SUBSCRIPTION_SLUG);
}

function hasRequiredSubscriptions(
  billing: AccountBilling | null | undefined,
  selectedPlan: CheckoutProduct,
): boolean {
  if (selectedPlan === "credits") {
    return hasPaygSubscription(billing) || hasProSubscription(billing);
  }
  return hasProSubscription(billing);
}

function nextCheckoutProduct(
  billing: AccountBilling | null | undefined,
  selectedPlan: CheckoutProduct,
): CheckoutProduct | null {
  if (selectedPlan === "pro") {
    return hasProSubscription(billing) ? null : "pro";
  }
  return hasPaygSubscription(billing) || hasProSubscription(billing) ? null : "credits";
}

function checkoutButtonLabel(product: CheckoutProduct | null): string {
  if (!product) {
    return "Subscription active";
  }
  return `Subscribe to ${planLabel(product)}`;
}

function configuredPlanSuffix(
  billing: AccountBilling | null | undefined,
): string {
  if (hasProSubscription(billing)) {
    return PRO_SUBSCRIPTION_SLUG;
  }
  return hasPaygSubscription(billing) ? PAYG_SUBSCRIPTION_SLUG : "subscribed";
}

function activeBillingLabel(billing: AccountBilling | null | undefined): string | null {
  if (hasProSubscription(billing)) {
    return "Pro";
  }
  if (hasPaygSubscription(billing)) {
    return "Pay as you go";
  }
  return null;
}

function HostedFlow({ onConfigured }: { onConfigured: (config: InferenceConfig) => void }) {
  const [stage, setStage] = useState<HostedStage>("account");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<CheckoutProduct>("credits");
  const [checkoutStarted, setCheckoutStarted] = useState(false);
  const [planChooserExpanded, setPlanChooserExpanded] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const billingQuery = useQuery(
    orpc.billing.state.queryOptions({ enabled: stage === "payment" }),
  );
  const billing = billingQuery.data ?? null;
  const billingLoading = billingQuery.isLoading;
  const billingError = billingQuery.error ? errorMessage(billingQuery.error) : null;

  // Public, stable catalog — safe to cache to disk so prices show instantly on
  // next launch. (billing.state is account-specific and intentionally not persisted.)
  const productsQuery = useQuery(
    orpc.billing.products.queryOptions({ meta: { persist: true } }),
  );
  const products = productsQuery.data ?? null;

  const normalizedEmail = email.trim();
  const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail);
  const accountReady = emailValid && (!otpSent || otp.trim().length > 0);
  const canContinueWithPlan = hasRequiredSubscriptions(billing, selectedPlan);
  const checkoutProduct = nextCheckoutProduct(billing, selectedPlan);
  const proPlan = products?.find((plan) => plan.product === "pro");
  const creditsPlan = products?.find((plan) => plan.product === "credits");
  const activePlanLabel = activeBillingLabel(billing);
  const showPlanChooser = !activePlanLabel || planChooserExpanded;

  function selectPlan(plan: CheckoutProduct) {
    setSelectedPlan(plan);
    setCheckoutStarted(false);
    setError(null);
  }

  async function finishHostedSetup(planSuffix: string) {
    await tauriAPI.ui.setPrefs({
      evolveProvider: NIXMAC_PROVIDER,
      evolveModel: DEFAULT_NIXMAC_MODEL,
      summaryProvider: NIXMAC_PROVIDER,
      summaryModel: DEFAULT_NIXMAC_MODEL,
    });
    getTelemetry().captureEvent({
      name: "inference_configured",
      props: { mode: "hosted" },
    });
    onConfigured({ mode: "hosted", email, plan: planSuffix });
  }

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
      .catch(() => { });
    return () => {
      cancelled = true;
    };
  }, []);

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

  async function continueWithSubscription() {
    if (!canContinueWithPlan) return;
    setWorking(true);
    setError(null);
    try {
      await finishHostedSetup(configuredPlanSuffix(billing));
    } catch (e: unknown) {
      setError(errorMessage(e));
    } finally {
      setWorking(false);
    }
  }

  async function startCheckout() {
    if (!checkoutProduct) return;
    setWorking(true);
    setError(null);
    try {
      const { url } = await client.billing.checkout({ product: checkoutProduct });
      await openExternal(url);
      setCheckoutStarted(true);
    } catch (e: unknown) {
      setError(errorMessage(e));
    } finally {
      setWorking(false);
    }
  }

  async function refreshBillingAfterCheckout() {
    setWorking(true);
    setError(null);
    try {
      const { data: snapshot } = await billingQuery.refetch();
      if (hasRequiredSubscriptions(snapshot, selectedPlan)) {
        await finishHostedSetup(configuredPlanSuffix(snapshot));
        return;
      }
      const nextProduct = nextCheckoutProduct(snapshot, selectedPlan);
      setError(
        nextProduct === "pro"
          ? "Pro subscription not active yet. Finish checkout in Polar, then try again."
          : "Subscription not active yet. Finish checkout in Polar, then try again.",
      );
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

      {billingLoading ? (
        <p className="flex items-center gap-1.5 text-muted-foreground text-xs">
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          Loading billing status…
        </p>
      ) : billingError ? (
        <p className="text-destructive text-xs">{billingError}</p>
      ) : null}
      {activePlanLabel ? (
        <>
          <div className="rounded-lg border border-success/30 bg-success/5 px-3 py-2 text-xs">
            <p className="text-success">
              Active billing: <span className="font-medium">{activePlanLabel}</span>
            </p>
          </div>
          {!showPlanChooser ? (
            <button
              type="button"
              onClick={() => setPlanChooserExpanded(true)}
              className="mt-0 font-medium text-primary hover:underline text-xs text-left underline"
            >
              Change plan
            </button>
          ) : null}
        </>
      ) : null}

      {showPlanChooser ? (
        <fieldset>
          <legend className="mb-2 font-medium text-sm">Choose a plan</legend>
          <p className="mb-3 text-muted-foreground text-xs">
            Pay as you go enables metered hosted inference. Pro includes hosted inference and
            adds device sync across Macs.
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <PlanCard
              active={selectedPlan === "credits"}
              title="Pay as you go"
              priceLabel={priceLabelFor(creditsPlan, "Metered")}
              status={hasPaygSubscription(billing) ? "Active" : undefined}
              highlights={PAYG_HIGHLIGHTS}
              onClick={() => selectPlan("credits")}
            />
            <PlanCard
              active={selectedPlan === "pro"}
              title="Pro"
              priceLabel={priceLabelFor(proPlan, "Monthly")}
              badge="Device sync"
              status={hasProSubscription(billing) ? "Active" : undefined}
              highlights={PRO_HIGHLIGHTS}
              onClick={() => selectPlan("pro")}
            />
          </div>
        </fieldset>
      ) : null}

      {canContinueWithPlan ? (
        <Button variant="secondary" onClick={() => void continueWithSubscription()} disabled={working}>
          {working ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Continuing…
            </>
          ) : (
            `Continue with ${planLabel(configuredPlanSuffix(billing))}`
          )}
        </Button>
      ) : (
        <>
          <Button
            onClick={() => void startCheckout()}
            disabled={working || billingLoading || !checkoutProduct}
          >
            {working ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Opening Polar…
              </>
            ) : (
              <>
                <Lock className="size-4" aria-hidden="true" />
                {checkoutButtonLabel(checkoutProduct)}
              </>
            )}
          </Button>
          <p className="flex items-center gap-1.5 text-muted-foreground text-xs">
            <ShieldCheck className="size-3.5 text-success" aria-hidden="true" />
            Payment details are handled securely by Polar.
          </p>
          {checkoutStarted ? (
            <div className="rounded-lg border border-success/30 bg-success/5 p-3">
              <p className="text-muted-foreground text-xs">
                Finish checkout in Polar, then continue once the required subscription is active.
              </p>
              <Button
                className="mt-2"
                size="sm"
                variant="secondary"
                onClick={() => void refreshBillingAfterCheckout()}
                disabled={working}
              >
                I completed checkout
              </Button>
            </div>
          ) : null}
        </>
      )}
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </div>
  );
}

function PlanCard({
  active,
  title,
  priceLabel,
  badge,
  status,
  highlights,
  onClick,
}: {
  active: boolean;
  title: string;
  priceLabel: string;
  badge?: string;
  status?: string;
  highlights: string[];
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col gap-2 rounded-xl border p-4 text-left transition-colors",
        active ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-accent",
      )}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-sm">{title}</span>
          {badge ? (
            <span className="rounded-full bg-success/15 px-1.5 py-0.5 font-semibold text-[10px] text-success">
              {badge}
            </span>
          ) : null}
          {status ? (
            <span className="rounded-full bg-primary/15 px-1.5 py-0.5 font-semibold text-[10px] text-primary">
              {status}
            </span>
          ) : null}
        </span>
        <span className="shrink-0 font-bold text-lg">{priceLabel}</span>
      </span>
      <ul className="flex flex-col gap-1 text-muted-foreground text-xs">
        {highlights.map((highlight) => (
          <li key={highlight} className="flex items-start gap-1.5">
            <Check className="mt-0.5 size-3 shrink-0 text-success" aria-hidden="true" />
            <span>{highlight}</span>
          </li>
        ))}
      </ul>
    </button>
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

  async function changeProvider(id: string) {
    const next = BYOK_PROVIDERS.find((p) => p.id === id) ?? BYOK_PROVIDERS[0];
    await tauriAPI.models.clearCached(next.id);
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
          <Select value={providerId} onValueChange={(id) => void changeProvider(id)}>
            <SelectTrigger id="byok-provider" className="w-full font-normal">
              <SelectValue placeholder="Select provider" />
            </SelectTrigger>
            <SelectContent>
              {BYOK_PROVIDERS.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  <span className="flex items-center gap-2">
                    <ProviderIcon provider={p.id} size={14} />
                    {p.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="font-medium text-sm">Model</span>
          <ModelCombobox
            provider={provider.id}
            value={model}
            onChange={setModel}
            placeholder={provider.defaultModel}
          />
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
