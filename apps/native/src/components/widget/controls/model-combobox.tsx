"use client";

import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { NIXMAC_PROVIDER } from "@/components/widget/onboarding/lib/inference";
import { suggestedModels } from "@/lib/providers/ai-defaults";
import { providerRequiresModel } from "@/lib/providers/ai-provider-validation";
import {
  Command,
  CommandBareInput,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { tauriAPI } from "@/ipc/api";

/** cmdk item value for the "use the provider default" row (models are their own value). */
const DEFAULT_OPTION_VALUE = "__provider_default__";

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
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  // Text shown in the field while the popover is open (falls back to `value`
  // when closed). Seeded with `value` on open so the field keeps showing the
  // current model.
  const [search, setSearch] = useState("");
  // What the list is filtered by. Kept separate from `search` so the full
  // list shows on open (empty query despite the field showing the value) and
  // selecting an item doesn't re-filter the list while the close animation is
  // still playing.
  const [query, setQuery] = useState("");
  // cmdk's highlighted item, controlled so opening highlights the current
  // selection instead of the first row (Enter must not commit a different
  // model than the one already chosen).
  const [highlighted, setHighlighted] = useState("");
  const anchorRef = useRef<HTMLDivElement>(null);

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

  // Refresh models when popover opens, keeping the current list meanwhile
  useEffect(() => {
    if (open) {
      return loadModels();
    }
  }, [loadModels, open]);

  // Also load models on mount and provider change to have them ready
  useEffect(() => loadModels({ clear: true }), [loadModels]);

  const openPopover = () => {
    if (!open) {
      setSearch(value);
      // Empty query so the full list is visible on open.
      setQuery("");
      setHighlighted(value || DEFAULT_OPTION_VALUE);
      setOpen(true);
    }
  };

  const closePopover = () => {
    if (open) {
      setOpen(false);
      onBlur?.();
    }
  };

  const handleSelect = (selectedValue: string) => {
    // Intentionally leave `query` alone so the list doesn't re-filter
    // mid-close; it gets reset on the next open.
    onChange(selectedValue);
    setSearch(selectedValue);
    setOpen(false);
    onBlur?.();
  };

  // Typing only filters; the value is committed on selection (click or Enter
  // on a list item, including the "Use ..." custom row).
  const handleInputChange = (newValue: string) => {
    setSearch(newValue);
    setQuery(newValue);
    // Typing into the field after a selection reopens the list.
    if (!open) {
      setOpen(true);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (newOpen) {
      openPopover();
    } else {
      closePopover();
    }
  };

  // Filter models based on what the user typed since opening
  const filteredModels = query
    ? models.filter((model) => model.toLowerCase().includes(query.toLowerCase()))
    : models;

  // Show typed text in list if it doesn't match any model
  const showCustomOption = query && !models.some((m) => m.toLowerCase() === query.toLowerCase());

  // An empty model means "use the provider default"; offer it as an explicit
  // option (selecting is the only way to commit a value, including "").
  const showDefaultOption = !query && !providerRequiresModel(provider);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <Command
        className="overflow-visible bg-transparent"
        shouldFilter={false}
        vimBindings={false}
        value={highlighted}
        onValueChange={setHighlighted}
      >
        <PopoverAnchor asChild>
          <div ref={anchorRef} className="relative">
            <CommandBareInput
              className="flex h-9 w-full rounded-md border border-input bg-transparent py-1 pr-8 pl-3 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
              value={open ? search : value}
              onValueChange={handleInputChange}
              onMouseDown={openPopover}
              onFocus={openPopover}
              onBlur={closePopover}
              onKeyDown={(e) => {
                if (open) {
                  return;
                }
                // While closed, cmdk's root handler would swallow these keys
                // even though the list is unmounted; open on arrows and keep
                // native caret behavior for the rest.
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  openPopover();
                } else if (e.key === "Enter" || e.key === "Home" || e.key === "End") {
                  e.stopPropagation();
                }
              }}
              placeholder={placeholder}
              disabled={disabled}
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
              {isLoading ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin opacity-50" />
              ) : (
                <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
              )}
            </span>
          </div>
        </PopoverAnchor>
        <PopoverContent
          className="w-[400px] p-0"
          align="start"
          onOpenAutoFocus={(e) => e.preventDefault()}
          // Keep focus (and the popover) on the input while clicking the list
          onMouseDown={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            if (anchorRef.current?.contains(e.target as Node)) {
              e.preventDefault();
            }
          }}
        >
          <CommandList>
            {isLoading && models.length === 0 ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">Loading models...</span>
              </div>
            ) : filteredModels.length === 0 && !showCustomOption && !showDefaultOption ? (
              <CommandEmpty>
                {models.length === 0
                  ? "No models found. Enter a model name manually."
                  : "No matching models. Press Enter to use custom value."}
              </CommandEmpty>
            ) : (
              <CommandGroup>
                {showDefaultOption && (
                  <CommandItem value={DEFAULT_OPTION_VALUE} onSelect={() => handleSelect("")}>
                    <Check
                      className={cn("mr-2 h-4 w-4", value === "" ? "opacity-100" : "opacity-0")}
                    />
                    <span className="truncate text-muted-foreground">
                      {defaultModel ? `Default: ${defaultModel}` : "Provider default"}
                    </span>
                  </CommandItem>
                )}
                {showCustomOption && (
                  <CommandItem
                    value={query}
                    onSelect={() => handleSelect(query)}
                    className="text-primary"
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === query ? "opacity-100" : "opacity-0",
                      )}
                    />
                    Use "{query}"
                  </CommandItem>
                )}
                {filteredModels.map((model) => (
                  <CommandItem key={model} value={model} onSelect={() => handleSelect(model)}>
                    <Check
                      className={cn("mr-2 h-4 w-4", value === model ? "opacity-100" : "opacity-0")}
                    />
                    <span className="truncate">{model}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </PopoverContent>
      </Command>
    </Popover>
  );
}
