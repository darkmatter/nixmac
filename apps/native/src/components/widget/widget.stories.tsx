// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import { fn } from "@storybook/test";
import type React from "react";
import { useState } from "react";
import preview from "#storybook/preview";
import {
  defaultPermissions,
  type Permission,
  PermissionsScreen,
} from "@/components/permissions-screen";
import type {
  EvolveEvent,
  GitStatus,
  SummaryState,
} from "@/stores/widget-store";
import { Header } from "./header";
import { WidgetUI, type WidgetUIProps } from "./widget-ui";

// =============================================================================
// Meta
// =============================================================================

// Storybook 10 alpha types have inference issues - cast to any until stable release
/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
const meta = preview.meta({
  title: "Widget/DarwinWidget",
  component: WidgetUI,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story: React.ComponentType) => (
      <div className="relative m-2 overflow-hidden">
        <Story />
      </div>
    ),
  ],
  tags: ["autodocs"],
  argTypes: {
    step: {
      control: "select",
      options: ["setup", "overview", "evolving"],
    },
    appState: {
      control: "select",
      options: ["onboarding", "idle", "generating", "preview"],
    },
    peekState: {
      control: "select",
      options: ["hidden", "peeking", "expanded"],
    },
    processingAction: {
      control: "select",
      options: [null, "evolve", "apply", "commit", "cancel"],
    },
  },
});

export default meta;

// =============================================================================
// Mock Data
// =============================================================================

const mockGitStatus: GitStatus = {
  hasChanges: true,
  files: [
    { path: "modules/darwin/default.nix", working_tree: "M" },
    { path: "modules/home/default.nix", working_tree: "M" },
    { path: "modules/darwin/vim.nix", index: "A" },
  ],
};

// All changes staged (ready for commit after preview)
const mockGitStatusAllStaged: GitStatus = {
  hasChanges: true,
  files: [
    { path: "modules/darwin/default.nix", index: "M" },
    { path: "modules/home/default.nix", index: "M" },
    { path: "modules/darwin/vim.nix", index: "A" },
  ],
};

const mockSummary: SummaryState = {
  items: [
    {
      title: "Vim Editor Installed",
      description:
        "Added vim to your system packages with custom configuration for a better editing experience.",
    },
    {
      title: "Git Settings Updated",
      description: "Configured your git user name and email for commits.",
    },
    {
      title: "Rectangle App Added",
      description:
        "Installed Rectangle window manager via Homebrew for better window management.",
    },
  ],
  instructions:
    "Run 'vim .' in your terminal to try out your new editor, or open Rectangle from your Applications folder.",
  commitMessage: "feat(darwin): add vim and configure git",
  filesChanged: 3,
  isLoading: false,
};

const mockEvolveEvents: EvolveEvent[] = [
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
    raw: "Sending request to OpenAI API",
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
    eventType: "thinking",
    summary: "Planning approach...",
    raw: "[planning] Analyzing configuration structure...",
    iteration: 1,
    timestampMs: 2400,
  },
  {
    eventType: "reading",
    summary: "Reading default.nix",
    raw: "Reading file: modules/darwin/default.nix",
    iteration: 2,
    timestampMs: 4600,
  },
];

// =============================================================================
// Interactive Wrapper Component
// =============================================================================

type PartialUIProps = Partial<WidgetUIProps>;

/**
 * Wrapper that adds React state for interactive UI.
 * Actions are logged via fn() and state updates immediately.
 */
