// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import type React from "react";
import preview from "#storybook/preview";
import type { EvolveEvent } from "@/ipc/types";
import { EvolveProgress } from "@/components/widget/overlays/evolve-progress";

// =============================================================================
// Meta
// =============================================================================

const meta = preview.meta({
  title: "Components/EvolveProgress",
  component: EvolveProgress,
  parameters: {
    layout: "centered",
  },
  decorators: [
    (Story: React.ComponentType) => (
      <div className="w-[500px] rounded-lg border border-border bg-card">
        <Story />
      </div>
    ),
  ],
  tags: ["autodocs"],
  argTypes: {
    isGenerating: {
      control: "boolean",
      description: "Whether the evolution is in progress",
    },
    events: {
      control: "object",
      description: "Array of evolve events to display",
    },
  },
});

export default meta;

// =============================================================================
// Mock Data
// =============================================================================

// Simulate a realistic evolution timeline
const mockEventsInProgress: EvolveEvent[] = [
  {
    eventType: "start",
    summary: "Starting AI evolution...",
    raw: "Starting evolution with model gpt-5.1 for prompt: Install vim and configure git",
    iteration: null,
    timestampMs: 0,
  },
  {
    eventType: "info",
    summary: "Target host: Demo-MacBook-Pro",
    raw: "Target host: Demo-MacBook-Pro",
    iteration: null,
    timestampMs: 150,
  },
  {
    eventType: "iteration",
    summary: "Processing iteration 1...",
    raw: "Iteration 1 | messages=2",
    iteration: 1,
    timestampMs: 500,
  },
  {
    eventType: "apiRequest",
    summary: "Querying AI model...",
    raw: "Sending request to AI provider",
    iteration: 1,
    timestampMs: 550,
  },
  {
    eventType: "apiResponse",
    summary: "Received AI response",
    raw: "Received response | tokens used: 1523",
    iteration: 1,
    timestampMs: 2300,
  },
  {
    eventType: "toolCall",
    summary: "Using think tool...",
    raw: 'think | args: category="planning", thought="I need to understand the current..."',
    iteration: 1,
    timestampMs: 2350,
  },
  {
    eventType: "thinking",
    summary: "I need to understand the current nix-darwin configuration structure before making changes.",
    raw: "[planning] I need to understand the current nix-darwin configuration structure before making changes. Let me first read the main configuration file to see what's already set up.",
    iteration: 1,
    timestampMs: 2400,
  },
  {
    eventType: "toolCall",
    summary: "Searching packages for 'vim'...",
    raw: 'search_packages | args: query="vim"',
    iteration: 1,
    timestampMs: 2500,
  },
  {
    eventType: "searchPackages",
    summary: "Searched packages for 'vim' → vim, neovim, vim-full",
    raw: "Searched packages for 'vim'; found 3: vim, neovim, vim-full",
    iteration: 1,
    timestampMs: 2700,
    detail: { type: "searchPackages", query: "vim", found: ["vim", "neovim", "vim-full"] },
  },
  {
    eventType: "narration",
    summary: "The plain vim package is what we want here.",
    raw: "The plain vim package is what we want here. I'll add it to the system packages and then configure git.",
    iteration: 1,
    timestampMs: 2750,
    detail: {
      type: "narration",
      text: "The plain vim package is what we want here. I'll add it to the system packages and then configure git.",
    },
  },
  {
    eventType: "iteration",
    summary: "Processing iteration 2...",
    raw: "Iteration 2 | messages=4",
    iteration: 2,
    timestampMs: 2800,
  },
  {
    eventType: "apiRequest",
    summary: "Querying AI model...",
    raw: "Sending request to AI provider",
    iteration: 2,
    timestampMs: 2850,
  },
  {
    eventType: "apiResponse",
    summary: "Received AI response",
    raw: "Received response | tokens used: 2104",
    iteration: 2,
    timestampMs: 4500,
    detail: { type: "progress", tokens: 3627, budget: 500_000, iteration: 2, limit: 50 },
  },
  {
    eventType: "toolCall",
    summary: "Reading default.nix...",
    raw: 'read_file | args: path="modules/darwin/default.nix"',
    iteration: 2,
    timestampMs: 4550,
  },
  {
    eventType: "reading",
    summary: "Reading default.nix",
    raw: "Reading file: modules/darwin/default.nix",
    iteration: 2,
    timestampMs: 4600,
  },
];

