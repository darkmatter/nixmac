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
import { Check, ClockIcon } from "lucide-react";
import { useState } from "react";

interface PromptHistoryBadgeProps {
  history: string[];
  onSelect: (prompt: string) => void;
  disabled?: boolean;
  currentValue?: string;
}

export function PromptHistoryBadge({
  history,
  onSelect,
  disabled,
  currentValue = "",
}: PromptHistoryBadgeProps) {
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");

  if (history.length === 0) {
    return null;
  }

  const handleSelect = (prompt: string) => {
    onSelect(prompt);
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
                    className="cursor-pointer"
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4 shrink-0",
                        currentValue === prompt ? "opacity-100" : "opacity-0",
                      )}
                    />
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
