import { create } from "zustand";
import { devtools } from "zustand/middleware";

export type SettingsTab =
  | "general"
  | "api-keys"
  | "ai-models"
  | "preferences"
  | "developer";

type ProcessingAction = "evolve" | "apply" | "merge" | "cancel" | null;

export type UiState = {
  evolvePrompt: string;
  isProcessing: boolean;
  processingAction: ProcessingAction;
  settingsOpen: boolean;
  settingsActiveTab: SettingsTab | null;
  showHistory: boolean;
  showFilesystem: boolean;
  /**
   * Optional initial section to focus when the Filesystem view opens
   * (e.g. when "View" on the Untracked banner is clicked, this is set
   * to "manage"). The view consumes and clears it on mount. `null`
   * means "use the view's default."
   */
  filesystemTargetSection: string | null;
  editingFile: string | null;
  promptHistory: string[];
};

export type UiActions = {
  setEvolvePrompt: (prompt: string) => void;
  setProcessing: (isProcessing: boolean, action?: ProcessingAction) => void;
  setSettingsOpen: (open: boolean, tab?: SettingsTab | null) => void;
  setShowHistory: (show: boolean) => void;
  /**
   * @param section optional initial section id; when omitted on a
   *   `show=true` call the view falls back to its default section.
   */
  setShowFilesystem: (show: boolean, section?: string | null) => void;
  setPromptHistory: (history: string[]) => void;
};

export type UiStore = UiState & UiActions;

const initialUiState: UiState = {
  evolvePrompt: "",
  isProcessing: false,
  processingAction: null,
  settingsOpen: false,
  settingsActiveTab: null,
  showHistory: false,
  showFilesystem: false,
  filesystemTargetSection: null,
  editingFile: null,
  promptHistory: [],
};

export function createUiStore(initial?: Partial<UiStore>) {
  return create<UiStore>()(
    devtools(
      (set) => ({
        ...initialUiState,
        ...initial,

        setEvolvePrompt: (evolvePrompt) => set({ evolvePrompt }),
        setProcessing: (isProcessing, action = null) =>
          set({
            isProcessing,
            processingAction: isProcessing ? action : null,
          }),
        setSettingsOpen: (settingsOpen, tab) =>
          set({ settingsOpen, settingsActiveTab: tab ?? null }),
        setShowHistory: (showHistory) => set({ showHistory }),
        setShowFilesystem: (showFilesystem, section = null) =>
          set({
            showFilesystem,
            filesystemTargetSection: showFilesystem ? section : null,
          }),
        setPromptHistory: (promptHistory) => set({ promptHistory }),
      }),
      { name: "ui-store", enabled: import.meta.env.DEV },
    ),
  );
}

export const useUiStore = createUiStore();
