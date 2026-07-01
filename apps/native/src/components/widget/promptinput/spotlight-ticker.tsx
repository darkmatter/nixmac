"use client";

import { STARTER_PROMPT_ICON_COMPONENTS } from "@/components/widget/promptinput/starter-prompt-icons";
import {
  STARTER_PROMPT_ARCHETYPES,
  type StarterPrompt,
  type StarterPromptArchetype,
} from "@/components/widget/promptinput/starter-prompts";
import { cn } from "@/lib/utils";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

/** The prompt spotlighted for an archetype: its featured prompt, else the first. */
function spotlightPrompt(archetype: StarterPromptArchetype): StarterPrompt {
  return archetype.prompts.find((p) => p.featured) ?? archetype.prompts[0];
}

/**
 * Slim rotating "Try this" ticker that spotlights one capability archetype at a
 * time. Sits directly under the prompt input and calls `onSelect` with a
 * ready-to-run prompt. Driven by the curated `starter-prompts` data.
 */
export function SpotlightTicker({ onSelect }: { onSelect: (prompt: string) => void }) {
  const [i, setI] = useState(0);
  const archetypes = STARTER_PROMPT_ARCHETYPES;
  const archetype = archetypes[i];
  const example = spotlightPrompt(archetype);
  const Icon = STARTER_PROMPT_ICON_COMPONENTS[example.icon];
  const move = (d: number) => setI((p) => (p + d + archetypes.length) % archetypes.length);

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 rounded-lg border border-border bg-card/30 py-1.5 pr-1.5 pl-3">
        <span className="hidden font-medium text-muted-foreground text-xs uppercase tracking-wide sm:inline">
          Try
        </span>
        <button
          key={archetype.id}
          type="button"
          onClick={() => onSelect(example.prompt)}
          className="group flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-background">
            <Icon className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-medium text-sm">{example.label}</span>
            <span className="block truncate text-muted-foreground text-xs">{archetype.title}</span>
          </span>
          <ArrowRight className="ml-auto size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
        </button>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => move(-1)}
            aria-label="Previous suggestion"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => move(1)}
            aria-label="Next suggestion"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

      <div className="mt-2.5 flex items-center justify-center gap-1.5">
        {archetypes.map((a, idx) => (
          <button
            key={a.id}
            type="button"
            aria-label={`Go to ${a.title}`}
            onClick={() => setI(idx)}
            className={cn(
              "rounded-full transition-all",
              idx === i ? "h-1.5 w-4 bg-foreground" : "size-1.5 bg-border",
            )}
          />
        ))}
      </div>
    </div>
  );
}
