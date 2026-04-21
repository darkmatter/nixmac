"use client";

import { BadgeButton } from "@/components/ui/badge-button";
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
import { useWidgetStore } from "@/stores/widget-store";
import { ClockIcon } from "lucide-react";
import { useState } from "react";

export function PromptHistoryBadge() {
  const history = useWidgetStore((s) => s.promptHistory);
  const evolvePrompt = useWidgetStore((s) => s.evolvePrompt);
  const setEvolvePrompt = useWidgetStore((s) => s.setEvolvePrompt);
  const isProcessing = useWidgetStore((s) => s.isProcessing);
  const processingAction = useWidgetStore((s) => s.processingAction);

  const disabled = isProcessing && processingAction === "evolve";
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");

  if (!(history?.length)) {
    return null;
  }

  const handleSelect = (prompt: string) => {
    setEvolvePrompt(prompt);
    setOpen(false);
    setSearchValue("");
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      setSearchValue("");
    }
  };

  // Filter history based on search
  const filteredHistory = history.filter((prompt) =>
    prompt.toLowerCase().includes(searchValue.toLowerCase()),
  );

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <BadgeButton icon={ClockIcon} badgeVariant="teal" disabled={disabled}>
          My History
        </BadgeButton>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search history..."
            value={searchValue}
            onValueChange={setSearchValue}
          />
          <CommandList>
            {filteredHistory.length === 0 ? (
              <CommandEmpty>No matching prompts found.</CommandEmpty>
            ) : (
              <CommandGroup>
                {filteredHistory.map((prompt) => (
                  <CommandItem
                    key={prompt}
                    value={prompt}
                    onSelect={() => handleSelect(prompt)}
                    className={cn(
                      "cursor-pointer",
                      evolvePrompt === prompt && "bg-teal-500/10",
                    )}
                  >
                    <span className="line-clamp-2 text-sm">{prompt}</span>
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
