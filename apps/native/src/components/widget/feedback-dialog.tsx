import { useEffect, useState } from "react";
import { useCurrentStep, useWidgetStore } from "@/stores/widget-store";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Lightbulb, Bug, MessageCircle, Info, Loader2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Feedback as FeedbackModel, FeedbackType, ShareOptions } from "@/types/feedback";
import { darwinAPI } from "@/tauri-api";
import { toast } from "sonner";

const DEFAULT_SHARE_OPTIONS: ShareOptions = {
  currentAppState: true,
  systemInfo: true,
  usageStats: true,
  evolutionLog: true,
  changedNixFiles: true,
  aiProviderModelInfo: true,
  buildErrorOutput: true,
  flakeInputsSnapshot: true,
  appLogs: true,
};

const ISSUE_SHARE_OPTIONS: ShareOptions = {
  currentAppState: true,
  systemInfo: true,
  usageStats: true,
  evolutionLog: true,
  changedNixFiles: true,
  aiProviderModelInfo: true,
  buildErrorOutput: true,
  flakeInputsSnapshot: true,
  appLogs: true,
};

// Visibility helper functions for share options checkboxes
// Each function returns a boolean indicating whether the checkbox should be visible
// Parameters: feedbackType, step, mainWindowError

function shouldShowCurrentAppState(
  _feedbackType: FeedbackType,
  _step: string,
  _mainWindowError?: string,
): boolean {
  return true;
}

function shouldShowSystemInfo(
  _feedbackType: FeedbackType,
  _step: string,
  _mainWindowError?: string,
): boolean {
  return true;
}

function shouldShowUsageStats(
  _feedbackType: FeedbackType,
  _step: string,
  _mainWindowError?: string,
): boolean {
  return true;
}

// Tooltip helpers for share options
const shareOptionTooltips: Record<string, string> = {
  currentAppState:
    "Current step in the workflow (permissions, setup, evolving, merge), active view, any feature flags, and evolution progress if applicable.",
  systemInfo:
    "macOS version, nixmac version, Nix version, and system architecture to understand your environment.",
  usageStats:
    "Total evolutions run, success rate, and average iterations per evolution to track your usage patterns.",
  evolutionLog:
    "Full agent trace including all iterations, AI requests/responses, file operations, build checks, and reasoning steps from the most recent evolution.",
  changedNixFiles:
    "Git diff of all modified Nix files, including both staged and unstaged changes, to see exactly what was modified.",
  aiProviderModelInfo:
    "AI model provider and model name being used for evolutions and summaries, plus token usage statistics and latency metrics from the most recent evolution.",
  buildErrorOutput:
    "Output from the most recent build check failure, if any occurred during evolution.",
  flakeInputsSnapshot:
    "Current revisions of nixpkgs, nix-darwin, and home-manager from your flake.lock to reproduce the exact environment.",
  nixConfig:
    "Complete snapshot of all .nix configuration files in your modules/ directory with timestamp and file list.",
  appLogs:
    "Last 200 lines from the most recent darwin-rebuild log file to see recent system events and errors.",
};

function shouldShowEvolutionLog(
  feedbackType: FeedbackType,
  step: string,
  _mainWindowError?: string,
): boolean {
  switch (feedbackType) {
    case FeedbackType.Suggestion:
    case FeedbackType.General:
      return false;
    case FeedbackType.Bug:
      return true;
    case FeedbackType.Issue:
      switch (step) {
        case "setup":
          return false;
        case "evolving":
          return true;
        case "merge":
          return true;
        default:
          return false;
      }
    case FeedbackType.Error:
      return true;
    default:
      return false;
  }
}

function shouldShowChangedNixFiles(
  feedbackType: FeedbackType,
  step: string,
  _mainWindowError?: string,
): boolean {
  switch (feedbackType) {
    case FeedbackType.Suggestion:
    case FeedbackType.General:
      return false;
    case FeedbackType.Bug:
    case FeedbackType.Error:
      return true;
    case FeedbackType.Issue:
      switch (step) {
        case "setup":
          return false;
        case "evolving":
          return true;
        case "merge":
          return true;
        default:
          return false;
      }
    default:
      return false;
  }
}

