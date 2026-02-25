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
import { Lightbulb, Bug, MessageCircle } from "lucide-react";
import { Feedback as FeedbackModel, FeedbackType, ShareOptions } from "@/types/feedback";
import { getFeedbackUrl } from "@/lib/env";
import { darwinAPI } from "@/tauri-api";
import { fetch } from "@tauri-apps/plugin-http";
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
  nixConfig: true,
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
  nixConfig: true,
  appLogs: true,
};

export function FeedbackDialog() {
  const feedbackOpen = useWidgetStore((s) => s.feedbackOpen);
  const setFeedbackOpen = useWidgetStore((s) => s.setFeedbackOpen);
  const feedbackTypeOverride = useWidgetStore((s) => s.feedbackTypeOverride);
  const setFeedbackTypeOverride = useWidgetStore((s) => s.setFeedbackTypeOverride);
  const gitStatus = useWidgetStore((s) => s.gitStatus);
  const step = useCurrentStep();

  const [feedbackType, setFeedbackType] = useState<FeedbackType>(FeedbackType.Suggestion);
  const [feedbackText, setFeedbackText] = useState("");
  const [expectedText, setExpectedText] = useState("");
  const [email, setEmail] = useState("");
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
  const [relatedPrompt, setRelatedPrompt] = useState("");
  const [shareOptions, setShareOptions] = useState<ShareOptions>(DEFAULT_SHARE_OPTIONS);

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
  };

  const handleSubmit = async () => {
    let metadata: Awaited<ReturnType<typeof darwinAPI.feedback.gatherMetadata>> | null = null;
    try {
      metadata = await darwinAPI.feedback.gatherMetadata(feedbackType, shareOptions);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("Failed to gather feedback metadata:", err);
    }

    // Build a typed Feedback model and log it (replace with submission later)
    const modelType = feedbackType;
    // Always use relatedPrompt if the user selected one from the dialog
    const selectedPromptText = relatedPrompt || undefined;

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
      nixConfigSnapshot: metadata?.nixConfigSnapshot,
      appLogsContent: metadata?.appLogsContent,
    });

    const validation = feedbackModel.validate();
    if (!validation.ok) {
      console.warn("Feedback validation failed:", validation.errors);
    }

    try {
      const feedbackUrl = getFeedbackUrl();
      const payload = feedbackModel.toJSON();
      const json = JSON.stringify(payload);

      const resp = await fetch(feedbackUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: json,
      });

      let body: any = null;
      try {
        body = await resp.json();
        // oxlint-disable-next-line no-unused-vars
      } catch (e) {
        // ignore
      }

      if (!resp.ok) {
        const serverErr = body?.error ?? null;
        const details = body?.details;

        // Only surface errors we intentionally add in the API handler.
        if (serverErr === "rate_limited") {
          toast.error("You're sending feedback too quickly — please wait a minute and try again.");
        } else if (serverErr === "validation_failed") {
          if (Array.isArray(details) && details.length > 0) {
            toast.error(`Validation error: ${details.join("; ")}`);
          } else {
            toast.error("Validation failed — please check your input.");
          }
        } else if (serverErr === "dsn missing") {
          toast.error("Feedback DSN missing in request.");
        } else if (serverErr === "invalid dsn") {
          toast.error("Invalid feedback DSN — submission rejected.");
        } else if (serverErr === "db_error") {
          toast.error("Server error saving feedback. Please try again later.");
        } else if (typeof serverErr === "string") {
          // If it's some other string, show it directly (fallback).
          toast.error(serverErr);
        } else {
          toast.error("Failed to send feedback. Please try again.");
        }
      } else {
        const id = body?.id ?? undefined;
        toast.success(id ? `Thanks — feedback sent (id: ${id})` : "Thanks — feedback sent");
        const info = body?.info ?? body?.message ?? null;
        if (typeof info === "string" && info.length > 0) {
          // show any friendly informational message from the server
          toast(info);
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("Error posting feedback:", err);
    }

    handleClose();
  };

  const getTextboxLabel = () => {
    switch (feedbackType) {
      case FeedbackType.Suggestion:
        return "WHAT WOULD YOU LIKE TO SEE";
      case FeedbackType.General:
        return "WHAT'S ON YOUR MIND";
      case FeedbackType.Bug:
        return "WHAT HAPPENED";
      case (FeedbackType.Issue, FeedbackType.Error):
        return "DESCRIBE WHAT HAPPENED";
      default:
        return "WHAT'S ON YOUR MIND";
    }
  };

  const isIssue = feedbackType === FeedbackType.Issue;
  const isError = feedbackType === FeedbackType.Error;
  const isReportMode = isIssue || isError;
  const isEvolveStep = step === "evolving";
  const isCommitStep = step === "merge";
  const hasChanges = Boolean(gitStatus?.diff);
  const showEvolveCommitOptions = isCommitStep || (isEvolveStep && hasChanges);
  const showEvolutionLogOption = showEvolveCommitOptions || feedbackType === FeedbackType.Bug;
  const showEvolveOnlyOptions = isEvolveStep && hasChanges;
  const dialogTitle = isIssue ? "Report an issue" : isError ? "Report an error" : "Give feedback";

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
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>Help us make nixmac better</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
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
            <Label htmlFor="feedback-text" className="text-muted-foreground">
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
            <Label className="text-muted-foreground">PROMPT (optional)</Label>
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
            <Label htmlFor="feedback-email" className="text-muted-foreground text-sm">
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
              <Label htmlFor="expected-text" className="text-muted-foreground">
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
            <Label className="text-muted-foreground">SHARE WITH THE TEAM</Label>
            <div className="space-y-2">
              <div className="flex items-start gap-2">
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
                <div className="grid gap-1 leading-none">
                  <Label
                    htmlFor="share-app-state"
                    className="cursor-pointer font-medium text-sm text-muted-foreground"
                  >
                    Current app state
                  </Label>
                  <p className="text-muted-foreground text-xs">
                    Which stage you're on, active view, feature flags
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2">
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
                <div className="grid gap-1 leading-none">
                  <Label
                    htmlFor="share-system-info"
                    className="cursor-pointer font-medium text-sm text-muted-foreground"
                  >
                    System info
                  </Label>
                  <p className="text-muted-foreground text-xs">
                    macOS 15.3, nixmac v0.1.0, nix 2.24.1, aarch64-darwin
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2">
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
                <div className="grid gap-1 leading-none">
                  <Label
                    htmlFor="share-usage-stats"
                    className="cursor-pointer font-medium text-sm text-muted-foreground"
                  >
                    Usage stats
                  </Label>
                  <p className="text-muted-foreground text-xs">
                    Total evolutions run, success rate, avg iterations
                  </p>
                </div>
              </div>

              {showEvolutionLogOption && (
                <div className="flex items-start gap-2">
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
                  <div className="grid gap-1 leading-none">
                    <Label
                      htmlFor="share-evolution-log"
                      className="cursor-pointer font-medium text-sm text-muted-foreground"
                    >
                      Evolution log
                    </Label>
                    <p className="text-muted-foreground text-xs">
                      Full agent trace -- iterations, file reads, edits, build checks
                    </p>
                  </div>
                </div>
              )}

              {showEvolveCommitOptions && (
                <>
                  <div className="flex items-start gap-2">
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
                    <div className="grid gap-1 leading-none">
                      <Label
                        htmlFor="share-changed-nix-files"
                        className="cursor-pointer font-medium text-sm text-muted-foreground"
                      >
                        Changed nix files
                      </Label>
                      <p className="text-muted-foreground text-xs">
                        Contents as currently modified, git diff
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-2">
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
                    <div className="grid gap-1 leading-none">
                      <Label
                        htmlFor="share-ai-provider-model-info"
                        className="cursor-pointer font-medium text-sm text-muted-foreground"
                      >
                        AI provider and model info
                      </Label>
                      <p className="text-muted-foreground text-xs">
                        OpenRouter, Claude Sonnet 4, token usage, latency
                      </p>
                    </div>
                  </div>
                </>
              )}

              {showEvolveOnlyOptions && (
                <>
                  <div className="flex items-start gap-2">
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
                    <div className="grid gap-1 leading-none">
                      <Label
                        htmlFor="share-build-error-output"
                        className="cursor-pointer font-medium text-sm text-muted-foreground"
                      >
                        Build error output
                      </Label>
                      <p className="text-muted-foreground text-xs">
                        nix flake check status error (if any)
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-2">
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
                    <div className="grid gap-1 leading-none">
                      <Label
                        htmlFor="share-flake-inputs-snapshot"
                        className="cursor-pointer font-medium text-sm text-muted-foreground"
                      >
                        Flake inputs snapshot
                      </Label>
                      <p className="text-muted-foreground text-xs">
                        nix pkgs/nix darwin/home-manager revs from flake.lock
                      </p>
                    </div>
                  </div>
                </>
              )}

              {feedbackType === FeedbackType.Bug && (
                <>
                  <div className="flex items-start gap-2">
                    <Checkbox
                      id="share-nix-config"
                      checked={shareOptions.nixConfig}
                      onCheckedChange={(checked: boolean | "indeterminate") =>
                        setShareOptions({
                          ...shareOptions,
                          nixConfig: checked === true,
                        })
                      }
                    />
                    <div className="grid gap-1 leading-none">
                      <Label
                        htmlFor="share-nix-config"
                        className="cursor-pointer font-medium text-sm text-muted-foreground"
                      >
                        Nix config file diffs
                      </Label>
                      <p className="text-muted-foreground text-xs">Current nix file changes</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-2">
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
                    <div className="grid gap-1 leading-none">
                      <Label
                        htmlFor="share-app-logs"
                        className="cursor-pointer font-medium text-sm text-muted-foreground"
                      >
                        App logs
                      </Label>
                      <p className="text-muted-foreground text-xs">Last 200 lines of nixmac.log</p>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>{isReportMode ? "Send Report" : "Send Feedback"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
