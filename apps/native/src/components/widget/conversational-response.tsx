"use client";

import { cn } from "@/lib/utils";
import { useWidgetStore } from "@/stores/widget-store";
import { Bot, X } from "lucide-react";

export function ConversationalResponse() {
  const response = useWidgetStore((s) => s.conversationalResponse);
  const setConversationalResponse = useWidgetStore((s) => s.setConversationalResponse);

  if (!response) return null;

  return (
    <div
      className={cn(
        "relative rounded-xl border border-primary/20 bg-primary/5 p-4",
        "animate-in fade-in slide-in-from-bottom-2 duration-300",
      )}
    >
      {/* Dismiss button */}
      <button
        type="button"
        onClick={() => setConversationalResponse(null)}
        className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground/50 transition-colors hover:bg-muted/40 hover:text-muted-foreground"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>

      {/* Header */}
      <div className="mb-2 flex items-center gap-2">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15">
          <Bot className="h-3.5 w-3.5 text-primary" />
        </div>
        <span className="text-xs font-medium text-primary/80 uppercase tracking-wide">nixmac</span>
      </div>

      {/* Response body */}
      <p className="whitespace-pre-wrap text-sm text-foreground/90 leading-relaxed pr-4">
        {response}
      </p>
    </div>
  );
}
