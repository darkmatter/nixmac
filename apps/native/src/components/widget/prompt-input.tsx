"use client";

import { BadgeButton } from "@/components/ui/badge-button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { BeginEvolveWarning } from "@/components/widget/begin-evolve-warning";
import { MacRecommendationChip } from "@/components/widget/mac-recommendation-chip";
import { PromptHistoryBadge } from "@/components/widget/prompt-history-badge";
import { SystemDefaultsCTA } from "@/components/widget/system-defaults-cta";
import { useEvolve } from "@/hooks/use-evolve";
import { getProviderConfigInvalidReason } from "@/lib/ai-provider-validation";
import { useWidgetStore } from "@/stores/widget-store";
import { darwinAPI } from "@/tauri-api";
import { ArrowUpIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const MAX_CONTEXT_LENGTH = 1000;

const STATIC_SUGGESTIONS = ["Install vim", "Add Rectangle app"];

export function PromptInput() {
  const evolvePrompt = useWidgetStore((s) => s.evolvePrompt);
  const setEvolvePrompt = useWidgetStore((s) => s.setEvolvePrompt);
  const isProcessing = useWidgetStore((s) => s.isProcessing);
  const processingAction = useWidgetStore((s) => s.processingAction);
  const evolveState = useWidgetStore((s) => s.evolveState);
  const gitStatus = useWidgetStore((s) => s.gitStatus);
  const settingsOpen = useWidgetStore((s) => s.settingsOpen);
  const setSettingsOpen = useWidgetStore((s) => s.setSettingsOpen);
  const { handleEvolve, evolveFromManual } = useEvolve();
  const [warningOpen, setWarningOpen] = useState(false);
  const [providerErrors, setProviderErrors] = useState<{ evolve: string | null; summary: string | null }>({
    evolve: null,
    summary: null,
  });

  useEffect(() => {
    let cancelled = false;

    const refreshProviderValidation = async () => {
      try {
        const [prefs, cliStatus] = await Promise.all([
          darwinAPI.ui.getPrefs(),
          darwinAPI.cli.checkTools(),
        ]);

        const evolveProvider = prefs?.evolveProvider ?? "openai";
        const summaryProvider = prefs?.summaryProvider ?? "openai";
        const normalizedPrefs = {
          openrouterApiKey: prefs?.openrouterApiKey ?? "",
          openaiApiKey: prefs?.openaiApiKey ?? "",
          vllmApiBaseUrl: prefs?.vllmApiBaseUrl ?? "",
        };

        if (!cancelled) {
          setProviderErrors({
            evolve: getProviderConfigInvalidReason(evolveProvider, normalizedPrefs, cliStatus),
            summary: getProviderConfigInvalidReason(summaryProvider, normalizedPrefs, cliStatus),
          });
        }
      } catch {
        if (!cancelled) {
          setProviderErrors({ evolve: null, summary: null });
        }
      }
    };

    refreshProviderValidation();

    return () => {
      cancelled = true;
    };
  }, [settingsOpen]);

  const needsResolution = !evolveState?.evolutionId && gitStatus && !gitStatus.cleanHead;

  const promptValidationError = useMemo(() => {
    const evolveError = providerErrors.evolve;
    const summaryError = providerErrors.summary;

    if (evolveError && summaryError) {
      if (evolveError === summaryError) {
        return `${evolveError} (Evolution and Summary providers)`;
      }
      return `Evolution model: ${evolveError}. Summary model: ${summaryError}.`;
    }

    if (evolveError) {
      return `Evolution model: ${evolveError}.`;
    }

    if (summaryError) {
      return `Summary model: ${summaryError}.`;
    }

    return null;
  }, [providerErrors.evolve, providerErrors.summary]);

  const handleSubmit = () => {
    if (!evolvePrompt.trim()) return;
    if (promptValidationError) return;
    if (needsResolution) {
      evolveFromManual();
    }
    handleEvolve();
  };

  const isLoading = isProcessing && processingAction === "evolve";
  const sendDisabled = isLoading || !evolvePrompt.trim() || !!promptValidationError;

  const placeholder =
    evolveState?.step === "evolve"
      ? "Describe additional changes or refinements..."
      : "Describe changes to make to your configuration.";

  const words = evolvePrompt.split(" ").length;
  const percentage = words / MAX_CONTEXT_LENGTH;
  const contextUsage =
    percentage >= 1 ? "100% used" : percentage < 0.1 ? "" : `${Math.floor(percentage * 100)}% used`;

  return (
    <div className="space-y-3">
      <BeginEvolveWarning open={warningOpen} onOpenChange={setWarningOpen} handleEvolve={handleEvolve} />
      <InputGroup>
        <InputGroupTextarea
          disabled={isLoading}
          onChange={(e) => setEvolvePrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && evolvePrompt.trim() && !sendDisabled) {
              handleSubmit();
            }
          }}
          placeholder={placeholder}
          value={evolvePrompt}
        />

        {/* Placeholder template
        "+" for adding files/resources for context
        "dropdown" for selecting context mode (auto/agent/manual) */}

        <InputGroupAddon align="block-end">
          {/* <InputGroupButton
            className="rounded-full"
            size="icon-xs"
            variant="outline"
          >
            <Plus />
          </InputGroupButton> */}
          {/* <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <InputGroupButton variant="ghost">Auto</InputGroupButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="[--radius:0.95rem]"
              side="top"
            >
              <DropdownMenuItem>Auto</DropdownMenuItem>
              <DropdownMenuItem>Agent</DropdownMenuItem>
              <DropdownMenuItem>Manual</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu> */}
          <InputGroupText className="ml-auto">{contextUsage}</InputGroupText>
          {/* <Separator className="!h-4" orientation="vertical" /> */}
          <InputGroupButton
            className="rounded-full"
            disabled={sendDisabled}
            onClick={handleSubmit}
            size="icon-xs"
            variant="default"
          >
            <ArrowUpIcon />
            <span className="sr-only">Send</span>
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>

      {promptValidationError && (
        <p className="text-destructive text-xs">
          {promptValidationError}{" "}
          <button
            className="underline underline-offset-2"
            onClick={() => setSettingsOpen(true, "ai-models")}
            type="button"
          >
            Open AI Models settings
          </button>
          .
        </p>
      )}

      <div className="flex items-start gap-1">
        <div className="flex flex-wrap items-center gap-1">
          {STATIC_SUGGESTIONS.map((suggestion) => (
            <BadgeButton
              key={suggestion}
              onClick={() => setEvolvePrompt(suggestion)}
            >
              {suggestion}
            </BadgeButton>
          ))}
          <MacRecommendationChip />
          <SystemDefaultsCTA />
        </div>
        <div className="ml-auto shrink-0">
          <PromptHistoryBadge />
        </div>
      </div>
    </div>
  );
}
