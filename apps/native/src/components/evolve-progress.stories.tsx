// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import type React from "react";
import preview from "#storybook/preview";
import type { EvolveEvent } from "@/tauri-api";
import { EvolveProgress } from "./evolve-progress";

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
    summary: "Planning approach...",
    raw: "[planning] I need to understand the current nix-darwin configuration structure before making changes. Let me first read the main configuration file to see what's already set up.",
    iteration: 1,
    timestampMs: 2400,
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
  },
  {
    eventType: "toolCall",
    summary: "Using read_file tool...",
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
    summary: "Using edit_file tool...",
    raw: 'edit_file | args: path="modules/darwin/default.nix"',
    iteration: 3,
    timestampMs: 7250,
  },
  {
    eventType: "editing",
    summary: "Editing default.nix",
    raw: "Editing file: modules/darwin/default.nix",
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
    summary: "Using build_check tool...",
    raw: 'build_check | args: host="Demo-MacBook-Pro"',
    iteration: 4,
    timestampMs: 9550,
  },
  {
    eventType: "buildCheck",
    summary: "Running build check...",
    raw: "Running build check for host: Demo-MacBook-Pro",
    iteration: 4,
    timestampMs: 9600,
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
    eventType: "buildCheck",
    summary: "Running build check...",
    raw: "Running build check for host: Demo-MacBook-Pro",
    iteration: 2,
    timestampMs: 4050,
  },
  {
    eventType: "buildFail",
    summary: "Build check failed, retrying...",
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
    summary: "Debugging an issue...",
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

// Generate many iterations for stress testing
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

  for (let i = 0; i < 20; i++) {
    const baseTime = (i + 1) * 3000;
    events.push(
      {
        eventType: "iteration",
        summary: `Processing iteration ${i + 1}...`,
        raw: `Iteration ${i + 1}`,
        iteration: i + 1,
        timestampMs: baseTime,
      },
      {
        eventType: "apiRequest",
        summary: "Querying AI model...",
        raw: "Sending request",
        iteration: i + 1,
        timestampMs: baseTime + 100,
      },
      {
        eventType: "apiResponse",
        summary: "Received AI response",
        raw: `Tokens: ${1000 + i * 200}`,
        iteration: i + 1,
        timestampMs: baseTime + 2000,
      },
      {
        eventType: "thinking",
        summary: "Thinking...",
        raw: `[analysis] Analyzing iteration ${i + 1}`,
        iteration: i + 1,
        timestampMs: baseTime + 2500,
      },
    );
  }

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
    summary: "Planning approach...",
    raw: "[planning] Detailed thinking content that shows the AI reasoning process",
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
    eventType: "editing",
    summary: "Editing default.nix",
    raw: "Editing file: modules/darwin/default.nix",
    iteration: 1,
    timestampMs: 3000,
  },
  {
    eventType: "toolCall",
    summary: "Using list_files tool...",
    raw: 'list_files | args: path="."',
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
    summary: "Build check failed, retrying...",
    raw: "Build failed with error details",
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
 * Long running evolution with many iterations
 */
export const ManyIterations = meta.story({
  args: {
    events: generateManyIterations(),
    isGenerating: true,
  },
});

/**
 * Various event types showcase
 */
export const AllEventTypes = meta.story({
  args: {
    events: allEventTypes,
    isGenerating: false,
  },
});
