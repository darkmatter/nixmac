"use client";

import { BadgeButton } from "@/components/ui/badge-button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Separator } from "@/components/ui/separator";
import { BeginEvolveWarning } from "@/components/widget/promptinput/begin-evolve-warning";
import { HomebrewBadge } from "@/components/widget/promptinput/homebrew-badge";
import { MacRecommendationChip } from "@/components/widget/promptinput/mac-recommendation-chip";
import { PromptHistoryBadge } from "@/components/widget/promptinput/prompt-history-badge";
import { usePromptSuggestionsVariant } from "@/components/widget/promptinput/prompt-suggestions-variant";
import { SpotlightTicker } from "@/components/widget/promptinput/spotlight-ticker";
import { STARTER_PROMPT_ICON_COMPONENTS } from "@/components/widget/promptinput/starter-prompt-icons";
import {
  PLACEHOLDER_EXAMPLES,
  STARTER_PROMPT_CHIPS,
} from "@/components/widget/promptinput/starter-prompts";
import { SystemDefaultsCTA } from "@/components/widget/promptinput/system-defaults-cta";
import { TrendingFeed } from "@/components/widget/promptinput/trending-feed";
import { useTypewriterPlaceholder } from "@/components/widget/promptinput/use-typewriter-placeholder";
import { useEvolve } from "@/hooks/use-evolve";
import { tauriAPI } from "@/ipc/api";
import { getProviderConfigInvalidReason } from "@/lib/providers/ai-provider-validation";
import { uiActions, useUiState, useViewModel } from "@nixmac/state";
import { nav } from "@/router";
import { ArrowUpIcon } from "lucide-react";
import { useEffect, useState } from "react";

const MAX_CONTEXT_LENGTH = 1000;

export function PromptInput() {
  const evolvePrompt = useUiState((s) => s.evolvePrompt);
  const isProcessing = useUiState((s) => s.isProcessing);
  const processingAction = useUiState((s) => s.processingAction);
  const evolveState = useViewModel((s) => s.evolve);
  const gitStatus = useViewModel((s) => s.git);
  const settingsOpen = useUiState((s) => s.settingsOpen);
  const { handleEvolve } = useEvolve();
  const [warningOpen, setWarningOpen] = useState(false);
  const [providerErrors, setProviderErrors] = useState<{
    evolve: string | null;
    summary: string | null;
  }>({
    evolve: null,
    summary: null,
  });

  useEffect(() => {
    let cancelled = false;

    const refreshProviderValidation = async () => {
      try {
        const [prefs, cliStatus] = await Promise.all([
          // deprecated(orpc): replace with client/orpc from @/lib/orpc
          tauriAPI.ui.getPrefs(),
          // deprecated(orpc): replace with client/orpc from @/lib/orpc
          tauriAPI.cli.checkTools(),
        ]);

        const normalizedPrefs = {
          openrouterApiKey: prefs?.openrouterApiKey ?? "",
          openaiApiKey: prefs?.openaiApiKey ?? "",
          vllmApiBaseUrl: prefs?.vllmApiBaseUrl ?? "",
        };

        if (!cancelled) {
          setProviderErrors({
            evolve: getProviderConfigInvalidReason(
              prefs?.evolveProvider,
              normalizedPrefs,
              cliStatus,
              prefs?.evolveModel,
            ),
            summary: getProviderConfigInvalidReason(
              prefs?.summaryProvider,
              normalizedPrefs,
              cliStatus,
              prefs?.summaryModel,
            ),
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

  const promptValidationError = (() => {
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
  })();

  const handleSubmit = () => {
    if (!evolvePrompt.trim()) return;
    if (promptValidationError) return;
    if (needsResolution) {
      setWarningOpen(true);
      return;
    }
    handleEvolve();
  };

  const isLoading = isProcessing && processingAction === "evolve";
  const sendDisabled = isLoading || !evolvePrompt.trim() || !!promptValidationError;

  // The animated typewriter placeholder is the default empty-state hint. It only
  // runs on the first "begin" pass (the refine step keeps a static prompt) and
  // pauses once the user has typed anything.
  const isBeginStep = evolveState?.step !== "evolve";
  const { text: typedHint, isTyping } = useTypewriterPlaceholder(PLACEHOLDER_EXAMPLES, {
    paused: !isBeginStep || evolvePrompt.length > 0,
  });
  const placeholder = isBeginStep
    ? `Try: ${typedHint}${isTyping ? "▍" : ""}`
    : "Describe additional changes or refinements...";

  // PostHog-flag-driven suggestion surface under the input.
  const suggestionsVariant = usePromptSuggestionsVariant();
  const seedPrompt = (prompt: string) => uiActions.setEvolvePrompt(prompt);

  const words = evolvePrompt.split(" ").length;
  const percentage = words / MAX_CONTEXT_LENGTH;
  const contextUsage =
    percentage >= 1 ? "100% used" : percentage < 0.1 ? "" : `${Math.floor(percentage * 100)}% used`;

  return (
    <div className="space-y-3 flex-col min-h-24">
      <BeginEvolveWarning
        open={warningOpen}
        onOpenChange={setWarningOpen}
        handleEvolve={handleEvolve}
      />
      <InputGroup className="bg-background flex-col min-h-24">
        <InputGroupTextarea
          id="evolve-prompt-input"
          data-testid="evolve-prompt-input"
          disabled={isLoading}
          onChange={(e: { target: { value: string } }) => uiActions.setEvolvePrompt(e.target.value)}
          onKeyDown={(e: { key: string }) => {
            if (e.key === "Enter" && evolvePrompt.trim() && !sendDisabled) {
              handleSubmit();
            }
          }}
          placeholder={placeholder}
          value={evolvePrompt}
          className="outline-none"
        />
        <InputGroupAddon align="block-end">
          {/* <InputGroupButton
              className="rounded-full size-6 p-0.5"
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
          <Separator className="h-4!" orientation="vertical" />
          <Separator className="h-4!" orientation="vertical" />
          <InputGroupButton
            className="rounded-full size-6 p-0.5"
            size="icon-xs"
            variant="default"
            id="evolve-prompt-send"
            data-testid="evolve-prompt-send"
            disabled={sendDisabled}
            onClick={handleSubmit}
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
            onClick={() => nav.openSettings("ai-models")}
            type="button"
          >
            Open AI Models settings
          </button>
          .
        </p>
      )}

      {suggestionsVariant === "spotlight" && <SpotlightTicker onSelect={seedPrompt} />}
      {suggestionsVariant === "trending" && <TrendingFeed onSelect={seedPrompt} />}

      <div className="flex items-start gap-1">
        <div className="flex flex-wrap items-center gap-1">
          {suggestionsVariant === "chips" &&
            STARTER_PROMPT_CHIPS.map((suggestion) => (
              <BadgeButton
                key={suggestion.id}
                icon={STARTER_PROMPT_ICON_COMPONENTS[suggestion.icon]}
                onClick={() => seedPrompt(suggestion.prompt)}
              >
                {suggestion.label}
              </BadgeButton>
            ))}
          <MacRecommendationChip />
          <SystemDefaultsCTA />
          <HomebrewBadge />
        </div>
        <div className="ml-auto shrink-0">
          <PromptHistoryBadge />
        </div>
      </div>
    </div>
  );
}