function InteractiveWidget(initialProps: PartialUIProps) {
  const defaults: WidgetUIProps = {
    className: "",
    step: "overview",
    appState: "idle",
    configDir: "/Users/demo/.darwin",
    hosts: ["Demo-MacBook-Pro", "Work-MacBook"],
    host: "Demo-MacBook-Pro",
    gitStatus: null,
    evolvePrompt: "",
    commitMsg: "",
    isProcessing: false,
    isGenerating: false,
    processingAction: null,
    evolveEvents: [],
    summary: {
      summary: null,
      commitMessage: null,
      filesChanged: 0,
      isLoading: false,
    },
    consoleLogs: "",
    consoleExpanded: false,
    isExpanded: true,
    peekState: "expanded",
    settingsOpen: false,
    error: null,
    onExpand: fn(),
    onCollapse: fn(),
    onPickDir: fn(),
    onSaveHost: fn(),
    onEvolve: fn(),
    onApply: fn(),
    onCommit: fn(),
    onCancel: fn(),
    onEvolvePromptChange: fn(),
    onCommitMsgChange: fn(),
    onConsoleExpandedChange: fn(),
    onSettingsOpenChange: fn(),
    onErrorDismiss: fn(),
    onHostsChange: fn(),
    onShowCommitScreen: fn(),
    onBackFromCommit: fn(),
    ...initialProps,
  };

  // Local state for interactive controls
  const [isExpanded, setIsExpanded] = useState(defaults.isExpanded);
  const [peekState, setPeekState] = useState(defaults.peekState);
  const [evolvePrompt, setEvolvePrompt] = useState(defaults.evolvePrompt);
  const [commitMsg, setCommitMsg] = useState(defaults.commitMsg);
  const [consoleExpanded, setConsoleExpanded] = useState(
    defaults.consoleExpanded
  );
  const [settingsOpen, setSettingsOpen] = useState(defaults.settingsOpen);
  const [host, setHost] = useState(defaults.host);
  const [error, setError] = useState(defaults.error);

  return (
    <WidgetUI
      {...defaults}
      commitMsg={commitMsg}
      consoleExpanded={consoleExpanded}
      error={error}
      evolvePrompt={evolvePrompt}
      host={host}
      isExpanded={isExpanded}
      onCollapse={() => {
        setIsExpanded(false);
        setPeekState("hidden");
        defaults.onCollapse();
      }}
      onCommitMsgChange={(msg) => {
        setCommitMsg(msg);
        defaults.onCommitMsgChange(msg);
      }}
      onConsoleExpandedChange={(expanded) => {
        setConsoleExpanded(expanded);
        defaults.onConsoleExpandedChange(expanded);
      }}
      onErrorDismiss={() => {
        setError(null);
        defaults.onErrorDismiss();
      }}
      onEvolvePromptChange={(prompt) => {
        setEvolvePrompt(prompt);
        defaults.onEvolvePromptChange(prompt);
      }}
      onExpand={() => {
        setIsExpanded(true);
        setPeekState("expanded");
        defaults.onExpand();
      }}
      onSaveHost={(h) => {
        setHost(h);
        defaults.onSaveHost(h);
      }}
      onSettingsOpenChange={(open) => {
        setSettingsOpen(open);
        defaults.onSettingsOpenChange(open);
      }}
      peekState={peekState}
      settingsOpen={settingsOpen}
    />
  );
}

// =============================================================================
// Stories: Main Lifecycle States
// =============================================================================

/**
 * Collapsed state - only shows the floating button
 */
export const Collapsed = meta.story({
  render: () => <InteractiveWidget isExpanded={false} peekState="hidden" />,
});

/**
 * Onboarding - First time setup when no config exists
 */
export const Onboarding = meta.story({
  render: () => (
    <InteractiveWidget
      appState="onboarding"
      configDir=""
      host=""
      hosts={[]}
      step="setup"
    />
  ),
});

/**
 * Onboarding with directory selected, waiting for host
 */
export const OnboardingWithDirectory = meta.story({
  render: () => (
    <InteractiveWidget
      appState="onboarding"
      configDir="/Users/demo/.darwin"
      host=""
      hosts={["Demo-MacBook-Pro", "Work-MacBook"]}
      step="setup"
    />
  ),
});

/**
 * Idle - Default state, ready for new evolution
 */
export const Idle = meta.story({
  render: () => <InteractiveWidget appState="idle" step="overview" />,
});

/**
 * Idle with prompt entered
 */
export const IdleWithPrompt = meta.story({
  render: () => (
    <InteractiveWidget
      appState="idle"
      evolvePrompt="Install vim and configure git with my email"
      step="overview"
    />
  ),
});

/**
 * Generating - AI is generating configuration changes
 */
export const Generating = meta.story({
  render: () => (
    <InteractiveWidget
      appState="generating"
      consoleExpanded={false}
      consoleLogs={'> Evolving: "Install vim and configure git"\n'}
      evolveEvents={mockEvolveEvents}
      evolvePrompt="Install vim and configure git"
      isGenerating={true}
      isProcessing={true}
      processingAction="evolve"
      step="evolving"
    />
  ),
});

/**
 * Generating with detailed progress - shows the streaming events UI with more events
 */
export const GeneratingWithProgress = meta.story({
  render: () => (
    <InteractiveWidget
      appState="generating"
      consoleExpanded={false}
      consoleLogs={'> Evolving: "Install vim and configure git"\n'}
      evolveEvents={[
        ...mockEvolveEvents,
        {
          eventType: "editing",
          summary: "Editing default.nix",
          raw: "Editing file: modules/darwin/default.nix",
          iteration: 3,
          timestampMs: 6000,
        },
        {
          eventType: "buildCheck",
          summary: "Running build check...",
          raw: "Running build check for host: Demo-MacBook-Pro",
          iteration: 3,
          timestampMs: 6500,
        },
      ]}
      evolvePrompt="Install vim and configure git"
      isGenerating={true}
      isProcessing={true}
      processingAction="evolve"
      step="evolving"
    />
  ),
});

