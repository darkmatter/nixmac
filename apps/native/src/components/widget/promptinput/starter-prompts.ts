import starterPromptArchetypes from "@/components/widget/promptinput/starter-prompts.json";

export type StarterPromptArchetypeId =
  | "programmers"
  | "streamers"
  | "homelab"
  | "security"
  | "designers"
  | "writers"
  | "nomads"
  | "gamers";

export type StarterPromptIconName =
  | "book-open"
  | "brush"
  | "cable"
  | "code-2"
  | "file-key"
  | "focus"
  | "gamepad-2"
  | "joystick"
  | "keyboard"
  | "key-round"
  | "network"
  | "notebook-text"
  | "palette"
  | "panels-top-left"
  | "plane"
  | "presentation"
  | "radio"
  | "refresh-ccw"
  | "server"
  | "shield-check"
  | "terminal"
  | "video"
  | "wifi"
  | "wrench";

export type StarterPrompt = {
  id: string;
  label: string;
  icon: StarterPromptIconName;
  prompt: string;
  sourceRefs: string[];
  featured?: boolean;
};

export type StarterPromptArchetype = {
  id: StarterPromptArchetypeId;
  title: string;
  description: string;
  prompts: StarterPrompt[];
};

/**
 * Curated starter prompts, grouped by user archetype. The data lives in the
 * sibling `starter-prompts.json` so it can be edited (and validated) without
 * touching code; this module re-exports it with the strong types above.
 */
export const STARTER_PROMPT_ARCHETYPES =
  starterPromptArchetypes as StarterPromptArchetype[];

/** The single `featured` prompt from each archetype, shown as quick chips. */
export const STARTER_PROMPT_CHIPS = STARTER_PROMPT_ARCHETYPES.flatMap((archetype) =>
  archetype.prompts.filter((prompt) => prompt.featured),
);
