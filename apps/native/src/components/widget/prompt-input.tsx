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
import { useWidgetStore } from "@/stores/widget-store";
import { ArrowUpIcon } from "lucide-react";
import { useState } from "react";

const MAX_CONTEXT_LENGTH = 1000;

const STATIC_SUGGESTIONS = ["Install vim", "Add Rectangle app"];

export function PromptInput() {
  const evolvePrompt = useWidgetStore((s) => s.evolvePrompt);
  const setEvolvePrompt = useWidgetStore((s) => s.setEvolvePrompt);
  const isProcessing = useWidgetStore((s) => s.isProcessing);
  const processingAction = useWidgetStore((s) => s.processingAction);
  const evolveState = useWidgetStore((s) => s.evolveState);
  const gitStatus = useWidgetStore((s) => s.gitStatus);
  const { handleEvolve, evolveFromManual } = useEvolve();
  const [warningOpen, setWarningOpen] = useState(false);

  const needsResolution = !evolveState?.evolutionId && gitStatus && !gitStatus.cleanHead;

  const handleSubmit = () => {
    if (!evolvePrompt.trim()) return;
    if (needsResolution) {
      evolveFromManual();
    }
    handleEvolve();
  };

  const isLoading = isProcessing && processingAction === "evolve";

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
          id="evolve-prompt-input"
          data-testid="evolve-prompt-input"
          disabled={isLoading}
          onChange={(e) => setEvolvePrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && evolvePrompt.trim() && !isLoading) {
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
            id="evolve-prompt-send"
            data-testid="evolve-prompt-send"
            className="rounded-full"
            disabled={isLoading || !evolvePrompt.trim()}
            onClick={handleSubmit}
            size="icon-xs"
            variant="default"
          >
            <ArrowUpIcon />
            <span className="sr-only">Send</span>
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>

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