function shouldShowAiProviderModelInfo(
  feedbackType: FeedbackType,
  step: string,
  _mainWindowError?: string,
): boolean {
  switch (feedbackType) {
    case FeedbackType.Suggestion:
    case FeedbackType.General:
    case FeedbackType.Bug:
      return false;
    case FeedbackType.Issue:
      switch (step) {
        case "setup":
          return false;
        case "evolving":
          return true;
        case "merge":
          return true;
        default:
          return false;
      }
    case FeedbackType.Error:
      return true;
    default:
      return false;
  }
}

function shouldShowBuildErrorOutput(
  feedbackType: FeedbackType,
  step: string,
  mainWindowError?: string,
): boolean {
  switch (feedbackType) {
    case FeedbackType.Suggestion:
    case FeedbackType.General:
    case FeedbackType.Bug:
      return false;
    case FeedbackType.Issue:
      switch (step) {
        case "setup":
          return false;
        case "evolving":
          return !!mainWindowError; // only show if there's an error in the main window
        case "merge":
          return false;
        default:
          return false;
      }
    case FeedbackType.Error:
      return true;
    default:
      return false;
  }
}

function shouldShowFlakeInputsSnapshot(
  feedbackType: FeedbackType,
  step: string,
  mainWindowError?: string,
): boolean {
  switch (feedbackType) {
    case FeedbackType.Suggestion:
    case FeedbackType.General:
    case FeedbackType.Bug:
      return false;
    case FeedbackType.Issue:
      switch (step) {
        case "setup":
          return false;
        case "evolving":
          return false;
        case "merge":
          return !!mainWindowError; // only show if there's an error in the main window
        default:
          return false;
      }
    case FeedbackType.Error:
      return true;
    default:
      return false;
  }
}

function shouldShowAppLogs(
  feedbackType: FeedbackType,
  step: string,
  _mainWindowError?: string,
): boolean {
  switch (feedbackType) {
    case FeedbackType.Suggestion:
    case FeedbackType.General:
      return false;
    case FeedbackType.Issue:
      switch (step) {
        case "setup":
          return false;
        case "evolving":
          return true;
        case "merge":
          return true;
        default:
          return false;
      }
    case FeedbackType.Bug:
      return true;
    default:
      return false;
  }
}

