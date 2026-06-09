"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MarkdownDescription } from "@/components/widget/summaries/markdown-description";
import { commitMessageBody } from "@/components/widget/summaries/markdown-utils";
import { useGitOperations } from "@/hooks/use-git-operations";
import { useSummary } from "@/hooks/use-summary";
import type { SemanticChangeMap } from "@/ipc/types";
import { useViewModel } from "@/stores/view-model";
import { useWidgetStore } from "@/stores/widget-store";
import { GitMerge, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const STALE_COMMIT_MESSAGE_MS = 8_000;

type CommitMessageStatus = "loading" | "ready" | "fallback" | "error";

function splitCommitMessage(message: string): { subject: string; body: string } {
  return {
    subject: message.split(/\r?\n/)[0] ?? "",
    body: commitMessageBody(message),
  };
}

function fallbackCommitSubject(changeMap: SemanticChangeMap | null): string {
  const filenames = [
    ...(changeMap?.groups.flatMap((group) =>
      group.changes.map((change) => change.filename),
    ) ?? []),
    ...(changeMap?.singles.map((change) => change.filename) ?? []),
  ];
  const uniqueFilenames = [...new Set(filenames.filter(Boolean))];

  if (uniqueFilenames.length === 1) {
    return `chore(nix): update ${uniqueFilenames[0]}`;
  }

  return "chore(nix): update configuration";
}

function changeMapFingerprint(changeMap: SemanticChangeMap | null): string | null {
  if (!changeMap) {
    return null;
  }

  const hashes = [
    ...changeMap.groups.flatMap((group) =>
      group.changes.map((change) => change.hash),
    ),
    ...changeMap.singles.map((change) => change.hash),
    ...changeMap.unsummarizedHashes,
  ];

  return hashes.sort().join("\0");
}

export function MergeSection() {
  const isProcessing = useWidgetStore((s) => s.isProcessing);
  const processingAction = useWidgetStore((s) => s.processingAction);
  const commitMessageSuggestion = useWidgetStore((s) => s.commitMessageSuggestion);
  const changeMap = useViewModel((s) => s.changeMap);

  const { handleCommit } = useGitOperations();
  const { generateCommitMessage } = useSummary();
  const [commitSubject, setCommitSubject] = useState("");
  const [commitBody, setCommitBody] = useState("");
  const [status, setStatus] = useState<CommitMessageStatus>("loading");
  const statusRef = useRef<CommitMessageStatus>(status);
  const userEditedRef = useRef(false);
  const requestIdRef = useRef(0);
  const changeMapFingerprintRef = useRef(changeMapFingerprint(changeMap));
  const ignoredSuggestionRef = useRef<string | null>(null);
  const suggestionFingerprintRef = useRef<string | null>(null);

  const setCommitMessageStatus = (nextStatus: CommitMessageStatus) => {
    statusRef.current = nextStatus;
    setStatus(nextStatus);
  };

  const resetCommitMessageDraft = () => {
    userEditedRef.current = false;
    setCommitMessageStatus("loading");
    setCommitSubject("");
    setCommitBody("");
  };

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    let staleTimer: ReturnType<typeof setTimeout> | null = null;
    const currentFingerprint = changeMapFingerprint(changeMap);
    const didChangeMap =
      changeMapFingerprintRef.current !== currentFingerprint;
    changeMapFingerprintRef.current = currentFingerprint;
    const currentSuggestion =
      useWidgetStore.getState().commitMessageSuggestion;
    if (currentSuggestion && !suggestionFingerprintRef.current) {
      ignoredSuggestionRef.current = currentSuggestion;
      useWidgetStore.getState().setCommitMessageSuggestion(null);
    }

    if (!changeMap) {
      suggestionFingerprintRef.current = null;
      useWidgetStore.getState().setCommitMessageSuggestion(null);
      resetCommitMessageDraft();
      return () => {
        requestIdRef.current += 1;
      };
    }

    if (didChangeMap) {
      ignoredSuggestionRef.current = currentSuggestion;
      suggestionFingerprintRef.current = null;
      userEditedRef.current = false;
      useWidgetStore.getState().setCommitMessageSuggestion(null);
      setCommitMessageStatus("loading");
      setCommitBody("");
      setCommitSubject("");
    } else if (!currentSuggestion && statusRef.current === "loading") {
      setCommitMessageStatus("loading");
      setCommitBody("");
      if (!userEditedRef.current) {
        setCommitSubject("");
      }
    }

    const showFallback = (nextStatus: CommitMessageStatus) => {
      if (requestIdRef.current !== requestId) {
        return;
      }
      setCommitMessageStatus(nextStatus);
      setCommitBody("");
      if (!userEditedRef.current) {
        setCommitSubject(fallbackCommitSubject(changeMap));
      }
    };

    void generateCommitMessage().then((result) => {
      if (requestIdRef.current !== requestId) {
        return;
      }

      if (result.status === "ready") {
        const parsed = splitCommitMessage(result.message);
        ignoredSuggestionRef.current = null;
        suggestionFingerprintRef.current = currentFingerprint;
        useWidgetStore
          .getState()
          .setCommitMessageSuggestion(result.message);
        setCommitMessageStatus("ready");
        if (!userEditedRef.current) {
          setCommitBody(parsed.body);
          setCommitSubject(parsed.subject);
        }
        return;
      }

      if (result.status === "error") {
        showFallback("error");
        return;
      }

      if (statusRef.current !== "loading") {
        return;
      }

      staleTimer = setTimeout(() => {
        showFallback("fallback");
      }, STALE_COMMIT_MESSAGE_MS);
    });

    return () => {
      requestIdRef.current += 1;
      if (staleTimer) {
        clearTimeout(staleTimer);
      }
    };
  }, [generateCommitMessage, changeMap]);

  useEffect(() => {
    if (!commitMessageSuggestion) {
      ignoredSuggestionRef.current = null;
      return;
    }

    if (commitMessageSuggestion === ignoredSuggestionRef.current) {
      return;
    }

    const currentFingerprint = changeMapFingerprint(changeMap);
    if (
      suggestionFingerprintRef.current &&
      suggestionFingerprintRef.current !== currentFingerprint
    ) {
      return;
    }

    const parsed = splitCommitMessage(commitMessageSuggestion);
    suggestionFingerprintRef.current = currentFingerprint;
    setCommitMessageStatus("ready");
    if (!userEditedRef.current) {
      setCommitBody(parsed.body);
      setCommitSubject(parsed.subject);
    }
  }, [commitMessageSuggestion, changeMap]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const subject = commitSubject.trim();
    if (!subject) {
      return;
    }

    const message = commitBody ? `${subject}\n\n${commitBody}` : subject;
    const didCommit = await handleCommit({ message });
    if (!didCommit) {
      return;
    }

    const store = useWidgetStore.getState();
    store.setCommitMessageSuggestion(null);
    store.setEvolvePrompt("");
    resetCommitMessageDraft();
  }

  const canCommit = !isProcessing && commitSubject.trim().length > 0;

  return (
    <div className="flex flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-border/50 border-b py-2">
        <div className="flex items-center gap-2">
          <GitMerge className="h-4 w-4 text-primary" />
          <h2 className="font-medium text-sm">Commit Changes</h2>
        </div>
      </div>

      <form className="pt-4" onSubmit={handleSubmit}>
        <div className="mb-4">
          <Input
            className="border-border bg-background mb-2"
            name="commitMsg"
            onChange={(event) => {
              userEditedRef.current = true;
              setCommitSubject(event.target.value);
            }}
            placeholder={status === "loading" ? "Loading..." : undefined}
            value={commitSubject}
            disabled={isProcessing}
          />
          {status === "fallback" && (
            <p className="mb-2 text-muted-foreground text-xs">
              Still generating a better suggestion. This fallback will update if
              one arrives.
            </p>
          )}
          {status === "error" && (
            <p className="mb-2 text-muted-foreground text-xs">
              Suggestion unavailable. You can commit with this fallback or edit it.
            </p>
          )}
          {commitBody && (
            <MarkdownDescription modalTitle={commitSubject} text={commitBody} />
          )}
        </div>

        <Button
          className="bg-slate-200 hover:bg-slate-300 text-slate-800"
          disabled={!canCommit}
          type="submit"
        >
          {processingAction === "merge" ? (
            <Loader2 className="mx-1 h-4 w-4 animate-spin" />
          ) : (
            <GitMerge className="mx-1 h-4 w-4" />
          )}
          Commit
        </Button>
      </form>
    </div>
  );
}