/**
 * Evolving - Changes generated, waiting for user action
 */
export const Evolving = meta.story({
  render: () => (
    <InteractiveWidget
      appState="idle"
      consoleLogs={'> Evolving: "Install vim"\n✓ Evolution complete\n'}
      gitStatus={mockGitStatus}
      step="evolving"
    />
  ),
});

/**
 * Applying - Running darwin-rebuild switch
 */
export const Applying = meta.story({
  render: () => (
    <InteractiveWidget
      appState="idle"
      consoleExpanded={true}
      consoleLogs={
        "> Running darwin-rebuild switch...\nbuilding the system configuration...\n"
      }
      gitStatus={mockGitStatus}
      isProcessing={true}
      processingAction="apply"
      step="evolving"
    />
  ),
});

/**
 * Preview - Changes applied, waiting for commit
 */
export const Preview = meta.story({
  render: () => (
    <InteractiveWidget
      appState="preview"
      commitMsg="feat(darwin): add vim and configure git"
      consoleExpanded={true}
      consoleLogs={
        "> Running darwin-rebuild switch...\n✓ Apply complete\n\nChanges are now active. Commit to save or discard to revert.\n"
      }
      gitStatus={mockGitStatus}
      step="evolving"
      summary={mockSummary}
    />
  ),
});

/**
 * Preview with summary loading
 */
export const PreviewLoading = meta.story({
  render: () => (
    <InteractiveWidget
      appState="preview"
      consoleLogs={"> Running darwin-rebuild switch...\n✓ Apply complete\n"}
      gitStatus={mockGitStatus}
      step="evolving"
      summary={{
        summary: null,
        commitMessage: null,
        filesChanged: 0,
        isLoading: true,
      }}
    />
  ),
});

/**
 * Committing - Saving changes to git
 */
export const Committing = meta.story({
  render: () => (
    <InteractiveWidget
      appState="preview"
      commitMsg="feat(darwin): add vim and configure git"
      consoleExpanded={true}
      consoleLogs={'> Committing: "feat(darwin): add vim and configure git"\n'}
      gitStatus={mockGitStatus}
      isProcessing={true}
      processingAction="commit"
      step="evolving"
      summary={mockSummary}
    />
  ),
});

// =============================================================================
// Stories: Edge Cases & Errors
// =============================================================================

/**
 * Error state - Shows error banner
 */
export const WithError = meta.story({
  render: () => (
    <InteractiveWidget
      appState="idle"
      error="Failed to connect to nix daemon. Is the Nix daemon running?"
      step="overview"
    />
  ),
});

/**
 * Many changed files
 */
export const ManyChangedFiles = meta.story({
  render: () => (
    <InteractiveWidget
      appState="preview"
      commitMsg="feat: comprehensive system setup"
      gitStatus={{
        hasChanges: true,
        files: [
          { path: "modules/darwin/default.nix", working_tree: "M" },
          { path: "modules/home/default.nix", working_tree: "M" },
          { path: "modules/darwin/vim.nix", index: "A" },
          { path: "modules/darwin/git.nix", index: "A" },
          { path: "modules/darwin/homebrew.nix", working_tree: "M" },
          { path: "modules/home/shell.nix", working_tree: "M" },
          { path: "flake.nix", working_tree: "M" },
          { path: "flake.lock", working_tree: "M" },
        ],
      }}
      step="evolving"
      summary={{
        ...mockSummary,
        filesChanged: 8,
      }}
    />
  ),
});

/**
 * Console with lots of output
 */
export const ConsoleWithOutput = meta.story({
  render: () => (
    <InteractiveWidget
      appState="preview"
      consoleExpanded={true}
      consoleLogs={`> Running darwin-rebuild switch...
building the system configuration...
these 3 derivations will be built:
  /nix/store/abc123-darwin-system.drv
  /nix/store/def456-home-manager.drv
  /nix/store/ghi789-user-environment.drv
building '/nix/store/abc123-darwin-system.drv'...
copying path '/nix/store/...'
setting up /etc...
setting up launchd services...
setting up user defaults...
✓ Apply complete

Changes are now active. Commit to save or discard to revert.`}
      gitStatus={mockGitStatus}
      step="evolving"
      summary={mockSummary}
    />
  ),
});

/**
 * Settings dialog open
 */
export const SettingsOpen = meta.story({
  render: () => (
    <InteractiveWidget appState="idle" settingsOpen={true} step="overview" />
  ),
});

// =============================================================================
// Stories: Peeking States
// =============================================================================

/**
 * Peeking - Partial reveal on hover
 */
export const Peeking = meta.story({
  render: () => <InteractiveWidget isExpanded={true} peekState="peeking" />,
});

// =============================================================================
// Stories: New Preview/Commit Flow
// =============================================================================

