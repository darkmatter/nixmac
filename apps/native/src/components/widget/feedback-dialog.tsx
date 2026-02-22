import { useState } from "react";
import { useWidgetStore } from "@/stores/widget-store";
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
import { Lightbulb, Bug, MessageCircle } from "lucide-react";
import { Feedback as FeedbackModel, FeedbackType, ShareOptions} from "@/types/feedback";
import { getFeedbackUrl } from "@/lib/env";
import { darwinAPI } from "@/tauri-api";
import { fetch } from '@tauri-apps/plugin-http';
import { toast } from "sonner";

export function FeedbackDialog() {
  const feedbackOpen = useWidgetStore((s) => s.feedbackOpen);
  const setFeedbackOpen = useWidgetStore((s) => s.setFeedbackOpen);

  const [feedbackType, setFeedbackType] = useState<FeedbackType>(FeedbackType.Suggestion);
  const [feedbackText, setFeedbackText] = useState("");
  const [expectedText, setExpectedText] = useState("");
  const [email, setEmail] = useState("");
  const [shareOptions, setShareOptions] = useState<ShareOptions>({
    lastPrompt: true,
    currentAppState: true,
    systemInfo: true,
    usageStats: true,
    evolutionLog: true,
    nixConfig: true,
    appLogs: true,
  });

  const handleClose = () => {
    setFeedbackOpen(false);
    // Reset state
    setFeedbackType(FeedbackType.Suggestion);
    setFeedbackText("");
    setExpectedText("");
    setShareOptions({
      lastPrompt: true,
      currentAppState: true,
      systemInfo: true,
      usageStats: true,
      evolutionLog: true,
      nixConfig: true,
      appLogs: true,
    });
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
    const modelType =
      feedbackType === "suggestion"
        ? FeedbackType.Suggestion
        : feedbackType === "bug"
        ? FeedbackType.Bug
        : FeedbackType.General;

    const feedbackModel = new FeedbackModel({
      type: modelType,
      text: feedbackText,
      email: email || undefined,
      expectedText: feedbackType === "bug" ? expectedText : undefined,
      share: shareOptions,
      // artifact fields left empty for now; will be populated by caller when collecting logs
      lastPromptText: metadata?.lastPromptText,
      currentAppStateSnapshot: metadata?.currentAppStateSnapshot,
      systemInfo: metadata?.systemInfo,
      usageStats: metadata?.usageStats,
      evolutionLogContent: metadata?.evolutionLogContent,
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
            toast.error(`Validation error: ${details.join('; ')}`);
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
    }
  };

  const showLastPrompt = feedbackType === FeedbackType.Suggestion || feedbackType === FeedbackType.Bug;

  return (
    <Dialog open={feedbackOpen} onOpenChange={setFeedbackOpen}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Give feedback</DialogTitle>
          <DialogDescription>Help us make nixmac better</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Type Selection */}
          <div className="space-y-3">
            <Label className="text-muted-foreground">TYPE</Label>
            <RadioGroup
              value={feedbackType}
              onValueChange={(value: string) => setFeedbackType(value as FeedbackType)}
              className="grid grid-cols-3 gap-4"
            >
              <Label
                className={`flex cursor-pointer flex-row items-center gap-3 rounded-lg border border-input bg-transparent p-3 hover:bg-accent transition-opacity ${
                  feedbackType === "suggestion" ? "opacity-100" : "opacity-40"
                }`}
                htmlFor="suggestion"
              >
                <RadioGroupItem className="sr-only" value="suggestion" id="suggestion" />
                <Lightbulb className="h-5 w-5 text-muted-foreground" />
                <span className="font-medium text-sm">Suggestion</span>
              </Label>

              <Label
                className={`flex cursor-pointer flex-row items-center gap-3 rounded-lg border border-input bg-transparent p-3 hover:bg-accent transition-opacity ${
                  feedbackType === "bug" ? "opacity-100" : "opacity-40"
                }`}
                htmlFor="bug"
              >
                <RadioGroupItem className="sr-only" value="bug" id="bug" />
                <Bug className="h-5 w-5 text-muted-foreground" />
                <span className="font-medium text-sm">Bug</span>
              </Label>

              <Label
                className={`flex cursor-pointer flex-row items-center gap-3 rounded-lg border border-input bg-transparent p-3 hover:bg-accent transition-opacity ${
                  feedbackType === "general" ? "opacity-100" : "opacity-40"
                }`}
                htmlFor="general"
              >
                <RadioGroupItem className="sr-only" value="general" id="general" />
                <MessageCircle className="h-5 w-5 text-muted-foreground" />
                <span className="font-medium text-sm">General</span>
              </Label>
            </RadioGroup>
          </div>

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
          </div>

          {/* Expected Text (Bug only) */}
          {feedbackType === "bug" && (
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
              {showLastPrompt && (
                <div className="flex items-start gap-2">
                  <Checkbox
                    id="share-prompt"
                    checked={shareOptions.lastPrompt}
                    onCheckedChange={(checked: boolean | "indeterminate") =>
                      setShareOptions({
                        ...shareOptions,
                        lastPrompt: checked === true,
                      })
                    }
                  />
                  <div className="grid gap-1 leading-none">
                    <Label
                      htmlFor="share-prompt"
                      className="cursor-pointer font-medium text-sm text-muted-foreground"
                    >
                      Last Prompt
                    </Label>
                    <p className="text-muted-foreground text-xs">
                      "Make the dock autohide with no delay"
                    </p>
                  </div>
                </div>
              )}

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

              {feedbackType === "bug" && (
                <>
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
                        Most recent evolution log
                      </Label>
                      <p className="text-muted-foreground text-xs">
                        Full agent trace -- iterations, file reads, edits, build checks
                      </p>
                    </div>
                  </div>

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
                        Nix config files (current state)
                      </Label>
                      <p className="text-muted-foreground text-xs">
                        All .nix files in modules/ as currently on disk
                      </p>
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
                      <p className="text-muted-foreground text-xs">
                        Last 200 lines of nixmac.log
                      </p>
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
          <Button onClick={handleSubmit}>Send Feedback</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
