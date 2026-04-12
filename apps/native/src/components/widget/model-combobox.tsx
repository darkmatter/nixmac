"use client";

import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { darwinAPI } from "@/tauri-api";

interface ModelComboboxProps {
  provider: "openai" | "ollama" | "vllm" | "opencode";
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
  console.log("Fetching Ollama models with base URL:", baseUrl);
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

export function ModelCombobox({
  provider,
  value,
  onChange,
  onBlur,
  placeholder = "Select model...",
  disabled = false,
}: ModelComboboxProps) {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [inputValue, setInputValue] = useState(value);

  // Sync input value with external value
  useEffect(() => {
    setInputValue(value);
  }, [value]);

  const loadModels = useCallback(async () => {
    setIsLoading(true);

    // Clear current list immediately when loading to avoid showing stale models
    setModels([]);

    // First try to load from cache
    try {
      const cached = await darwinAPI.models.getCached(provider);
      if (cached && cached.length > 0) {
        setModels(cached);
      }
    } catch {
      // Ignore cache errors
    }

    // Then fetch fresh models
    try {
      let freshModels: string[] = [];

      if (provider === "openai") {
        freshModels = await fetchOpenRouterModels();
      } else if (provider === "ollama") {
        const prefs = await darwinAPI.ui.getPrefs();
        const baseUrl = prefs?.ollamaApiBaseUrl || undefined;
        freshModels = await fetchOllamaModels(baseUrl);
      } else if (provider === "opencode") {
        freshModels = await darwinAPI.cli.listModels("opencode");
      }

      // Update the models list with fresh results (only if we got any, to avoid wiping the cache-populated list)
      if (freshModels.length > 0) {
        setModels(freshModels);
      }

      // Cache the models when we got any
      if (freshModels.length > 0) {
        try {
          await darwinAPI.models.setCached(provider, freshModels);
        } catch {
          // Ignore cache errors
        }
      }
    } catch {
      // We'll use cached models or empty list
      toast.error(`Failed to fetch models for ${provider}`);
    }

    setIsLoading(false);
  }, [provider]);

  // Load models when popover opens
  useEffect(() => {
    if (open) {
      loadModels();
    }
  }, [open, loadModels]);

  // Also load models on mount to have them ready
  useEffect(() => {
    loadModels();
  }, [loadModels]);

  const handleSelect = (selectedValue: string) => {
    onChange(selectedValue);
    setInputValue(selectedValue);
    setOpen(false);
    onBlur?.();
  };

  const handleInputChange = (newValue: string) => {
    setInputValue(newValue);
    onChange(newValue);
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      onBlur?.();
    }
  };

  // Filter models based on input
  const filteredModels = models.filter((model) =>
    model.toLowerCase().includes(inputValue.toLowerCase()),
  );

  // Show input value in list if it doesn't match any model
  const showCustomOption =
    inputValue && !models.some((m) => m.toLowerCase() === inputValue.toLowerCase());

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
          disabled={disabled}
        >
          <span className="truncate">{inputValue || placeholder}</span>
          {isLoading ? (
            <Loader2 className="ml-2 h-4 w-4 shrink-0 animate-spin opacity-50" />
          ) : (
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search or enter model..."
            value={inputValue}
            onValueChange={handleInputChange}
          />
          <CommandList>
            {isLoading && models.length === 0 ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">Loading models...</span>
              </div>
            ) : filteredModels.length === 0 && !showCustomOption ? (
              <CommandEmpty>
                {models.length === 0
                  ? "No models found. Enter a model name manually."
                  : "No matching models. Press Enter to use custom value."}
              </CommandEmpty>
            ) : (
              <CommandGroup>
                {showCustomOption && (
                  <CommandItem
                    value={inputValue}
                    onSelect={() => handleSelect(inputValue)}
                    className="text-primary"
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === inputValue ? "opacity-100" : "opacity-0",
                      )}
                    />
                    Use "{inputValue}"
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
        </Command>
      </PopoverContent>
    </Popover>
  );
}