/**
 * Evolving with unstaged changes - shows Preview button
 */
export const EvolvingWithUnstagedChanges = meta.story({
  render: () => (
    <InteractiveWidget
      appState="idle"
      gitStatus={mockGitStatus}
      step="evolving"
    />
  ),
});

/**
 * Evolving with all changes staged - shows Commit button
 */
export const EvolvingReadyToCommit = meta.story({
  render: () => (
    <InteractiveWidget
      appState="preview"
      gitStatus={mockGitStatusAllStaged}
      step="evolving"
      summary={mockSummary}
    />
  ),
});

/**
 * Commit Screen - enter commit message
 */
export const CommitScreen = meta.story({
  render: () => (
    <InteractiveWidget
      appState="preview"
      commitMsg=""
      gitStatus={mockGitStatusAllStaged}
      step="commit"
      summary={mockSummary}
    />
  ),
});

/**
 * Commit Screen with message entered
 */
export const CommitScreenWithMessage = meta.story({
  render: () => (
    <InteractiveWidget
      appState="preview"
      commitMsg="feat(darwin): add vim and configure git settings"
      gitStatus={mockGitStatusAllStaged}
      step="commit"
      summary={mockSummary}
    />
  ),
});

// =============================================================================
// Stories: Onboarding Flow with Permissions
// =============================================================================

/**
 * Interactive wrapper that simulates the full onboarding flow including permissions
 */
function OnboardingFlowWithPermissions() {
  // Track which step of onboarding we're in
  // Start in permissions step for testing/demo
  const [onboardingStep, setOnboardingStep] = useState<
    "setup" | "permissions" | "complete"
  >("permissions");
  const [configDir, setConfigDir] = useState("/Users/demo/.darwin");
  const [host, setHost] = useState("Demo-MacBook-Pro");

  // Simulate directory picker
  const handlePickDir = () => {
    setConfigDir("/Users/demo/.darwin");
  };

  // Simulate host selection completing setup step
  const handleSaveHost = (h: string) => {
    setHost(h);
    // Move to permissions step after host is selected
    setOnboardingStep("permissions");
  };

  // Handle permissions complete
  const handlePermissionsComplete = () => {
    setOnboardingStep("complete");
  };

  // No-op handlers for header buttons in story
  // biome-ignore lint/suspicious/noEmptyBlockStatements: story mock
  const handleOpenSettings = () => {};
  // biome-ignore lint/suspicious/noEmptyBlockStatements: story mock
  const handleCollapse = () => {};

  // Show permissions screen inside the widget
  if (onboardingStep === "permissions") {
    return (
      <div className="flex h-full w-full flex-col">
        <div className="relative flex-1">
          <div className="absolute inset-0">
            <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-border bg-card/90 shadow-2xl backdrop-blur-xl">
              {/* Widget Header */}
              <Header
                onOpenSettings={handleOpenSettings}
                setIsExpanded={handleCollapse}
              />
              {/* Permissions Content */}
              <PermissionsScreen
                compact
                onComplete={handlePermissionsComplete}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Show completed state (main console)
  if (onboardingStep === "complete") {
    return (
      <InteractiveWidget
        appState="idle"
        configDir={configDir}
        host={host}
        hosts={["Demo-MacBook-Pro", "Work-MacBook"]}
        step="overview"
      />
    );
  }

  // Show setup step (config dir + host selection)
  return (
    <InteractiveWidget
      appState="onboarding"
      configDir={configDir}
      host=""
      hosts={configDir ? ["Demo-MacBook-Pro", "Work-MacBook"] : []}
      onPickDir={handlePickDir}
      onSaveHost={handleSaveHost}
      step="setup"
    />
  );
}

/**
 * Full Onboarding Flow with Permissions
 *
 * This story demonstrates the complete onboarding experience:
 * 1. Setup step - Select config directory and host
 * 2. Permissions step - Grant required system permissions
 * 3. Main console - Ready to use nixmac
 *
 * Click "Browse" to select a directory, then select a host to proceed
 * to the permissions screen.
 */
export const OnboardingWithPermissions = meta.story({
  render: () => <OnboardingFlowWithPermissions />,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story: React.ComponentType) => (
      <div className="relative h-screen w-full overflow-hidden">
        <Story />
      </div>
    ),
  ],
});

/**
 * Permissions step in onboarding - standalone view
 *
 * Shows just the permissions screen as it appears during onboarding,
 * without the widget wrapper.
 */
export const OnboardingPermissionsStep = meta.story({
  render: () => (
    <PermissionsScreen
      onComplete={() => {
        fn()();
      }}
    />
  ),
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story: React.ComponentType) => (
      <div className="h-screen w-full">
        <Story />
      </div>
    ),
  ],
});