const mockEventsComplete: EvolveEvent[] = [
  ...mockEventsInProgress,
  {
    eventType: "iteration",
    summary: "Processing iteration 3...",
    raw: "Iteration 3 | messages=6",
    iteration: 3,
    timestampMs: 5000,
  },
  {
    eventType: "apiRequest",
    summary: "Querying AI model...",
    raw: "Sending request to AI provider",
    iteration: 3,
    timestampMs: 5050,
  },
  {
    eventType: "apiResponse",
    summary: "Received AI response",
    raw: "Received response | tokens used: 2567",
    iteration: 3,
    timestampMs: 7200,
  },
  {
    eventType: "toolCall",
    summary: "Editing default.nix...",
    raw: 'edit_nix_file | args: path="modules/darwin/default.nix"',
    iteration: 3,
    timestampMs: 7250,
  },
  {
    eventType: "editing",
    summary: "Adding vim to environment.systemPackages",
    raw: 'Editing file: modules/darwin/default.nix | {"add":{"path":"environment.systemPackages","values":["vim"]}}',
    iteration: 3,
    timestampMs: 7300,
  },
  {
    eventType: "iteration",
    summary: "Processing iteration 4...",
    raw: "Iteration 4 | messages=8",
    iteration: 4,
    timestampMs: 7800,
  },
  {
    eventType: "apiRequest",
    summary: "Querying AI model...",
    raw: "Sending request to AI provider",
    iteration: 4,
    timestampMs: 7850,
  },
  {
    eventType: "apiResponse",
    summary: "Received AI response",
    raw: "Received response | tokens used: 3102",
    iteration: 4,
    timestampMs: 9500,
  },
  {
    eventType: "toolCall",
    summary: "Checking the configuration builds...",
    raw: 'build_check | args: host="Demo-MacBook-Pro"',
    iteration: 4,
    timestampMs: 9550,
  },
  {
    eventType: "buildPass",
    summary: "Build check passed ✓",
    raw: "Build check passed",
    iteration: 4,
    timestampMs: 15_200,
  },
  {
    eventType: "iteration",
    summary: "Processing iteration 5...",
    raw: "Iteration 5 | messages=10",
    iteration: 5,
    timestampMs: 15_500,
  },
  {
    eventType: "apiRequest",
    summary: "Querying AI model...",
    raw: "Sending request to AI provider",
    iteration: 5,
    timestampMs: 15_550,
  },
  {
    eventType: "apiResponse",
    summary: "Received AI response",
    raw: "Received response | tokens used: 3456",
    iteration: 5,
    timestampMs: 17_000,
    detail: { type: "progress", tokens: 13_752, budget: 500_000, iteration: 5, limit: 50 },
  },
  {
    eventType: "complete",
    summary: "Evolution complete!",
    raw: "Evolution complete: Successfully added vim to system packages and configured git with user settings.",
    iteration: 5,
    timestampMs: 17_050,
  },
];

