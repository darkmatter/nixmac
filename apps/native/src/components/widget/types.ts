import type {
  AppState,
  EvolveEvent,
  GitStatus,
  ProcessingAction,
  SummaryState,
  WidgetStep,
} from "@/stores/widget-store";

export interface WidgetUIProps extends React.HTMLAttributes<HTMLDivElement> {
  // State
  step: WidgetStep;
  appState: AppState;
  gitStatus: GitStatus | null;
  evolvePrompt: string;
  commitMsg: string;
  isProcessing: boolean;
  isGenerating: boolean;
  processingAction: ProcessingAction;
  evolveEvents: EvolveEvent[];
  summary: SummaryState;
  consoleLogs: string;
  consoleExpanded: boolean;
  settingsOpen: boolean;
  error: string | null;

  // Handlers
  onEvolve: () => void;
  onApply: () => void;
  onCommit: () => void;
  onCancel: () => void;
  onEvolvePromptChange: (prompt: string) => void;
  onCommitMsgChange: (msg: string) => void;
  onConsoleExpandedChange: (expanded: boolean) => void;
  onSettingsOpenChange: (open: boolean) => void;
  onErrorDismiss: () => void;
  onShowCommitScreen: () => void;
  onBackFromCommit: () => void;

  // Preferences (optional - defaults provided)
  prefFloatingFooter?: boolean;
  setPrefFloatingFooter?: (enabled: boolean) => void;
  prefWindowShadow?: boolean;
  setPrefWindowShadow?: (enabled: boolean) => void;
  openaiApiKey?: string;
  setOpenaiApiKey?: (key: string) => void;
}

export const STEPPER_STEPS = [
  { id: 1 as const, name: "Evolve", description: "Make changes" },
  { id: 2 as const, name: "Preview", description: "Review effects" },
  { id: 3 as const, name: "Commit", description: "Save to git" },
];

export type StepperStepId = 1 | 2 | 3;
