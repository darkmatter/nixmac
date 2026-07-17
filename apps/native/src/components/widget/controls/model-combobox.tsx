"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Combobox } from "@/components/ui/combobox";
import { NIXMAC_PROVIDER } from "@/components/widget/onboarding/lib/inference";
import { suggestedModels } from "@/lib/providers/ai-defaults";
import { providerRequiresModel } from "@/lib/providers/ai-provider-validation";
import { tauriAPI } from "@/ipc/api";

interface ModelComboboxProps {
  provider: "nixmac" | "openrouter" | "openai" | "ollama" | "openai_compatible" | "opencode";
  /** Model the provider falls back to when the value is empty; labels the "default" option. Empty when the runtime (e.g. a CLI) picks its own default. */
  defaultModel: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  disabled?: boolean;
}

interface OpenRouterModel {
  id: string;
  name: string;
}

interface OllamaModel {
  name: string;
}

interface OpenAiCompatibleModel {
  id: string;
}

async function fetchOpenRouterModels(): Promise<string[]> {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      method: "GET",
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    const models: OpenRouterModel[] = data.data || [];

    // Sort by name and return IDs
    return models.map((m) => m.id).sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

async function fetchOllamaModels(baseUrl?: string): Promise<string[]> {
  const base = (baseUrl || "http://localhost:11434").replace(/\/$/, "");
  try {
    const response = await fetch(`${base}/api/tags`, {
      method: "GET",
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    const models: OllamaModel[] = data.models || [];

    return models.map((m) => m.name).sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

async function fetchOpenAiCompatibleModels(
  baseUrl?: string | null,
  apiKey?: string | null,
): Promise<string[]> {
  if (!baseUrl?.trim()) {
    return [];
  }

  const base = baseUrl.trim().replace(/\/$/, "");
  try {
    const headers: Record<string, string> = {};
    if (apiKey?.trim()) {
      headers.Authorization = `Bearer ${apiKey.trim()}`;
    }

    const response = await fetch(`${base}/models`, {
      headers,
      method: "GET",
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    const models: OpenAiCompatibleModel[] = data.data || [];

    return models.map((m) => m.id).sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

type ModelProvider = ModelComboboxProps["provider"];

async function fetchFreshModels(provider: ModelProvider): Promise<string[]> {
  if (provider === NIXMAC_PROVIDER) {
    return suggestedModels(NIXMAC_PROVIDER);
  }
  if (provider === "openrouter") {
    return fetchOpenRouterModels();
  }
  if (provider === "openai") {
    return suggestedModels("openai");
  }
  if (provider === "ollama") {
    // deprecated(orpc): replace with client/orpc from @/lib/orpc
    const prefs = await tauriAPI.ui.getPrefs();
    const baseUrl = prefs?.ollamaApiBaseUrl || undefined;
    return fetchOllamaModels(baseUrl);
  }
  if (provider === "openai_compatible") {
    // deprecated(orpc): replace with client/orpc from @/lib/orpc
    const prefs = await tauriAPI.ui.getPrefs();
    return fetchOpenAiCompatibleModels(prefs?.openaiCompatibleApiBaseUrl, prefs?.openaiCompatibleApiKey);
  }
  if (provider === "opencode") {
    // deprecated(orpc): replace with client/orpc from @/lib/orpc
    return tauriAPI.cli.listModels("opencode");
  }
  return [];
}

async function loadProviderModels(
  provider: ModelProvider,
  applyModels: (models: string[]) => void,
) {
  if (provider === "openai") {
    applyModels(suggestedModels("openai"));
    return;
  }
  if (provider === NIXMAC_PROVIDER) {
    applyModels(suggestedModels(NIXMAC_PROVIDER));
    return;
  }

  // First try to load from cache
  try {
    // deprecated(orpc): replace with client/orpc from @/lib/orpc
    const cached = await tauriAPI.models.getCached(provider);
    if (cached && cached.length > 0) {
      applyModels(cached);
    }
  } catch {
    // Ignore cache errors
  }

  // Then fetch fresh models
  try {
    const freshModels = await fetchFreshModels(provider);

    // Update the models list with fresh results (only if we got any, to avoid wiping the cache-populated list)
    if (freshModels.length > 0) {
      applyModels(freshModels);
    }

    // Cache the models when we got any
    if (freshModels.length > 0) {
      try {
        // deprecated(orpc): replace with client/orpc from @/lib/orpc
        await tauriAPI.models.setCached(provider, freshModels);
      } catch {
        // Ignore cache errors
      }
    }
  } catch {
    // We'll use cached models or empty list
    toast.error(`Failed to fetch models for ${provider}`);
  }
}

export function ModelCombobox({
  provider,
  defaultModel,
  value,
  onChange,
  onBlur,
  placeholder = "Select model...",
  disabled = false,
}: ModelComboboxProps) {
  const [models, setModels] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  const loadModels = useCallback((options?: { clear?: boolean }) => {
    let cancelled = false;

    setIsLoading(true);

    // Clear only when the provider changed (its models are wrong for the new
    // one). On refreshes keep the current list: async remove/re-add of the
    // items makes cmdk re-highlight and re-focus, which WebKit answers by
    // collapsing the caret to the start when it lands mid-click.
    if (options?.clear) {
      setModels([]);
    }

    loadProviderModels(provider, (nextModels) => {
      if (!cancelled) {
        // Keep the previous array when the content is unchanged so the items
        // don't re-render (and cmdk doesn't re-register them) on every open.
        setModels((prev) =>
          prev.length === nextModels.length && prev.every((m, i) => m === nextModels[i])
            ? prev
            : nextModels,
        );
      }
    }).finally(() => {
      if (!cancelled) {
        setIsLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [provider]);

  // Refresh models when the popover opens, keeping the current list meanwhile
  useEffect(() => {
    if (refreshTick > 0) {
      return loadModels();
    }
  }, [loadModels, refreshTick]);

  // Also load models on mount and provider change to have them ready
  useEffect(() => loadModels({ clear: true }), [loadModels]);

  return (
    <Combobox
      items={models}
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      onOpenChange={(open) => {
        if (open) {
          setRefreshTick((tick) => tick + 1);
        }
      }}
      placeholder={placeholder}
      disabled={disabled}
      isLoading={isLoading}
      allowCustomValue
      emptyValueLabel={
        providerRequiresModel(provider)
          ? undefined
          : defaultModel
            ? `Default: ${defaultModel}`
            : "Provider default"
      }
      emptyMessage="No models found. Enter a model name manually."
      loadingMessage="Loading models..."
    />
  );
}