const mockEventsWithBuildFailure: EvolveEvent[] = [
  {
    eventType: "start",
    summary: "Starting AI evolution...",
    raw: "Starting evolution with model gpt-5.1 for prompt: Add broken package",
    iteration: null,
    timestampMs: 0,
  },
  {
    eventType: "iteration",
    summary: "Processing iteration 1...",
    raw: "Iteration 1 | messages=2",
    iteration: 1,
    timestampMs: 500,
  },
  {
    eventType: "apiRequest",
    summary: "Querying AI model...",
    raw: "Sending request to AI provider",
    iteration: 1,
    timestampMs: 550,
  },
  {
    eventType: "apiResponse",
    summary: "Received AI response",
    raw: "Received response | tokens used: 1200",
    iteration: 1,
    timestampMs: 2000,
  },
  {
    eventType: "editing",
    summary: "Editing default.nix",
    raw: "Editing file: modules/darwin/default.nix",
    iteration: 1,
    timestampMs: 2100,
  },
  {
    eventType: "iteration",
    summary: "Processing iteration 2...",
    raw: "Iteration 2 | messages=4",
    iteration: 2,
    timestampMs: 2500,
  },
  {
    eventType: "apiRequest",
    summary: "Querying AI model...",
    raw: "Sending request to AI provider",
    iteration: 2,
    timestampMs: 2550,
  },
  {
    eventType: "apiResponse",
    summary: "Received AI response",
    raw: "Received response | tokens used: 1800",
    iteration: 2,
    timestampMs: 4000,
  },
  {
    eventType: "toolCall",
    summary: "Checking the configuration builds...",
    raw: 'build_check | args: host="Demo-MacBook-Pro"',
    iteration: 2,
    timestampMs: 4050,
  },
  {
    eventType: "buildFail",
    summary: "Build check failed: error: attribute 'nonExistentPackage' missing",
    raw: "Build check failed: error: attribute 'nonExistentPackage' missing\nat /nix/store/...",
    iteration: 2,
    timestampMs: 8500,
  },
  {
    eventType: "iteration",
    summary: "Processing iteration 3...",
    raw: "Iteration 3 | messages=6",
    iteration: 3,
    timestampMs: 8800,
  },
  {
    eventType: "thinking",
    summary: "The build failed because 'nonExistentPackage' doesn't exist.",
    raw: "[debugging] The build failed because 'nonExistentPackage' doesn't exist. I need to find the correct package name.",
    iteration: 3,
    timestampMs: 9000,
  },
];

const mockEventsWithError: EvolveEvent[] = [
  {
    eventType: "start",
    summary: "Starting AI evolution...",
    raw: "Starting evolution with model gpt-5.1",
    iteration: null,
    timestampMs: 0,
  },
  {
    eventType: "iteration",
    summary: "Processing iteration 1...",
    raw: "Iteration 1 | messages=2",
    iteration: 1,
    timestampMs: 500,
  },
  {
    eventType: "apiRequest",
    summary: "Querying AI model...",
    raw: "Sending request to AI provider",
    iteration: 1,
    timestampMs: 550,
  },
  {
    eventType: "error",
    summary: "Error: API rate limit exceeded",
    raw: "Error: Rate limit exceeded. Please try again later.",
    iteration: 1,
    timestampMs: 3000,
  },
];

const mockEventsFewEvents: EvolveEvent[] = [
  {
    eventType: "start",
    summary: "Starting AI evolution...",
    raw: "Starting evolution with model gpt-5.1",
    iteration: null,
    timestampMs: 0,
  },
  {
    eventType: "iteration",
    summary: "Processing iteration 1...",
    raw: "Iteration 1 | messages=2",
    iteration: 1,
    timestampMs: 500,
  },
];

