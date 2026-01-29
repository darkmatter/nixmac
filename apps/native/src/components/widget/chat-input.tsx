"use client";

import { ArrowUpIcon, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Separator } from "@/components/ui/separator";

export interface ChatInputProps {
  isLoading: boolean;
  value: string;
  onChange: (prompt: string) => void;
  onSubmit: () => void;
  contextUsage?: string;
}

const MAX_CONTEXT_LENGTH = 1000;

export function ChatInput({
  isLoading,
  value,
  onChange,
  onSubmit,
  contextUsage = (() => {
    const words = value.split(" ").length;
    const percentage = words / MAX_CONTEXT_LENGTH;
    if (percentage >= 1) {
      return "100% used";
    }
    if (percentage < 0.1) {
      return "";
    }
    return `${Math.floor(percentage * 100)}% used`;
  })(),
}: ChatInputProps) {
  return (
    <InputGroup>
      <InputGroupTextarea
        disabled={isLoading}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && value.trim() && !isLoading) {
            onSubmit();
          }
        }}
        placeholder="Make additional changes to your configuration."
        value={value}
      />
      <InputGroupAddon align="block-end">
        <InputGroupButton
          className="rounded-full"
          size="icon-xs"
          variant="outline"
        >
          <Plus />
        </InputGroupButton>
        <DropdownMenu>
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
        </DropdownMenu>
        <InputGroupText className="ml-auto">{contextUsage}</InputGroupText>
        <Separator className="!h-4" orientation="vertical" />
        <InputGroupButton
          className="rounded-full"
          disabled={isLoading || !value.trim()}
          onClick={() => onSubmit()}
          size="icon-xs"
          variant="default"
        >
          <ArrowUpIcon />
          <span className="sr-only">Send</span>
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}
