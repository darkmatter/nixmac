"use client";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useEvolve } from "@/hooks/use-evolve";
import { useWidgetStore } from "@/stores/widget-store";
import { darwinAPI } from "@/tauri-api";
import { ArrowUpIcon, ClockIcon } from "lucide-react";
import { useEffect, useState } from "react";

const MAX_CONTEXT_LENGTH = 1000;

export function PromptInput() {
  const evolvePrompt = useWidgetStore((s) => s.evolvePrompt);
  const setEvolvePrompt = useWidgetStore((s) => s.setEvolvePrompt);
  const isProcessing = useWidgetStore((s) => s.isProcessing);
  const processingAction = useWidgetStore((s) => s.processingAction);
  const gitStatus = useWidgetStore((s) => s.gitStatus);
  const suggestions = useWidgetStore((s) => s.suggestions);

  const [promptHistory, setPromptHistory] = useState<string[]>([]);

  const { handleEvolve } = useEvolve();

  // Load prompt history on mount
  useEffect(() => {
    darwinAPI.promptHistory.get().then(setPromptHistory).catch(console.error);
  }, []);

  const handleSubmit = async () => {
    if (evolvePrompt.trim()) {
      // Add to history
      await darwinAPI.promptHistory.add(evolvePrompt.trim()).catch(console.error);
      // Refresh history
      const updated = await darwinAPI.promptHistory.get().catch(() => []);
      if (updated) {
        setPromptHistory(updated);
      }
      handleEvolve();
    }
  };

  const isLoading = isProcessing && processingAction === "evolve";
  const hasChanges = Boolean(gitStatus?.diff);

  const placeholder = hasChanges
    ? "Describe additional changes or refinements..."
    : "Describe changes to make to your configuration.";

  const words = evolvePrompt.split(" ").length;
  const percentage = words / MAX_CONTEXT_LENGTH;
  const contextUsage =
    percentage >= 1 ? "100% used" : percentage < 0.1 ? "" : `${Math.floor(percentage * 100)}% used`;

  return (
    <div className="space-y-3">
      <InputGroup>
        <InputGroupTextarea
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
          {/* Prompt History Dropdown */}
          {promptHistory.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <InputGroupButton
                  className="rounded-full"
                  disabled={isLoading}
                  size="icon-xs"
                  variant="ghost"
                >
                  <ClockIcon />
                  <span className="sr-only">Prompt history</span>
                </InputGroupButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="[--radius:0.95rem] max-w-md" side="top">
                {promptHistory.map((prompt, index) => (
                  <DropdownMenuItem
                    key={`${prompt}-${index}`}
                    onClick={() => setEvolvePrompt(prompt)}
                  >
                    <span className="line-clamp-2 text-sm">{prompt}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

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

      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {suggestions.map((suggestion) => (
            <button
              className="rounded-full border border-border bg-muted/50 px-3 py-1 text-muted-foreground text-xs transition-colors hover:bg-muted hover:text-foreground"
              key={suggestion}
              onClick={() => setEvolvePrompt(suggestion)}
              type="button"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
