// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import { useWidgetStore } from "@/stores/widget-store";
import type { EvolveEvent } from "@/stores/widget-store";
import type { SemanticChangeMap, EvolveState, GitStatus, Change } from "@/types/shared";
import { useEffect, useRef } from "react";
import { DarwinWidget } from "./widget";

// =============================================================================
// Mock Data
// =============================================================================

const mockChanges: Change[] = [
  {
    id: 1,
    hash: "abc123",
    filename: "configuration.nix",
    diff: `@@ -3,6 +3,8 @@
 {
   environment.systemPackages = with pkgs; [
     vim
+    htop
+    btop
     git
     ripgrep
     fd`,
    lineCount: 8,
    createdAt: Date.now() / 1000,
    ownSummaryId: 1,
  },
  {
    id: 2,
    hash: "def456",
    filename: "modules/monitoring.nix",
    diff: `@@ -0,0 +1,12 @@
+{ config, pkgs, ... }:
+
+{
+  # System monitoring tools
+  environment.systemPackages = with pkgs; [
+    htop
+    btop
+    bottom
+    bandwhich
+    procs
+  ];
+}`,
    lineCount: 12,
    createdAt: Date.now() / 1000,
    ownSummaryId: 2,
  },
];

const mockChangeMap: SemanticChangeMap = {
  groups: [
    {
      summary: {
        id: 1,
        title: "System Monitoring Tools",
        description:
          "Added htop, btop, bottom, bandwhich, and procs for comprehensive system monitoring. Created a dedicated monitoring module and updated the main configuration.",
        status: "DONE",
        createdAt: Date.now() / 1000,
      },
      changes: [
        {
          id: 1,
          hash: "abc123",
          filename: "configuration.nix",
          diff: "",
          lineCount: 8,
          createdAt: Date.now() / 1000,
          ownSummaryId: 1,
          title: "Add monitoring packages",
          description: "Added htop and btop to system packages",
        },
        {
          id: 2,
          hash: "def456",
          filename: "modules/monitoring.nix",
          diff: "",
          lineCount: 12,
          createdAt: Date.now() / 1000,
          ownSummaryId: 2,
          title: "New monitoring module",
          description: "Dedicated module for system monitoring tools",
        },
      ],
    },
  ],
  singles: [],
  unsummarizedHashes: [],
};

const mockGitStatus: GitStatus = {
  files: [
    { path: "configuration.nix", changeType: "edited" },
    { path: "modules/monitoring.nix", changeType: "new" },
  ],
  branch: "main",
  headIsBuilt: false,
  diff: mockChanges.map((c) => c.diff).join("\n"),
  additions: 14,
  deletions: 0,
  headCommitHash: "abc1234567890",
  cleanHead: false,
  changes: mockChanges,
};

const evolveStateBegin: EvolveState = {
  evolutionId: null,
  currentChangesetId: null,
  changesetAtBuild: null,
  committable: false,
  backupBranch: null,
  step: "begin",
};

const evolveStateEvolve: EvolveState = {
  evolutionId: 1,
  currentChangesetId: 1,
  changesetAtBuild: null,
  committable: false,
  backupBranch: "backup/pre-evolve-1",
  step: "evolve",
};

const evolveStateMerge: EvolveState = {
  evolutionId: 1,
  currentChangesetId: 1,
  changesetAtBuild: 1,
  committable: true,
  backupBranch: "backup/pre-evolve-1",
  step: "merge",
};

const mockEvolveEvents: EvolveEvent[] = [
  { raw: "Starting evolution...", summary: "Starting evolution", eventType: "start", iteration: null, timestampMs: 0 },
  { raw: "Iteration 1 of 25", summary: "Iteration 1", eventType: "iteration", iteration: 1, timestampMs: 1200 },
  { raw: "Analyzing current configuration to understand package structure...", summary: "Thinking about changes", eventType: "thinking", iteration: 1, timestampMs: 2400 },
  { raw: "read_file: configuration.nix", summary: "Reading configuration.nix", eventType: "reading", iteration: 1, timestampMs: 3100 },
  { raw: "edit_file: configuration.nix — adding htop and btop", summary: "Editing configuration.nix", eventType: "editing", iteration: 1, timestampMs: 4500 },
  { raw: "Creating modules/monitoring.nix with monitoring tools", summary: "Creating modules/monitoring.nix", eventType: "editing", iteration: 1, timestampMs: 5800 },
  { raw: "Running nix eval to verify syntax...", summary: "Checking build", eventType: "buildCheck", iteration: 1, timestampMs: 7200 },
  { raw: "Build check passed", summary: "Build passed", eventType: "buildPass", iteration: 1, timestampMs: 9500 },
  { raw: "Summarizing changes...", summary: "Analyzing changes", eventType: "summarizing", iteration: null, timestampMs: 10200 },
  { raw: "Evolution complete: 2 files changed, 14 additions", summary: "Evolution complete", eventType: "complete", iteration: null, timestampMs: 11800 },
];

