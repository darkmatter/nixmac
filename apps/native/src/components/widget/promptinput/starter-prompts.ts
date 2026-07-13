import starterPromptArchetypes from "@/components/widget/promptinput/starter-prompts.json";

type StarterPromptArchetypeId =
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

/**
 * Reduce a full starter prompt to a short leading phrase suitable for an
 * animated placeholder hint (e.g. the part before the first `:` or `,`),
 * capped at a word boundary so the typewriter stays snappy.
 */
const DANGLING_WORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "by",
  "for",
  "from",
  "in",
  "into",
  "my",
  "of",
  "on",
  "or",
  "over",
  "the",
  "to",
  "with",
]);

function toPlaceholderPhrase(prompt: string, maxLength = 64): string {
  const lead = prompt.split(/[:,]/, 1)[0]?.trim() ?? prompt.trim();
  if (lead.length <= maxLength) return lead;
  const truncated = lead.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(" ");
  const words = (lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated)
    .trim()
    .split(" ");
  // A cut can land right after a connector ("… with Tailscale or"), which reads
  // as if the typewriter stalled mid-sentence — drop such trailing words.
  while (words.length > 1 && DANGLING_WORDS.has(words[words.length - 1]!.toLowerCase())) {
    words.pop();
  }
  return words.join(" ");
}

/**
 * Short example phrases cycled through the animated typewriter placeholder on
 * the evolve prompt input. Derived from the featured starter prompts so the
 * hint and the quick chips stay in sync.
 */
export const PLACEHOLDER_EXAMPLES: string[] = STARTER_PROMPT_CHIPS.map((prompt) =>
  toPlaceholderPhrase(prompt.prompt),
);
