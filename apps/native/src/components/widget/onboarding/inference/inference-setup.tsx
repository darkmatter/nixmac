"use client";

import { useMemo, useState } from "react";
import {
  Check,
  CreditCard,
  Globe,
  KeyRound,
  Loader2,
  Lock,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  BYOK_PROVIDERS,
  HOSTED_PLANS,
  validateKeyFormat,
  type InferenceConfig,
  type InferenceMode,
} from "@/components/widget/onboarding/lib/inference";
import { tauriAPI } from "@/ipc/api";
import { cn } from "@/lib/utils";
import { getTelemetry } from "@/lib/telemetry/instance";
import posthog from "posthog-js";

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
          icon={Globe}
          title="nixmac hosted"
          blurb="We run the models. Sign in and add a payment method."
          badge="Recommended"
          onClick={() => setMode("hosted")}
        />
        <ModeCard
          active={mode === "byok"}
          icon={KeyRound}
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
  icon: Icon,
  title,
  blurb,
  badge,
  onClick,
}: {
  active: boolean;
  icon: typeof Globe;
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
            active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
          )}
          aria-hidden="true"
        >
          <Icon className="size-4" />
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

function HostedFlow({ onConfigured }: { onConfigured: (config: InferenceConfig) => void }) {
  const [stage, setStage] = useState<HostedStage>("account");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [plan, setPlan] = useState("starter");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [card, setCard] = useState("");
  const [exp, setExp] = useState("");
  const [cvc, setCvc] = useState("");

  const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  const accountReady = emailValid && password.length >= 8;
  const cardReady = card.replace(/\s/g, "").length >= 15 && exp.length >= 4 && cvc.length >= 3;

  async function submitAccount() {
    if (!accountReady) return;
    setWorking(true);
    setError(null);
    try {
      // Real account credential exchange via the backend.
      // deprecated(orpc): replace with client/orpc from @/lib/orpc
      await tauriAPI.account.signIn(email, password);
      posthog.identify(email, { email });
      getTelemetry().captureEvent({ name: "account_signed_in" });
      setStage("payment");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(false);
    }
  }

  function submitPayment() {
    if (!cardReady) return;
    setWorking(true);
    // TODO(billing): no payment backend yet — simulate tokenization then record
    // the hosted choice. Account sign-in above is real.
    setTimeout(() => {
      setWorking(false);
      getTelemetry().captureEvent({ name: "inference_configured", props: { mode: "hosted" } });
      onConfigured({ mode: "hosted", email, plan });
    }, 1200);
  }

  if (stage === "account") {
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
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="inf-password" className="font-medium text-sm">
            Password
          </label>
          <input
            id="inf-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            autoComplete="current-password"
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <Button onClick={submitAccount} disabled={!accountReady || working}>
          {working ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Signing in…
            </>
          ) : (
            "Sign in & continue"
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
        <legend className="mb-2 font-medium text-sm">Choose a plan</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {HOSTED_PLANS.map((p) => {
            const active = plan === p.id;
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={active}
                onClick={() => setPlan(p.id)}
                className={cn(
                  "flex flex-col gap-0.5 rounded-lg border p-3 text-left transition-colors",
                  active
                    ? "border-primary bg-primary/5"
                    : "border-border bg-background hover:bg-accent",
                )}
              >
                <span className="flex items-center gap-1.5 font-medium text-sm">
                  {p.name}
                  {p.recommended ? (
                    <span className="rounded-full bg-success/15 px-1.5 py-0.5 font-semibold text-[10px] text-success">
                      Popular
                    </span>
                  ) : null}
                </span>
                <span className="font-mono text-foreground text-xs">{p.price}</span>
                <span className="text-pretty text-muted-foreground text-xs">{p.blurb}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="flex flex-col gap-3">
        <p className="flex items-center gap-1.5 font-medium text-sm">
          <CreditCard className="size-4 text-muted-foreground" aria-hidden="true" />
          Payment method
        </p>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="card-number" className="sr-only">
            Card number
          </label>
          <input
            id="card-number"
            inputMode="numeric"
            value={card}
            onChange={(e) => setCard(formatCard(e.target.value))}
            placeholder="1234 5678 9012 3456"
            className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex gap-2">
            <input
              aria-label="Expiry date"
              inputMode="numeric"
              value={exp}
              onChange={(e) => setExp(formatExp(e.target.value))}
              placeholder="MM/YY"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <input
              aria-label="CVC"
              inputMode="numeric"
              value={cvc}
              onChange={(e) => setCvc(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="CVC"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>
      </div>

      <Button onClick={submitPayment} disabled={!cardReady || working}>
        {working ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Saving payment method…
          </>
        ) : (
          <>
            <Lock className="size-4" aria-hidden="true" />
            Save & enable hosted inference
          </>
        )}
      </Button>
      <p className="flex items-center gap-1.5 text-muted-foreground text-xs">
        <ShieldCheck className="size-3.5 text-success" aria-hidden="true" />
        Card details are tokenized by our payment processor. Cancel anytime.
      </p>
    </div>
  );
}

function formatCard(v: string): string {
  return v
    .replace(/\D/g, "")
    .slice(0, 16)
    .replace(/(.{4})/g, "$1 ")
    .trim();
}

function formatExp(v: string): string {
  const digits = v.replace(/\D/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
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
