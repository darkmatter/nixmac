"use client";

import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
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

/**
 * cmdk item value for the row that commits the empty string. Also used as the
 * highlight seed when the value is empty, so an unrelated first row can never
 * be committed by an immediate Enter.
 */
const EMPTY_OPTION_VALUE = "__combobox_empty__";

interface ComboboxProps {
  /** Items in display order. */
  items: string[];
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  /** Notified on popover open/close (e.g. to refresh `items` on open). */
  onOpenChange?: (open: boolean) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Spinner in the field; while `items` is empty, a loading row in the list. */
  isLoading?: boolean;
  /** When set, a first row with this label commits the empty string. */
  emptyValueLabel?: string;
  /** Offer typed text that matches no item as a selectable row. */
  allowCustomValue?: boolean;
  /** List message when there are no items at all. */
  emptyMessage?: string;
  /** List message when typed text matches nothing (only without allowCustomValue). */
  noMatchMessage?: string;
  loadingMessage?: string;
  /** Extra classes for the popover content (e.g. to override the width). */
  contentClassName?: string;
}

/**
 * Input-anchored combobox (Base UI semantics): the field itself is the cmdk
 * input, opening shows the unfiltered list with the current selection
 * highlighted, typing only filters, and values commit on selection.
 */
export function Combobox({
  items,
  value,
  onChange,
  onBlur,
  onOpenChange,
  placeholder = "Select...",
  disabled = false,
  isLoading = false,
  emptyValueLabel,
  allowCustomValue = false,
  emptyMessage = "No items found.",
  noMatchMessage = "No matches found.",
  loadingMessage = "Loading...",
  contentClassName,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  // Text shown in the field while the popover is open (falls back to `value`
  // when closed). Seeded with `value` on open so the field keeps showing the
  // current selection.
  const [search, setSearch] = useState("");
  // What the list is filtered by. Kept separate from `search` so the full
  // list shows on open (empty query despite the field showing the value) and
  // selecting an item doesn't re-filter the list while the close animation is
  // still playing.
  const [query, setQuery] = useState("");
  // cmdk's highlighted item, controlled so opening highlights the current
  // selection instead of the first row (Enter must not commit a different
  // item than the one already chosen).
  const [highlighted, setHighlighted] = useState("");
  const anchorRef = useRef<HTMLDivElement>(null);

  const openPopover = () => {
    if (!open) {
      setSearch(value);
      // Empty query so the full list is visible on open.
      setQuery("");
      setHighlighted(value || EMPTY_OPTION_VALUE);
      setOpen(true);
      onOpenChange?.(true);
    }
  };

  const closePopover = () => {
    if (open) {
      setOpen(false);
      onOpenChange?.(false);
      onBlur?.();
    }
  };

  const handleSelect = (selectedValue: string) => {
    // Intentionally leave `query` alone so the list doesn't re-filter
    // mid-close; it gets reset on the next open.
    onChange(selectedValue);
    setSearch(selectedValue);
    setOpen(false);
    onOpenChange?.(false);
    onBlur?.();
  };

  // Typing only filters; the value is committed on selection (click or Enter
  // on a list item, including the custom row).
  const handleInputChange = (newValue: string) => {
    setSearch(newValue);
    setQuery(newValue);
    // Typing into the field after a selection reopens the list.
    if (!open) {
      setOpen(true);
      onOpenChange?.(true);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (newOpen) {
      openPopover();
    } else {
      closePopover();
    }
  };

  // Filter items based on what the user typed since opening
  const filteredItems = query
    ? items.filter((item) => item.toLowerCase().includes(query.toLowerCase()))
    : items;

  // Show typed text in list if it doesn't match any item
  const showCustomOption =
    allowCustomValue && query && !items.some((i) => i.toLowerCase() === query.toLowerCase());

  // Selecting is the only way to commit a value, so committing the empty
  // string needs an explicit row too.
  const showEmptyOption = !query && emptyValueLabel !== undefined;

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
          className={cn("w-[400px] p-0", contentClassName)}
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
            {isLoading && items.length === 0 ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">{loadingMessage}</span>
              </div>
            ) : filteredItems.length === 0 && !showCustomOption && !showEmptyOption ? (
              <CommandEmpty>{items.length === 0 ? emptyMessage : noMatchMessage}</CommandEmpty>
            ) : (
              <CommandGroup>
                {showEmptyOption && (
                  <CommandItem value={EMPTY_OPTION_VALUE} onSelect={() => handleSelect("")}>
                    <Check
                      className={cn("mr-2 h-4 w-4", value === "" ? "opacity-100" : "opacity-0")}
                    />
                    <span className="truncate text-muted-foreground">{emptyValueLabel}</span>
                  </CommandItem>
                )}
                {showCustomOption && (
                  <CommandItem
                    value={query}
                    onSelect={() => handleSelect(query)}
                    className="text-primary"
                  >
                    <Check
                      className={cn("mr-2 h-4 w-4", value === query ? "opacity-100" : "opacity-0")}
                    />
                    Use "{query}"
                  </CommandItem>
                )}
                {filteredItems.map((item) => (
                  <CommandItem key={item} value={item} onSelect={() => handleSelect(item)}>
                    <Check
                      className={cn("mr-2 h-4 w-4", value === item ? "opacity-100" : "opacity-0")}
                    />
                    <span className="truncate">{item}</span>
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