// =============================================================================
// Wrapper Components
// =============================================================================

function WidgetWithState({ storeState }: { storeState: Record<string, unknown> }) {
  useEffect(() => {
    useWidgetStore.setState(storeState);
  }, [storeState]);

  return <DarwinWidget />;
}

function AnimatedEvolveFlow() {
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    useWidgetStore.setState({
      evolveState: evolveStateBegin,
      evolvePrompt: "Add system monitoring tools like htop and btop",
    });

    // Phase 1: Start generating (show overlay with streaming events)
    const t1 = setTimeout(() => {
      useWidgetStore.setState({
        isGenerating: true,
        evolveEvents: [mockEvolveEvents[0]],
      });
    }, 800);
    timeoutsRef.current.push(t1);

    // Stream events one by one
    for (let i = 1; i < mockEvolveEvents.length; i++) {
      const t = setTimeout(() => {
        useWidgetStore.setState((state) => ({
          evolveEvents: [...state.evolveEvents, mockEvolveEvents[i]],
        }));
      }, 800 + mockEvolveEvents[i].timestampMs);
      timeoutsRef.current.push(t);
    }

    // Phase 2: Evolution complete -> show review step with changes
    const completionTime = 800 + mockEvolveEvents[mockEvolveEvents.length - 1].timestampMs + 1500;
    const t2 = setTimeout(() => {
      useWidgetStore.setState({
        isGenerating: false,
        evolveState: evolveStateEvolve,
        gitStatus: mockGitStatus,
        changeMap: mockChangeMap,
        summaryAvailable: true,
      });
    }, completionTime);
    timeoutsRef.current.push(t2);

    // Phase 3: Transition to merge step
    const t3 = setTimeout(() => {
      useWidgetStore.setState({
        evolveState: evolveStateMerge,
        commitMessageSuggestion: "feat: add system monitoring tools (htop, btop, bottom, bandwhich, procs)",
      });
    }, completionTime + 5000);
    timeoutsRef.current.push(t3);

    return () => {
      for (const t of timeoutsRef.current) clearTimeout(t);
    };
  }, []);

  return <DarwinWidget />;
}

// =============================================================================
// Meta
// =============================================================================

const meta = preview.meta({
  title: "Flows/Evolve",
  component: DarwinWidget,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story: React.ComponentType) => (
      <div className="m-8 relative min-h-[300px] min-w-[420px] overflow-hidden rounded-xl border border-border bg-background flex items-center justify-center">
        <Story />
      </div>
    ),
  ],
});

export default meta;

// =============================================================================
// Stories
// =============================================================================

/** Step 1: Idle state — prompt input and "Get started" message. */
export const Begin = meta.story({
  name: "1. Begin (idle)",
  render: () => (
    <WidgetWithState
      storeState={{
        evolveState: evolveStateBegin,
        gitStatus: { ...mockGitStatus, files: [], changes: [], diff: "", additions: 0, deletions: 0, cleanHead: true },
      }}
    />
  ),
});

/** Step 2: Evolve overlay with streaming progress events. */
export const Evolving = meta.story({
  name: "2. Evolving (progress)",
  render: () => (
    <WidgetWithState
      storeState={{
        evolveState: evolveStateBegin,
        isGenerating: true,
        evolvePrompt: "Add system monitoring tools",
        evolveEvents: mockEvolveEvents.slice(0, 7),
      }}
    />
  ),
});

/** Step 3: Evolution complete — summary/diff of changes with Discard / Build & Test buttons. */
export const Review = meta.story({
  name: "3. Review (changes generated)",
  render: () => (
    <WidgetWithState
      storeState={{
        evolveState: evolveStateEvolve,
        gitStatus: mockGitStatus,
        changeMap: mockChangeMap,
        summaryAvailable: true,
        evolveEvents: mockEvolveEvents,
      }}
    />
  ),
});

/** Step 4: After Build & Test — merge step with commit message and Commit button. */
export const Merge = meta.story({
  name: "4. Merge (ready to commit)",
  render: () => (
    <WidgetWithState
      storeState={{
        evolveState: evolveStateMerge,
        gitStatus: mockGitStatus,
        changeMap: mockChangeMap,
        summaryAvailable: true,
        commitMessageSuggestion: "feat: add system monitoring tools (htop, btop, bottom, bandwhich, procs)",
      }}
    />
  ),
});

/** Animated walkthrough: begin -> evolving -> review -> merge, auto-advancing over ~20s. */
export const FullFlowAnimated = meta.story({
  name: "Full Flow (animated)",
  render: () => <AnimatedEvolveFlow />,
});