// A long run that keeps failing the build check: exercises the
// attempt-grouped history (failed attempts collapse under a header) and the
// internal scrolling the overlay panel gets by stretching the component.
function generateManyIterations(): EvolveEvent[] {
  const events: EvolveEvent[] = [
    {
      eventType: "start",
      summary: "Starting AI evolution...",
      raw: "Starting evolution",
      iteration: null,
      timestampMs: 0,
    },
  ];

  const candidates = ["spotfy", "spotify-unfree", "spotify-client", "spotifyPlayer"];
  for (const [i, pkg] of candidates.entries()) {
    const attempt = i + 1;
    const baseTime = attempt * 20_000;
    events.push(
      {
        eventType: "iteration",
        summary: `Processing iteration ${attempt}...`,
        raw: `Iteration ${attempt}`,
        iteration: attempt,
        timestampMs: baseTime,
      },
      {
        eventType: "apiRequest",
        summary: "Querying AI model...",
        raw: "Sending request",
        iteration: attempt,
        timestampMs: baseTime + 100,
      },
      {
        eventType: "apiResponse",
        summary: "Received AI response",
        raw: `Tokens: ${2000 + i * 1500}`,
        iteration: attempt,
        timestampMs: baseTime + 2000,
        detail: {
          type: "progress",
          tokens: 2000 + i * 1500,
          budget: 500_000,
          iteration: attempt,
          limit: 50,
        },
      },
      {
        eventType: "thinking",
        summary: `Trying the ${pkg} attribute next.`,
        raw: `[debugging] Trying the ${pkg} attribute next.`,
        iteration: attempt,
        timestampMs: baseTime + 2500,
      },
      {
        eventType: "editing",
        summary: `Adding ${pkg} to environment.systemPackages`,
        raw: `Editing file: modules/darwin/default.nix | {"add":{"path":"environment.systemPackages","values":["${pkg}"]}}`,
        iteration: attempt,
        timestampMs: baseTime + 3000,
      },
      {
        eventType: "toolCall",
        summary: "Checking the configuration builds...",
        raw: 'build_check | args: host="Demo-MacBook-Pro"',
        iteration: attempt,
        timestampMs: baseTime + 3500,
      },
      {
        eventType: "buildFail",
        summary: `Build check failed: error: attribute '${pkg}' missing`,
        raw: `Build check failed: error: attribute '${pkg}' missing\n   at /flake.nix:12`,
        iteration: attempt,
        timestampMs: baseTime + 9000,
        detail: {
          type: "build",
          pass: false,
          attempt,
          output: `error: attribute '${pkg}' missing\n   at /flake.nix:12`,
        },
      },
    );
  }

  // The current attempt, still in progress.
  events.push(
    {
      eventType: "thinking",
      summary: "The package is unfree; enabling allowUnfree should fix it.",
      raw: "[debugging] The package is unfree; enabling allowUnfree should fix it.",
      iteration: 5,
      timestampMs: 110_000,
    },
    {
      eventType: "editing",
      summary: "Adding spotify to environment.systemPackages",
      raw: 'Editing file: modules/darwin/default.nix | {"add":{"path":"environment.systemPackages","values":["spotify"]}}',
      iteration: 5,
      timestampMs: 112_000,
    },
  );

  return events;
}

