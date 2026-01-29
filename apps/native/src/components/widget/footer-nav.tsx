"use client";

import { ArrowLeft, ArrowRight, Eye, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  type GitStatus,
  type WidgetStep,
} from "@/stores/widget-store";

interface FooterNavProps {
  step: WidgetStep;
  isProcessing: boolean;
  onBack?: () => void;
  onContinue?: () => void;
  evolvePrompt: string;
  gitStatus: GitStatus | null;
}

export function FooterNav({
  step,
  isProcessing,
  onBack,
  onContinue,
  evolvePrompt,
  gitStatus,
}: FooterNavProps) {
  const hasChanges = gitStatus?.files && gitStatus.files.length > 0;
  const allChangesCleanlyStaged = gitStatus?.allChangesCleanlyStaged ?? false;
  const showInlineCommitActions = allChangesCleanlyStaged && hasChanges;

  // Determine if continue should be disabled
  const isContinueDisabled = (() => {
    if (isProcessing) {
      return true;
    }
    if (step === "overview") {
      return !evolvePrompt.trim();
    }
    if (step === "evolving") {
      return !hasChanges;
    }
    return false;
  })();

  // Determine continue button text
  const getContinueText = () => {
    if (step === "overview") {
      return "Evolve";
    }
    if (step === "evolving") {
      return "Preview";
    }
    return "Continue";
  };

  // Hide footer on commit step (actions are inline)
  if (step === "commit") {
    return null;
  }

  // When all changes are staged, the main view shows a Commit button.
  // Hide the footer continue button to avoid duplicate actions.
  if (showInlineCommitActions) {
    return null;
  }

  // Determine the icon to show
  const getContinueIcon = () => {
    if (isProcessing) {
      return <Loader2 className="mr-2 h-4 w-4 animate-spin" />;
    }
    if (step === "overview") {
      return <Sparkles className="mr-2 h-4 w-4" />;
    }
    if (step === "evolving") {
      return <Eye className="mr-2 h-4 w-4" />;
    }
    return <ArrowRight className="mr-2 h-4 w-4" />;
  };

  return (
    <div className="border-border border-t px-5 py-4">
      <div className="flex items-center justify-between">
        <Button
          className={cn(!onBack && "invisible")}
          disabled={!onBack || isProcessing}
          onClick={onBack}
          variant="outline"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>

        {onContinue ? (
          <Button
            className="bg-slate-300 hover:bg-slate-400"
            disabled={isContinueDisabled}
            onClick={onContinue}
          >
            {getContinueIcon()}
            {getContinueText()}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
