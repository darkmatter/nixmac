import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { hasConfiguredAiProvider } from "@/hooks/use-prefs";
import { tauriAPI } from "@/ipc/api";
import type { CliToolsState } from "@/ipc/types";
import { getProviderConfigInvalidReason, isCliProvider } from "@/lib/ai-provider-validation";
import { verifyOpenrouterApiKey } from "@/lib/openrouter-key-validation";
import { useWidgetStore } from "@/stores/widget-store";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

type Provider = "openrouter" | "ollama" | "vllm" | "claude" | "codex" | "opencode";
type SaveStatus = "idle" | "saving" | "ready" | "skipped";
type CliCheckState = "checking" | "ready" | "failed";

const PROVIDERS: Array<{ value: Provider; label: string }> = [
  { value: "openrouter", label: "OpenRouter" },
  { value: "ollama", label: "Ollama" },
  { value: "vllm", label: "OpenAI Compatible" },
  { value: "claude", label: "Claude CLI" },
  { value: "codex", label: "Codex CLI" },
  { value: "opencode", label: "OpenCode CLI" },
];

const DEFAULT_EVOLVE_MODEL: Record<Provider, string> = {
  openrouter: "anthropic/claude-sonnet-4",
  ollama: "",
  vllm: "gpt-oss-120b",
  claude: "",
  codex: "",
  opencode: "",
};

const DEFAULT_SUMMARY_MODEL: Record<Provider, string> = {
  openrouter: "openai/gpt-4o-mini",
  ollama: "",
  vllm: "gpt-oss-120b",
  claude: "",
  codex: "",
  opencode: "",
};

function summaryModelFor(provider: Provider, model: string): string {
  if (provider === "ollama" || provider === "vllm") {
    return model.trim();
  }
  return DEFAULT_SUMMARY_MODEL[provider];
}