const allEventTypes: EvolveEvent[] = [
  {
    eventType: "start",
    summary: "Starting AI evolution...",
    raw: "Start event",
    iteration: null,
    timestampMs: 0,
  },
  {
    eventType: "info",
    summary: "Target host configured",
    raw: "Info event with details",
    iteration: null,
    timestampMs: 100,
  },
  {
    eventType: "iteration",
    summary: "Processing iteration 1...",
    raw: "Iteration event",
    iteration: 1,
    timestampMs: 500,
  },
  {
    eventType: "apiRequest",
    summary: "Querying AI model...",
    raw: "API request event",
    iteration: 1,
    timestampMs: 600,
  },
  {
    eventType: "apiResponse",
    summary: "Received AI response",
    raw: "API response with tokens",
    iteration: 1,
    timestampMs: 2000,
  },
  {
    eventType: "thinking",
    summary: "Detailed thinking content that shows the AI reasoning process.",
    raw: "[planning] Detailed thinking content that shows the AI reasoning process. More detail follows here.",
    iteration: 1,
    timestampMs: 2100,
  },
  {
    eventType: "reading",
    summary: "Reading config.nix",
    raw: "Reading file: path/to/config.nix",
    iteration: 1,
    timestampMs: 2500,
  },
  {
    eventType: "searchPackages",
    summary: "Searched packages for 'vim' → vim, neovim",
    raw: "Searched packages for 'vim'; found 2: vim, neovim",
    iteration: 1,
    timestampMs: 2800,
  },
  {
    eventType: "editing",
    summary: "Adding vim to environment.systemPackages",
    raw: 'Editing file: modules/darwin/default.nix | {"add":{"path":"environment.systemPackages","values":["vim"]}}',
    iteration: 1,
    timestampMs: 3000,
  },
  {
    eventType: "toolCall",
    summary: "Listing files...",
    raw: 'list_files | args: pattern="**/*"',
    iteration: 1,
    timestampMs: 3500,
  },
  {
    eventType: "buildCheck",
    summary: "Running build check...",
    raw: "Build check for host",
    iteration: 1,
    timestampMs: 4000,
  },
  {
    eventType: "buildPass",
    summary: "Build check passed ✓",
    raw: "Build passed successfully",
    iteration: 1,
    timestampMs: 8000,
  },
  {
    eventType: "buildFail",
    summary: "Build check failed: error: something went wrong",
    raw: "Build check failed: error: something went wrong\ntrace: more detail",
    iteration: 2,
    timestampMs: 12_000,
  },
  {
    eventType: "error",
    summary: "Error: Something went wrong",
    raw: "Detailed error message",
    iteration: 2,
    timestampMs: 15_000,
  },
  {
    eventType: "narration",
    summary: "Everything checks out.",
    raw: "Everything checks out. Wrapping up the change summary now.",
    iteration: 3,
    timestampMs: 17_000,
    detail: { type: "narration", text: "Everything checks out. Wrapping up the change summary now." },
  },
  {
    eventType: "summarizing",
    summary: "Analyzing changes...",
    raw: "Analyzing changes...",
    iteration: 3,
    timestampMs: 18_000,
  },
  {
    eventType: "complete",
    summary: "Evolution complete!",
    raw: "Summary of what was accomplished",
    iteration: 3,
    timestampMs: 20_000,
  },
];

// =============================================================================
// Stories
// =============================================================================

/**
 * Evolution in progress - shows live streaming events
 */
export const InProgress = meta.story({
  args: {
    events: mockEventsInProgress,
    isGenerating: true,
  },
});

/**
 * Evolution completed successfully
 */
export const Completed = meta.story({
  args: {
    events: mockEventsComplete,
    isGenerating: false,
  },
});

/**
 * Evolution with build failure and retry
 */
export const BuildFailure = meta.story({
  args: {
    events: mockEventsWithBuildFailure,
    isGenerating: true,
  },
});

/**
 * Evolution with error
 */
export const WithError = meta.story({
  args: {
    events: mockEventsWithError,
    isGenerating: false,
  },
});

/**
 * Just started - few events
 */
export const JustStarted = meta.story({
  args: {
    events: mockEventsFewEvents,
    isGenerating: true,
  },
});

/**
 * Empty state - no events yet
 */
export const Empty = meta.story({
  args: {
    events: [],
    isGenerating: true,
  },
});

/**
 * Minimal events - single start event
 */
export const SingleEvent = meta.story({
  args: {
    events: [
      {
        eventType: "start",
        summary: "Starting AI evolution...",
        raw: "Starting evolution",
        iteration: null,
        timestampMs: 0,
      },
    ],
    isGenerating: true,
  },
});

/**
 * Long running evolution across several failed build attempts: history rows
 * group by attempt, with failed attempts collapsed under their headers. The
 * explicit height exercises the internal scrolling the overlay panel gets by
 * stretching the component.
 */
export const ManyIterations = meta.story({
  args: {
    events: generateManyIterations(),
    isGenerating: true,
    className: "h-[400px]",
  },
});

/**
 * Various event types showcase. Machinery events (iteration, apiRequest,
 * apiResponse, and tool calls with a specific follow-up event) are present
 * in the data but filtered from the timeline by design.
 */
export const AllEventTypes = meta.story({
  args: {
    events: allEventTypes,
    isGenerating: false,
  },
});