export function FeedbackDialog() {
  const feedbackOpen = useWidgetStore((s) => s.feedbackOpen);
  const setFeedbackOpen = useWidgetStore((s) => s.setFeedbackOpen);
  const feedbackTypeOverride = useWidgetStore((s) => s.feedbackTypeOverride);
  const feedbackInitialText = useWidgetStore((s) => s.feedbackInitialText);
  const panicDetails = useWidgetStore((s) => s.panicDetails);
  const setFeedbackTypeOverride = useWidgetStore((s) => s.setFeedbackTypeOverride);
  const step = useCurrentStep();
  const mainWindowError = useWidgetStore((s) => s.error) ?? undefined;

  const [feedbackType, setFeedbackType] = useState<FeedbackType>(FeedbackType.Suggestion);
  const [feedbackText, setFeedbackText] = useState("");
  const [expectedText, setExpectedText] = useState("");
  const [email, setEmail] = useState("");
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
  const [relatedPrompt, setRelatedPrompt] = useState("");
  const [shareOptions, setShareOptions] = useState<ShareOptions>(DEFAULT_SHARE_OPTIONS);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!feedbackOpen) {
      return;
    }

    darwinAPI.promptHistory.get().then(setPromptHistory).catch(console.error);
  }, [feedbackOpen]);

  useEffect(() => {
    if (!feedbackOpen || !feedbackTypeOverride) {
      return;
    }

    setFeedbackType(feedbackTypeOverride);
    if (
      feedbackTypeOverride === FeedbackType.Issue ||
      feedbackTypeOverride === FeedbackType.Error
    ) {
      setShareOptions(ISSUE_SHARE_OPTIONS);
    }
  }, [feedbackOpen, feedbackTypeOverride]);

  // Pre-populate feedback text when opening with initial text (e.g., from panic)
  useEffect(() => {
    if (!feedbackOpen || !feedbackInitialText) {
      return;
    }

    setFeedbackText(feedbackInitialText);
  }, [feedbackOpen, feedbackInitialText]);

  // When the user actively selects a feedback type, reset the evolutionLog
  // share option to the sensible default for that type. It's acceptable to
  // reset this if the user moves between radio buttons while in the dialog.
  useEffect(() => {
    if (!feedbackOpen) return;

    if (feedbackType === FeedbackType.Suggestion || feedbackType === FeedbackType.General) {
      setShareOptions((prev) => ({ ...prev, evolutionLog: false }));
    } else if (
      feedbackType === FeedbackType.Bug ||
      feedbackType === FeedbackType.Issue ||
      feedbackType === FeedbackType.Error
    ) {
      setShareOptions((prev) => ({ ...prev, evolutionLog: true }));
    }
  }, [feedbackType, feedbackOpen]);

  const handleClose = () => {
    setFeedbackOpen(false);
    // Reset state
    setFeedbackType(FeedbackType.Suggestion);
    setFeedbackText("");
    setExpectedText("");
    setEmail("");
    setRelatedPrompt("");
    setShareOptions(DEFAULT_SHARE_OPTIONS);
    setFeedbackTypeOverride(null);
    useWidgetStore.setState({ feedbackInitialText: null, panicDetails: null });
  };

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);

    let sentSuccessfully = false;
    try {
      let metadata: Awaited<ReturnType<typeof darwinAPI.feedback.gatherMetadata>> | null = null;
      try {
        metadata = await darwinAPI.feedback.gatherMetadata(feedbackType, shareOptions);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("Failed to gather feedback metadata:", err);
      }

      // Build a typed Feedback model and log it (replace with submission later)
      const modelType = feedbackType;
      const relatedPromptText =
        (feedbackType === FeedbackType.Issue || feedbackType === FeedbackType.Error) &&
        relatedPrompt
          ? relatedPrompt
          : metadata?.lastPromptText;
      const selectedPromptText = shareOptions.lastPrompt ? relatedPromptText : undefined;

      const feedbackModel = new FeedbackModel({
        type: modelType,
        text: feedbackText,
        email: email || undefined,
        expectedText: feedbackType === FeedbackType.Bug ? expectedText : undefined,
        share: shareOptions,
        // artifact fields left empty for now; will be populated by caller when collecting logs
        lastPromptText: selectedPromptText,
        currentAppStateSnapshot: metadata?.currentAppStateSnapshot,
        systemInfo: metadata?.systemInfo,
        usageStats: metadata?.usageStats,
        evolutionLogContent: metadata?.evolutionLogContent,
        changedNixFilesDiff: metadata?.changedNixFilesDiff,
        aiProviderModelInfo: metadata?.aiProviderModelInfo,
        buildErrorOutput: metadata?.buildErrorOutput,
        flakeInputsSnapshot: metadata?.flakeInputsSnapshot,
        appLogsContent: metadata?.appLogsContent,
        panicDetails: feedbackType === FeedbackType.Error ? (panicDetails ?? undefined) : undefined,
      });

      const validation = feedbackModel.validate();
      if (!validation.ok) {
        console.warn("Feedback validation failed:", validation.errors);
      }

      const json = JSON.stringify(feedbackModel.toJSON());
      const sent = await darwinAPI.feedback.submit(json);

      if (sent) {
        toast.success("Thanks — feedback sent");
      } else {
        toast.info("Failed to send, we'll try again next time you open the app.");
      }
      sentSuccessfully = true;
    } finally {
      setSubmitting(false);
    }

    if (sentSuccessfully) {
      handleClose();
    }
  };

  const getTextboxLabel = () => {
    switch (feedbackType) {
      case FeedbackType.Suggestion:
        return "WHAT WOULD YOU LIKE TO SEE";
      case FeedbackType.General:
        return "WHAT'S ON YOUR MIND";
      case FeedbackType.Bug:
        return "WHAT HAPPENED";
      case FeedbackType.Issue:
      case FeedbackType.Error:
        return "DESCRIBE WHAT HAPPENED";
      default:
        return "WHAT'S ON YOUR MIND";
    }
  };

  const isIssue = feedbackType === FeedbackType.Issue;
  const isError = feedbackType === FeedbackType.Error;
  const isReportMode = isIssue || isError;
  const dialogTitle = isIssue ? "Report an issue" : isError ? "Report an error" : "Give feedback";
  const hasAutoFilledError = feedbackInitialText && isError;
  const dialogDescription = hasAutoFilledError
    ? "An error was detected. The details have been pre-filled below. Please review and submit to help us fix this issue."
    : "Help us make nixmac better";

  return (
    <Dialog
      open={feedbackOpen}
      onOpenChange={(open: boolean) => {
        if (!open) {
          handleClose();
          return;
        }
        setFeedbackOpen(true);
      }}
    >
      <DialogContent className="max-w-2xl h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className={hasAutoFilledError ? "flex items-center gap-2" : ""}>
            {hasAutoFilledError && <span className="text-red-500">⚠️</span>}
            {dialogTitle}
          </DialogTitle>
          <DialogDescription>{dialogDescription}</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 flex-1 overflow-y-auto pr-2">
          {/* Type Selection */}
          {!isIssue && !isError && (
            <div className="space-y-3">
              <Label className="text-muted-foreground">TYPE</Label>
              <RadioGroup
                value={feedbackType}
                onValueChange={(value: string) => setFeedbackType(value as FeedbackType)}
                className="grid grid-cols-3 gap-4"
              >
                <Label
                  className={`flex cursor-pointer flex-row items-center gap-3 rounded-lg border border-input bg-transparent p-3 hover:bg-accent transition-opacity ${
                    feedbackType === FeedbackType.Suggestion ? "opacity-100" : "opacity-40"
                  }`}
                  htmlFor="suggestion"
                >
                  <RadioGroupItem className="sr-only" value="suggestion" id="suggestion" />
                  <Lightbulb className="h-5 w-5 text-muted-foreground" />
                  <span className="font-medium text-sm">Suggestion</span>
                </Label>

                <Label
                  className={`flex cursor-pointer flex-row items-center gap-3 rounded-lg border border-input bg-transparent p-3 hover:bg-accent transition-opacity ${
                    feedbackType === FeedbackType.Bug ? "opacity-100" : "opacity-40"
                  }`}
                  htmlFor="bug"
                >
                  <RadioGroupItem className="sr-only" value="bug" id="bug" />
                  <Bug className="h-5 w-5 text-muted-foreground" />
                  <span className="font-medium text-sm">Bug</span>
                </Label>

                <Label
                  className={`flex cursor-pointer flex-row items-center gap-3 rounded-lg border border-input bg-transparent p-3 hover:bg-accent transition-opacity ${
                    feedbackType === FeedbackType.General ? "opacity-100" : "opacity-40"
                  }`}
                  htmlFor="general"
                >
                  <RadioGroupItem className="sr-only" value="general" id="general" />
                  <MessageCircle className="h-5 w-5 text-muted-foreground" />
                  <span className="font-medium text-sm">General</span>
                </Label>
              </RadioGroup>
            </div>
          )}

          {/* Feedback Text */}
          <div className="space-y-2">
            <Label htmlFor="feedback-text" className="text-foreground">
              {getTextboxLabel()}
            </Label>
            <Textarea
              id="feedback-text"
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              placeholder="Tell us more..."
              rows={3}
              className="resize-none"
            />

            {/* Email input (optional) */}
          </div>

          {/* Prompt selector - visible for all feedback types */}
          <div className="space-y-2">
            <Label className="text-foreground">PROMPT (optional)</Label>
            <Select value={relatedPrompt} onValueChange={setRelatedPrompt}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a prompt (optional)" />
              </SelectTrigger>
              <SelectContent>
                {promptHistory.length > 0 ? (
                  promptHistory.map((prompt) => (
                    <SelectItem key={prompt} value={prompt}>
                      <span className="line-clamp-2">{prompt}</span>
                    </SelectItem>
                  ))
                ) : (
                  <SelectItem disabled value="__empty__">
                    No prompt history
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Email input (optional) - moved below RELATED PROMPT for issue flow */}
          <div className="mt-2 flex items-center gap-3">
            <Label htmlFor="feedback-email" className="text-foreground text-sm">
              Email (optional)
            </Label>
            <Input
              id="feedback-email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="max-w-xs"
            />
          </div>

          {/* Expected Text (Bug only) */}
          {feedbackType === FeedbackType.Bug && (
            <div className="space-y-2">
              <Label htmlFor="expected-text" className="text-foreground">
                WHAT DID YOU EXPECT
              </Label>
              <Textarea
                id="expected-text"
                value={expectedText}
                onChange={(e) => setExpectedText(e.target.value)}
                placeholder="What should have happened instead?"
                rows={3}
                className="resize-none"
              />
            </div>
          )}

          {/* Share with team */}
          <div className="space-y-2">
            <Label className="text-foreground">SHARE WITH THE TEAM</Label>
            <div className="space-y-2 max-h-[28vh] overflow-y-auto pr-2">
              {shouldShowCurrentAppState(feedbackType, step, mainWindowError) && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="share-app-state"
                    checked={shareOptions.currentAppState}
                    onCheckedChange={(checked: boolean | "indeterminate") =>
                      setShareOptions({
                        ...shareOptions,
                        currentAppState: checked === true,
                      })
                    }
                  />
                  <Label
                    htmlFor="share-app-state"
                    className="cursor-pointer font-medium text-sm text-foreground flex-1"
                  >
                    Current app state
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="p-1 h-5 w-5 inline-flex items-center justify-center rounded-md hover:bg-accent/50 transition-colors flex-shrink-0 group"
                        aria-label="More information"
                      >
                        <Info className="h-4 w-4 text-muted-foreground group-hover:text-foreground/70 transition-colors" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-sm text-sm">
                      {shareOptionTooltips.currentAppState}
                    </TooltipContent>
                  </Tooltip>
                </div>
              )}

              {shouldShowSystemInfo(feedbackType, step, mainWindowError) && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="share-system-info"
                    checked={shareOptions.systemInfo}
                    onCheckedChange={(checked: boolean | "indeterminate") =>
                      setShareOptions({
                        ...shareOptions,
                        systemInfo: checked === true,
                      })
                    }
                  />
                  <Label
                    htmlFor="share-system-info"
                    className="cursor-pointer font-medium text-sm text-foreground flex-1"
                  >
                    System info
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="p-1 h-5 w-5 inline-flex items-center justify-center rounded-md hover:bg-accent/50 transition-colors flex-shrink-0 group"
                        aria-label="More information"
                      >
                        <Info className="h-4 w-4 text-muted-foreground group-hover:text-foreground/70 transition-colors" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-sm text-sm">
                      {shareOptionTooltips.systemInfo}
                    </TooltipContent>
                  </Tooltip>
                </div>
              )}

              {shouldShowUsageStats(feedbackType, step, mainWindowError) && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="share-usage-stats"
                    checked={shareOptions.usageStats}
                    onCheckedChange={(checked: boolean | "indeterminate") =>
                      setShareOptions({
                        ...shareOptions,
                        usageStats: checked === true,
                      })
                    }
                  />
                  <Label
                    htmlFor="share-usage-stats"
                    className="cursor-pointer font-medium text-sm text-foreground flex-1"
                  >
                    Usage stats
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="p-1 h-5 w-5 inline-flex items-center justify-center rounded-md hover:bg-accent/50 transition-colors flex-shrink-0 group"
                        aria-label="More information"
                      >
                        <Info className="h-4 w-4 text-muted-foreground group-hover:text-foreground/70 transition-colors" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-sm text-sm">
                      {shareOptionTooltips.usageStats}
                    </TooltipContent>
                  </Tooltip>
                </div>
              )}

              {shouldShowEvolutionLog(feedbackType, step, mainWindowError) && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="share-evolution-log"
                    checked={shareOptions.evolutionLog}
                    onCheckedChange={(checked: boolean | "indeterminate") =>
                      setShareOptions({
                        ...shareOptions,
                        evolutionLog: checked === true,
                      })
                    }
                  />
                  <Label
                    htmlFor="share-evolution-log"
                    className="cursor-pointer font-medium text-sm text-foreground flex-1"
                  >
                    Evolution log
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="p-1 h-5 w-5 inline-flex items-center justify-center rounded-md hover:bg-accent/50 transition-colors flex-shrink-0 group"
                        aria-label="More information"
                      >
                        <Info className="h-4 w-4 text-muted-foreground group-hover:text-foreground/70 transition-colors" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-sm text-sm">
                      {shareOptionTooltips.evolutionLog}
                    </TooltipContent>
                  </Tooltip>
                </div>
              )}

              {shouldShowChangedNixFiles(feedbackType, step, mainWindowError) && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="share-changed-nix-files"
                    checked={shareOptions.changedNixFiles}
                    onCheckedChange={(checked: boolean | "indeterminate") =>
                      setShareOptions({
                        ...shareOptions,
                        changedNixFiles: checked === true,
                      })
                    }
                  />
                  <Label
                    htmlFor="share-changed-nix-files"
                    className="cursor-pointer font-medium text-sm text-foreground flex-1"
                  >
                    Changed nix files
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="p-1 h-5 w-5 inline-flex items-center justify-center rounded-md hover:bg-accent/50 transition-colors flex-shrink-0 group"
                        aria-label="More information"
                      >
                        <Info className="h-4 w-4 text-muted-foreground group-hover:text-foreground/70 transition-colors" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-sm text-sm">
                      {shareOptionTooltips.changedNixFiles}
                    </TooltipContent>
                  </Tooltip>
                </div>
              )}

              {shouldShowAiProviderModelInfo(feedbackType, step, mainWindowError) && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="share-ai-provider-model-info"
                    checked={shareOptions.aiProviderModelInfo}
                    onCheckedChange={(checked: boolean | "indeterminate") =>
                      setShareOptions({
                        ...shareOptions,
                        aiProviderModelInfo: checked === true,
                      })
                    }
                  />
                  <Label
                    htmlFor="share-ai-provider-model-info"
                    className="cursor-pointer font-medium text-sm text-foreground flex-1"
                  >
                    AI provider and model info
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="p-1 h-5 w-5 inline-flex items-center justify-center rounded-md hover:bg-accent/50 transition-colors flex-shrink-0 group"
                        aria-label="More information"
                      >
                        <Info className="h-4 w-4 text-muted-foreground group-hover:text-foreground/70 transition-colors" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-sm text-sm">
                      {shareOptionTooltips.aiProviderModelInfo}
                    </TooltipContent>
                  </Tooltip>
                </div>
              )}

              {shouldShowBuildErrorOutput(feedbackType, step, mainWindowError) && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="share-build-error-output"
                    checked={shareOptions.buildErrorOutput}
                    onCheckedChange={(checked: boolean | "indeterminate") =>
                      setShareOptions({
                        ...shareOptions,
                        buildErrorOutput: checked === true,
                      })
                    }
                  />
                  <Label
                    htmlFor="share-build-error-output"
                    className="cursor-pointer font-medium text-sm text-foreground flex-1"
                  >
                    Build error output
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="p-1 h-5 w-5 inline-flex items-center justify-center rounded-md hover:bg-accent/50 transition-colors flex-shrink-0 group"
                        aria-label="More information"
                      >
                        <Info className="h-4 w-4 text-muted-foreground group-hover:text-foreground/70 transition-colors" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-sm text-sm">
                      {shareOptionTooltips.buildErrorOutput}
                    </TooltipContent>
                  </Tooltip>
                </div>
              )}

              {shouldShowFlakeInputsSnapshot(feedbackType, step, mainWindowError) && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="share-flake-inputs-snapshot"
                    checked={shareOptions.flakeInputsSnapshot}
                    onCheckedChange={(checked: boolean | "indeterminate") =>
                      setShareOptions({
                        ...shareOptions,
                        flakeInputsSnapshot: checked === true,
                      })
                    }
                  />
                  <Label
                    htmlFor="share-flake-inputs-snapshot"
                    className="cursor-pointer font-medium text-sm text-foreground flex-1"
                  >
                    Flake inputs snapshot
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="p-1 h-5 w-5 inline-flex items-center justify-center rounded-md hover:bg-accent/50 transition-colors flex-shrink-0 group"
                        aria-label="More information"
                      >
                        <Info className="h-4 w-4 text-muted-foreground group-hover:text-foreground/70 transition-colors" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-sm text-sm">
                      {shareOptionTooltips.flakeInputsSnapshot}
                    </TooltipContent>
                  </Tooltip>
                </div>
              )}

              {shouldShowAppLogs(feedbackType, step, mainWindowError) && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="share-app-logs"
                    checked={shareOptions.appLogs}
                    onCheckedChange={(checked: boolean | "indeterminate") =>
                      setShareOptions({
                        ...shareOptions,
                        appLogs: checked === true,
                      })
                    }
                  />
                  <Label
                    htmlFor="share-app-logs"
                    className="cursor-pointer font-medium text-sm text-foreground flex-1"
                  >
                    App logs
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="p-1 h-5 w-5 inline-flex items-center justify-center rounded-md hover:bg-accent/50 transition-colors flex-shrink-0 group"
                        aria-label="More information"
                      >
                        <Info className="h-4 w-4 text-muted-foreground group-hover:text-foreground/70 transition-colors" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-sm text-sm">
                      {shareOptionTooltips.appLogs}
                    </TooltipContent>
                  </Tooltip>
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : isReportMode ? "Send Report" : "Send Feedback"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