export function AiProviderSetup() {
  const setAiProviderOnboardingComplete = useWidgetStore(
    (state) => state.setAiProviderOnboardingComplete,
  );
  const setSettingsOpen = useWidgetStore((state) => state.setSettingsOpen);
  const settingsOpen = useWidgetStore((state) => state.settingsOpen);
  const [provider, setProvider] = useState<Provider>("openrouter");
  const [openrouterApiKey, setOpenrouterApiKey] = useState("");
  const [vllmApiBaseUrl, setVllmApiBaseUrl] = useState("");
  const [vllmApiKey, setVllmApiKey] = useState("");
  const [model, setModel] = useState(DEFAULT_EVOLVE_MODEL.openrouter);
  const [cliStatus, setCliStatus] = useState<CliToolsState | null>(null);
  const [cliCheckState, setCliCheckState] = useState<CliCheckState>("checking");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const openedSettingsRef = useRef(false);

  useEffect(() => {
    tauriAPI.cli
      .checkTools()
      .then((tools) => {
        setCliStatus(tools);
        setCliCheckState("ready");
      })
      .catch(() => {
        setCliStatus(null);
        setCliCheckState("failed");
      });
  }, []);

  useEffect(() => {
    if (settingsOpen) {
      openedSettingsRef.current = true;
      return;
    }

    if (!openedSettingsRef.current) {
      return;
    }

    openedSettingsRef.current = false;
    let cancelled = false;

    tauriAPI.ui
      .getPrefs()
      .then((prefs) => {
        if (cancelled || !hasConfiguredAiProvider(prefs)) {
          return;
        }

        setSaveStatus("ready");
        setError(null);
        setAiProviderOnboardingComplete(true);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [settingsOpen, setAiProviderOnboardingComplete]);

  const providerPrefs = useMemo(
    () => ({
      openrouterApiKey,
      openaiApiKey: "",
      vllmApiBaseUrl,
    }),
    [openrouterApiKey, vllmApiBaseUrl],
  );
  const isCheckingCliProvider = isCliProvider(provider) && cliCheckState === "checking";
  const cliValidationError =
    isCheckingCliProvider
      ? "Checking CLI tool availability..."
      : isCliProvider(provider) && cliCheckState === "failed"
        ? "Could not check CLI tools. Try again or use Advanced settings."
        : null;
  const validationError =
    cliValidationError ??
    getProviderConfigInvalidReason(provider, providerPrefs, cliStatus, model);

  const invalidateProviderDecision = () => {
    setSaveStatus("idle");
    setError(null);
    if (saveStatus === "ready" || saveStatus === "skipped") {
      setAiProviderOnboardingComplete(false);
    }
  };

  const handleProviderChange = (value: string) => {
    const nextProvider = value as Provider;
    setProvider(nextProvider);
    setModel(DEFAULT_EVOLVE_MODEL[nextProvider]);
    invalidateProviderDecision();
  };

  const handleSkip = async () => {
    setSaveStatus("saving");
    setError(null);
    try {
      await tauriAPI.ui.setPrefs({ aiProviderOnboardingSkipped: true });
      setSaveStatus("skipped");
      setAiProviderOnboardingComplete(true);
    } catch {
      setSaveStatus("idle");
      setError("Could not save your choice. Please try again.");
    }
  };

  const handleSave = async () => {
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaveStatus("saving");
    setError(null);

    if (provider === "openrouter") {
      const verification = await verifyOpenrouterApiKey(openrouterApiKey.trim());
      if (!verification.ok) {
        setSaveStatus("idle");
        setError(
          verification.reason === "invalid"
            ? "Invalid API key. Please check and try again."
            : "Could not verify the key. Check your connection or skip for now.",
        );
        return;
      }
    }

    const trimmedModel = model.trim();
    try {
      await tauriAPI.ui.setPrefs({
        ...(provider === "openrouter" ? { openrouterApiKey: openrouterApiKey.trim() } : {}),
        ...(provider === "vllm"
          ? { vllmApiBaseUrl: vllmApiBaseUrl.trim(), vllmApiKey: vllmApiKey.trim() }
          : {}),
        evolveProvider: provider,
        evolveModel: trimmedModel || DEFAULT_EVOLVE_MODEL[provider],
        summaryProvider: provider,
        summaryModel: summaryModelFor(provider, trimmedModel),
        aiProviderOnboardingSkipped: false,
      });
      setSaveStatus("ready");
      setAiProviderOnboardingComplete(true);
    } catch {
      setSaveStatus("idle");
      setError("Could not save provider settings. Please try again.");
    }
  };

  const modelLabel = isCliProvider(provider) ? "Model name (optional)" : "Model name";
  const showModelInput = provider !== "openrouter";

  return (
    <div className="w-full max-w-sm space-y-3">
      <div className="space-y-1">
        <h3 className="font-medium text-foreground text-sm">3. AI Provider</h3>
        <p className="text-muted-foreground text-xs">
          nixmac uses an AI provider to plan and summarize config changes.
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-muted-foreground text-xs font-medium" htmlFor="onboardingProvider">
          Provider
        </label>
        <Select onValueChange={handleProviderChange} value={provider}>
          <SelectTrigger className="w-full" id="onboardingProvider">
            <SelectValue placeholder="Select provider" />
          </SelectTrigger>
          <SelectContent>
            {PROVIDERS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {provider === "openrouter" && (
        <div className="space-y-2">
          <label
            className="text-muted-foreground text-xs font-medium"
            htmlFor="onboardingOpenrouterKey"
          >
            OpenRouter API key
          </label>
          <Input
            id="onboardingOpenrouterKey"
            onChange={(event) => {
              setOpenrouterApiKey(event.target.value);
              invalidateProviderDecision();
            }}
            placeholder="sk-or-..."
            type="password"
            value={openrouterApiKey}
          />
        </div>
      )}

      {provider === "vllm" && (
        <>
          <div className="space-y-2">
            <label
              className="text-muted-foreground text-xs font-medium"
              htmlFor="onboardingVllmBaseUrl"
            >
              API base URL
            </label>
            <Input
              id="onboardingVllmBaseUrl"
              onChange={(event) => {
                setVllmApiBaseUrl(event.target.value);
                invalidateProviderDecision();
              }}
              placeholder="http://localhost:8000/v1"
              value={vllmApiBaseUrl}
            />
          </div>
          <div className="space-y-2">
            <label
              className="text-muted-foreground text-xs font-medium"
              htmlFor="onboardingVllmApiKey"
            >
              API key (optional)
            </label>
            <Input
              id="onboardingVllmApiKey"
              onChange={(event) => {
                setVllmApiKey(event.target.value);
                invalidateProviderDecision();
              }}
              placeholder="sk-..."
              type="password"
              value={vllmApiKey}
            />
          </div>
        </>
      )}

      {showModelInput && (
        <div className="space-y-2">
          <label className="text-muted-foreground text-xs font-medium" htmlFor="onboardingModel">
            {modelLabel}
          </label>
          <Input
            id="onboardingModel"
            onChange={(event) => {
              setModel(event.target.value);
              invalidateProviderDecision();
            }}
            placeholder={provider === "ollama" ? "llama3.1" : DEFAULT_EVOLVE_MODEL[provider]}
            value={model}
          />
        </div>
      )}

      {saveStatus === "ready" && (
        <p className="flex items-center gap-1 text-emerald-600 text-xs">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Provider ready.
        </p>
      )}
      {saveStatus === "skipped" && (
        <p className="text-muted-foreground text-xs">
          AI changes will stay disabled until you add a provider in Settings.
        </p>
      )}
      {error && saveStatus !== "ready" && saveStatus !== "skipped" && (
        <p className="text-destructive text-xs">{error}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={saveStatus === "saving" || isCheckingCliProvider}
          onClick={handleSave}
          size="sm"
          type="button"
        >
          {saveStatus === "saving" && <Loader2 className="h-4 w-4 animate-spin" />}
          Save provider
        </Button>
        <Button onClick={handleSkip} size="sm" type="button" variant="secondary">
          Skip for now
        </Button>
        <Button
          onClick={() => setSettingsOpen(true, provider === "openrouter" ? "api-keys" : "ai-models")}
          size="sm"
          type="button"
          variant="ghost"
        >
          Advanced settings
        </Button>
      </div>
    </div>
  );
}