/**
 * The agent's latest narration is the current activity: the sticky active
 * row shows it with its full text expanded as quiet detail.
 */
export const NarrationInFocus = meta.story({
  args: {
    events: [
      ...mockEventsInProgress,
      {
        eventType: "narration",
        summary: "The nixpkgs build is broken on darwin, so I'll use homebrew.",
        raw: "The nixpkgs build is broken on darwin, so I'll use homebrew. The cask list already carries other GUI apps in this config, so spotify fits there naturally.",
        iteration: 3,
        timestampMs: 5200,
        detail: {
          type: "narration",
          text: "The nixpkgs build is broken on darwin, so I'll use homebrew. The cask list already carries other GUI apps in this config, so spotify fits there naturally.",
        },
      },
    ],
    isGenerating: true,
  },
});

/**
 * Agent question with choices — the run is blocked until the user answers.
 * The question card is the sticky active row at the end of the timeline.
 */
export const AgentQuestion = meta.story({
  args: {
    events: [
      ...mockEventsInProgress,
      {
        eventType: "question",
        summary: "Which Spotify variant do you want?",
        raw: 'Which Spotify variant do you want?\nChoicesJson: ["spotify","spotifyd","spotify-player"]\nChoices: spotify, spotifyd, spotify-player',
        iteration: 2,
        timestampMs: 5000,
        detail: {
          type: "question",
          text: "Which Spotify variant do you want?",
          choices: ["spotify", "spotifyd", "spotify-player"],
          kind: "agent",
        },
      },
    ],
    isGenerating: true,
  },
});

/**
 * Free-text agent question.
 */
export const FreeTextQuestion = meta.story({
  args: {
    events: [
      ...mockEventsInProgress,
      {
        eventType: "question",
        summary: "What git email should I configure?",
        raw: "What git email should I configure?",
        iteration: 2,
        timestampMs: 5000,
        detail: {
          type: "question",
          text: "What git email should I configure?",
          choices: null,
          kind: "agent",
        },
      },
    ],
    isGenerating: true,
  },
});

/**
 * Safety-limit checkpoint: the system asks whether to keep going.
 */
export const CheckpointQuestion = meta.story({
  args: {
    events: [
      ...mockEventsInProgress,
      {
        eventType: "question",
        summary: "The AI has used 64.7K tokens. Keep going?",
        raw: 'The AI has used 64.7K tokens. Keep going?\nChoicesJson: ["Yes, keep going","Stop"]\nChoices: Yes, keep going, Stop',
        iteration: 2,
        timestampMs: 5000,
        detail: {
          type: "question",
          text: "The AI has used 64.7K tokens. Keep going?",
          choices: ["Yes, keep going", "Stop"],
          kind: "checkpoint",
        },
      },
    ],
    isGenerating: true,
  },
});

/**
 * A question already answered — collapsed into a Q&A record via the
 * Answered event that follows it.
 */
export const AnsweredQuestion = meta.story({
  args: {
    events: [
      ...mockEventsInProgress,
      {
        eventType: "question",
        summary: "Which Spotify variant do you want?",
        raw: "Which Spotify variant do you want?",
        iteration: 2,
        timestampMs: 5000,
        detail: {
          type: "question",
          text: "Which Spotify variant do you want?",
          choices: ["spotify", "spotifyd"],
          kind: "agent",
        },
      },
      {
        eventType: "answered",
        summary: "Answered: spotify",
        raw: "User answered: spotify",
        iteration: 2,
        timestampMs: 8000,
        detail: { type: "answered", text: "spotify" },
      },
      {
        eventType: "editing",
        summary: "Adding spotify to environment.systemPackages",
        raw: 'Editing file: modules/darwin/default.nix | {"add":{"path":"environment.systemPackages","values":["spotify"]}}',
        iteration: 3,
        timestampMs: 9000,
      },
    ],
    isGenerating: true,
  },
});
